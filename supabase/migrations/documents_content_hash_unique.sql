-- documents_content_hash_unique.sql
-- [DEDUP-ATOMIC] Make the byte-hash dedup RACE-SAFE.
--
-- The interactive upload paths (src/app/api/intake, /api/email/upload, /api/bank/attach-invoice)
-- dedup with a SELECT-then-INSERT on (user_id, content_hash). Two CONCURRENT requests for the same
-- file — a double-tap, or a client retry of a slow request — can both pass the SELECT before either
-- inserts, so both insert. That creates two documents + two invoices for ONE bill; attach-invoice
-- inserts status='paid', so the cost + voorbelasting are DOUBLE-COUNTED immediately. The email SYNC
-- path was already race-safe (UNIQUE on (receiver_id, source_message_id) + 23505 handling); the
-- interactive paths had the same dedup LOGIC but no DB constraint behind it.
--
-- This adds the missing UNIQUE index. The three routes now catch its 23505 and return a clean
-- "duplicate" (never a second invoice), exactly like the SELECT-found duplicate.
--
-- ⚠️ STAP 1 VERWIJDERT RIJEN. LEES DIT VOORDAT JE DIT BESTAND DRAAIT.
--
-- Dit bestand zei eerder "SAFE TO APPLY", op grond van deze bewering: een document zonder
-- invoice_id is "een pure re-upload; geen boekhoudregel hangt ervan af". DIE BEWERING WAS FOUT.
--
-- `documents.invoice_id` is namelijk maar ÉÉN van de ZES verwijzingen naar een document. De andere
-- vijf staan aan de kant van de boekhouding en laten `documents.invoice_id` leeg:
--
--     invoices.document_id                    de factuur-PDF
--     cash_entries.document_id                de bon achter een contante kostenpost
--     daily_turnover.document_id              de Z-bon van de dag
--     eft_settlements.document_id             de afrekening van de betaalautomaat
--     bank_transactions.statement_document_id het bankafschrift zelf
--     ledger_daily.document_id                de grootboekregel
--
-- Een contante bon die via cash_entries.document_id aan een kostenpost hangt, heeft dus
-- `invoice_id IS NULL` — en werd door de oude WHERE als wees gezien en HARD VERWIJDERD. De
-- ON DELETE SET NULL blankte daarna de koppeling, zonder audit-regel. En juist bij die bon is de
-- schade dubbel: financial-result.ts claimt de voorbelasting op een contante kostenpost ALLEEN
-- wanneer document_id gezet is (de regel "geen voorbelasting zonder document"), dus met het
-- document verdwijnt stil ook de aftrek.
--
-- Dat is letterlijk "de ondernemer raakt zijn papier kwijt" — het enige wat dit product belooft
-- dat niet gebeurt — in een bestand dat zichzelf veilig noemde.
--
-- De DELETE hieronder spaart nu een rij die door ÉÉN van de zes wordt genoemd. Draai eerst het
-- PRE-CHECK-blok onderaan: dat toont precies wat er zou verdwijnen. Is die uitkomst niet leeg,
-- kijk er dan eerst naar. Nul rijen is het normale antwoord.

-- 0) Eén definitie van "hier hangt iets aan". Zes tabellen verwijzen naar een document; de oude
--    WHERE keek er maar naar één. Als functie, zodat de DELETE, de rangschikking en het
--    PRE-CHECK-blok onderaan allemaal hetzelfde bedoelen — en zodat een zevende verwijzing later
--    op één plek wordt toegevoegd in plaats van op drie.
CREATE OR REPLACE FUNCTION public.document_is_referenced(doc uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.documents          WHERE id = doc AND invoice_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.invoices           WHERE document_id = doc)
      OR EXISTS (SELECT 1 FROM public.cash_entries       WHERE document_id = doc)
      OR EXISTS (SELECT 1 FROM public.daily_turnover     WHERE document_id = doc)
      OR EXISTS (SELECT 1 FROM public.eft_settlements    WHERE document_id = doc)
      OR EXISTS (SELECT 1 FROM public.ledger_daily       WHERE document_id = doc)
      OR EXISTS (SELECT 1 FROM public.bank_transactions  WHERE statement_document_id = doc);
$$;

COMMENT ON FUNCTION public.document_is_referenced(uuid) IS
  '[DEDUP-ATOMIC] Wordt dit document door enige boekhoudregel genoemd? Zes verwijzingen, één definitie. De dedup-opruiming mag alleen rijen verwijderen waarvoor dit false is.';

-- 1) Verwijder byte-duplicaten waar NIETS naar verwijst.
--
--    row_number houdt rang 1 per (user, hash): eerst de aangeraakte rij, dan de oudste, dan de
--    laagste id — volledig deterministisch. Alleen rang > 1 gaat weg, en alleen als geen van de
--    zes verwijzingen hem noemt. De volgorde geeft nu ook voorrang aan een rij die door welke
--    boekhoudregel dan ook wordt genoemd, niet alleen aan invoice_id.
DELETE FROM public.documents d
WHERE d.id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY user_id, content_hash
             ORDER BY (public.document_is_referenced(id)) DESC, created_at ASC, id ASC
           ) AS rn
    FROM public.documents
    WHERE content_hash IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
)
AND NOT public.document_is_referenced(d.id);

-- 2) The race-safe UNIQUE index (partial — only rows that actually carry a hash).
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_user_content_hash
  ON public.documents (user_id, content_hash) WHERE content_hash IS NOT NULL;

-- =====================================================================
-- PRE-CHECK — draai dit VOORDAT je stap 1 uitvoert.
--
-- Toont precies welke rijen zouden verdwijnen, mét hun bestandsnaam, zodat je ernaar kunt kijken
-- in plaats van erop te vertrouwen. Nul rijen is het normale antwoord.
--
--   select d.id, d.file_name, d.created_at, d.user_id
--     from public.documents d
--    where d.id in (
--            select id from (
--              select id,
--                     row_number() over (
--                       partition by user_id, content_hash
--                       order by (public.document_is_referenced(id)) desc, created_at asc, id asc
--                     ) as rn
--                from public.documents
--               where content_hash is not null
--            ) ranked
--           where ranked.rn > 1
--          )
--      and not public.document_is_referenced(d.id)
--    order by d.user_id, d.created_at;
--
-- EN DE VRAAG DIE VOORAF GAAT: is de OUDE versie van dit bestand hier al eens gedraaid?
-- Dan kan er al iets weg zijn, en dat is achteraf niet meer te zien (ON DELETE SET NULL heeft de
-- koppeling geblankt). Het bestaan van de index verraadt of stap 2 ooit liep:
--
--   select indexname from pg_indexes
--    where schemaname = 'public' and indexname = 'uq_documents_user_content_hash';
--
-- Komt daar een rij uit, dan is dit bestand eerder toegepast MET de oude, te ruime DELETE. Zoek dan
-- naar boekhoudregels die hun document kwijt zijn — die wijzen naar wat er is verdwenen:
--
--   select 'cash_entries'  as waar, count(*) from public.cash_entries
--     where document_id is null and btw_rate is not null and category = 'kosten'
--   union all
--   select 'daily_turnover', count(*) from public.daily_turnover where document_id is null
--   union all
--   select 'eft_settlements', count(*) from public.eft_settlements where document_id is null;
--
-- Let op: een lege document_id is niet automatisch bewijs van schade (veel regels hebben er nooit
-- een gehad). Het is een plek om te kijken, geen verdict. De contante kostenregels MET een
-- btw-tarief zijn de scherpste: daar hing de voorbelasting aan het document.
--
-- CONTROLE (na het toepassen):
--
--   select to_regprocedure('public.document_is_referenced(uuid)') as helper,
--          (select count(*) from pg_indexes
--            where schemaname='public' and indexname='uq_documents_user_content_hash') as index_er;
--   -- Verwacht: een naam en 1.
-- =====================================================================
