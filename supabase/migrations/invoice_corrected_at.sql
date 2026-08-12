-- supabase/migrations/invoice_corrected_at.sql
-- [HERSTEL] corrected_at — the fact that a SENT invoice was edited in place.
--
-- WHY A COLUMN AND NOT A REQUEST FLAG
-- The first build passed `herstel: true` from the edit route to the send route per request, and
-- the double-check found the two holes that leaves. (1) When the corrected delivery fails, the
-- advertised recovery — "verstuur opnieuw vanaf de factuurpagina" — is a PLAIN resend: no flag,
-- so the customer got a mail that never said the earlier version is void, and pdf_url kept
-- pointing at the pre-edit PDF. (2) Any caller could POST the flag directly and mail a customer
-- "de eerdere versie is vervallen" about an invoice nobody corrected.
--
-- A timestamp on the row closes both: once an invoice has been corrected, EVERY later delivery
-- of it is a corrected delivery — that is true semantics, not a workaround, because the customer
-- may hold the old version forever. And the send route derives it from the row instead of
-- trusting the caller.
--
-- Nullable, no default, no backfill: every existing invoice was never corrected. Safe to apply
-- at any time; the code falls back to per-request behaviour while this migration is open.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz;

COMMENT ON COLUMN public.invoices.corrected_at IS
  '[HERSTEL] Moment waarop deze VERSTUURDE factuur voor het laatst inhoudelijk is hersteld '
  '(zelfde nummer, klant automatisch geïnformeerd). NULL = nooit hersteld. Elke latere '
  'verzending van een herstelde factuur draagt de gecorrigeerde-versie-tekst.';
