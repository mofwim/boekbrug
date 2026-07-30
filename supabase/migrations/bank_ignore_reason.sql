-- supabase/migrations/bank_ignore_reason.sql
-- [BANK-IGNORE-REDEN] Waarom staat deze bankregel op 'genegeerd'?
--
-- Vandaag is negeren één tik zonder vraag: de status springt naar 'not_found' en verder wordt
-- er niets vastgelegd. Dat is precies de klacht die archive-reason.ts voor facturen al oploste
-- ("een lijst zonder geheugen"), één onderwerp verderop. De gevolgen zijn bovendien groot en
-- allemaal onzichtbaar: de regel verlaat de matcher, auto-confirm, auto-categorize, de
-- nachtelijke sweep én elke categorize-lezing, en de [VOORBELASTING-RISK]-waarschuwing voor die
-- regel verdwijnt omdat undocumentedCount pending-scoped is.
--
-- Zonder deze kolom is negeren de GOEDKOOPSTE uitweg: één tik, geen reden, geen spoor — en voor
-- een afschrijving maakt het het kwartaal ook nog groener. Elke eerlijkere knop ernaast verliest
-- die vergelijking. Dit is dus geen versiering maar de voorwaarde waaronder een derde uitkomst
-- (de vraagpost) überhaupt gebruikt zal worden.
--
-- Idempotent. Verandert geen enkel bestaand gedrag: de kolom is NULL voor alles wat er al staat,
-- en de app leest hem alleen om een label te tonen. Draait de migratie niet, dan blijft de
-- reden simpelweg leeg — geen fout, geen verlies.
--
-- ⚠️ NIET TOEGEPAST door de assistent. Draai hem zelf in de Supabase SQL-editor, of laat hem
-- liggen: er gaat niets stuk zolang hij er niet is.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS ignore_reason text;

-- Dezelfde vorm als invoices.archive_reason: een korte, gesloten woordenlijst. Vrije tekst is
-- bewust géén optie — die bevat persoonsgegevens van derden en botst dan met de bewaarplicht.
-- 'anders' is er zodat een gedwongen reden nooit een verzonnen reden wordt (archive-reason.ts:20).
ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_ignore_reason_check;
ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_ignore_reason_check
  CHECK (
    ignore_reason IS NULL OR ignore_reason IN (
      'prive',            -- privé-uitgave, hoort niet in de boekhouding
      'geen_factuur',     -- vaste last / abonnement waar nooit een factuur bij komt
      'dubbel',           -- deze regel staat er al een keer in
      'niet_van_mij',     -- niet mijn transactie (terugboeking, vergissing)
      'anders'
    )
  );

-- Alleen zinvol op regels die daadwerkelijk genegeerd zijn; partieel houdt de index klein.
CREATE INDEX IF NOT EXISTS idx_bank_tx_ignore_reason
  ON public.bank_transactions (user_id, ignore_reason)
  WHERE status = 'not_found';

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- Verwacht: 1 rij, has_column = true, has_check = true, has_index = true.
--
-- SELECT
--   (SELECT count(*) > 0 FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='bank_transactions'
--       AND column_name='ignore_reason') AS has_column,
--   (SELECT count(*) > 0 FROM pg_constraint
--     WHERE conname='bank_transactions_ignore_reason_check') AS has_check,
--   (SELECT count(*) > 0 FROM pg_indexes
--     WHERE schemaname='public' AND indexname='idx_bank_tx_ignore_reason') AS has_index;
