-- =====================================================================
-- [SNELSTART-CLAIM] Het idempotentie-slot vóór de boeking in plaats van erna.
-- BoekBrug · juli 2026
-- =====================================================================
-- WAT ER MIS WAS
--
-- De boeking naar SnelStart is ONOMKEERBAAR: hij landt in het wettelijke inkoop-/verkoopboek
-- van de boekhouder, en na 'verwerkt' vriest prevent_verwerkt_invoice_changes hem vast.
-- Het slot dat een tweede boeking moest tegenhouden — de partiële unique index op
-- status='pushed' — werd echter pas GESCHREVEN nadat die POST al gedaan was:
--
--     const created = await client.postBoeking(...)   ← onomkeerbaar
--     await recordAttempt(... status: "pushed" ...)   ← het slot, ná de deur
--
-- Tussen die twee regels past een tweede verzoek: een tweede tabblad, een dubbelklik, een
-- herhaling na een time-out. Beide lezen de wachtrij vóórdat de ander zijn regel schreef,
-- beide posten dezelfde factuur. Dezelfde inkoopfactuur staat dan twee keer in de boekhouding
-- van de klant, en de boekhouder heeft geen enkele reden om te vermoeden dat het er twee zijn.
--
-- Hetzelfde gat, tragere variant: gaat het proces dood ná de POST en vóór de regel, dan staat
-- de boeking in SnelStart zonder lokaal spoor — en de volgende ronde boekt hem opnieuw.
--
-- ── WAAROM ER EEN DERDE STAAT BIJ MOET ──────────────────────────────────────────────────
--
-- Vooraf claimen alleen is niet genoeg. Zet je de claim bij ELKE fout terug op 'failed', dan
-- is een netwerkfout fataal in de andere richting: de POST kán zijn aangekomen, SnelStart
-- boekte hem, en alleen het ANTWOORD ging verloren. Vrijgeven levert dan bij de volgende
-- poging alsnog een dubbele boeking op.
--
-- Daarom 'unknown': wij weten het niet, wij proberen het niet opnieuw, en een mens kijkt in
-- SnelStart of de boeking er staat. Dat is de juiste ruil voor een brug — een zichtbaar dubbel
-- is terug te vinden en te corrigeren; een onzichtbaar gemis (een factuur die iedereen als
-- geboekt beschouwt terwijl hij nergens staat) komt pas bij de aangifte aan het licht, of nooit.
--
-- Welke foutcode welke kant op gaat, staat in src/lib/snelstart-claim.ts en is daar getest.
-- De faalrichting daar is bewust 'unknown': een code die we vergeten toe te voegen kost één
-- handmatige controle te veel, nooit een dubbele boeking in andermans grootboek.
--
-- TOEPASSEN: draaien in de Supabase SQL-editor. Verwijdert niets. Idempotent.
-- =====================================================================

BEGIN;

-- ── 1. De derde staat toestaan ───────────────────────────────────────
-- De CHECK stond op ('pushed','failed'). Een claim-regel die nog nergens heen wijst, en een
-- boeking met onbekende afloop, passen in geen van beide.
ALTER TABLE public.snelstart_exports
  DROP CONSTRAINT IF EXISTS snelstart_exports_status_check;

ALTER TABLE public.snelstart_exports
  ADD CONSTRAINT snelstart_exports_status_check
  CHECK (status = ANY (ARRAY['pushed'::text, 'failed'::text, 'unknown'::text]));

-- ── 2. Het slot dekt nu ook de claim ─────────────────────────────────
-- Een factuur mag hooguit ÉÉN regel hebben die haar claimt. 'pushed' claimt omdat het gelukt
-- is; 'unknown' claimt omdat we niet WETEN of het gelukt is — en dat is precies wanneer
-- opnieuw boeken gevaarlijk is. 'failed' blijft eruit: bewezen niet-geboekt mag opnieuw.
--
-- Dit is óók wat de claim-insert vóór de POST laat werken: een tweede verzoek krijgt 23505 en
-- weet daarmee dat een ander deze factuur al onder handen heeft. Geen tweede POST.
DROP INDEX IF EXISTS public.snelstart_exports_user_invoice_pushed_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS snelstart_exports_user_invoice_claim_uidx
  ON public.snelstart_exports (user_id, invoice_id)
  WHERE status IN ('pushed', 'unknown');

COMMENT ON INDEX public.snelstart_exports_user_invoice_claim_uidx IS
  '[SNELSTART-CLAIM] Idempotentie-slot. Wordt geclaimd VÓÓR de onomkeerbare POST naar SnelStart: een tweede verzoek krijgt 23505 en post niet. Dekt pushed (gelukt) en unknown (afloop onbekend, nooit vanzelf opnieuw); failed valt erbuiten en mag opnieuw.';

COMMIT;

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen)
--
-- Leest de catalogus, dus werkt gewoon in de Supabase SQL-editor (service_role).
--
--   -- 1. De derde staat is toegestaan.
--   select pg_get_constraintdef(oid) as status_check
--     from pg_constraint
--    where conrelid = 'public.snelstart_exports'::regclass
--      and conname  = 'snelstart_exports_status_check';
--   -- Verwacht: ... ARRAY['pushed'::text, 'failed'::text, 'unknown'::text] ...
--
--   -- 2. Het slot dekt pushed EN unknown, en het oude slot is weg.
--   select indexname,
--          indexdef ilike '%unknown%' as dekt_unknown,
--          indexdef ilike '%pushed%'  as dekt_pushed
--     from pg_indexes
--    where schemaname = 'public'
--      and tablename  = 'snelstart_exports'
--      and indexname like '%invoice%';
--   -- Verwacht: precies ÉÉN rij (snelstart_exports_user_invoice_claim_uidx), beide true.
--   -- Staat de oude ..._pushed_uidx er nog naast, dan is stap 2 niet gedraaid.
-- =====================================================================
