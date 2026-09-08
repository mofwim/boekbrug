-- [LEVERANCIER-BEWERKEN] The owner edits a supplier on /dashboard/leveranciers, for the future.
--
-- Two things a master record needs before it may be edited from a screen, neither of which the
-- suppliers table had:
--
-- 1. updated_at that is TRUE. The column existed with DEFAULT now() and nothing maintained it, so
--    every supplier still carried the day it was founded. The screen now prints "laatst aangepast
--    op …" and an accountant reads that line; a date that is always the creation date is a lie
--    that looks like a fact. set_updated_at() already exists (bank_connections_updated_at.sql)
--    and is generic — this attaches it.
--
-- 2. The OLD account number, kept. Vendor master data practice is one sentence: never overwrite
--    silently, log who changed what and keep the previous value. For the IBAN that is not
--    bookkeeping hygiene but the fraud gate itself (iban-change.ts): an invoice that arrives next
--    month printing the number the owner just replaced must still RESOLVE to this supplier, so the
--    gate can say "this is a different number from the one on file" — instead of founding a
--    second supplier row and saying nothing. The registry reads this table as a fallback tier,
--    after the live IBAN and before KVK and name. It never writes the old number back.
--
-- Rows are appended by the edit route only; nothing updates or deletes them from the app, and RLS
-- allows the owner to read and insert their own. Seven years is the retention the rest of the
-- administration is held to (art. 52 AWR); these rows are part of it.

BEGIN;

DROP TRIGGER IF EXISTS set_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER set_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.supplier_iban_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  supplier_id  uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  -- The number as it stood on the supplier row, already normalised (no spaces, upper case).
  iban         text NOT NULL,
  replaced_by  text,
  replaced_at  timestamptz NOT NULL DEFAULT now(),
  -- Who said so: the acting user, which may be an employee writing into the owner's registry.
  actor_id     uuid,
  CONSTRAINT supplier_iban_history_iban_not_empty CHECK (length(btrim(iban)) > 0)
);

-- The registry's fallback lookup: "did this owner ever have a supplier on this number?"
CREATE INDEX IF NOT EXISTS supplier_iban_history_user_iban_idx
  ON public.supplier_iban_history (user_id, iban);
CREATE INDEX IF NOT EXISTS supplier_iban_history_supplier_idx
  ON public.supplier_iban_history (supplier_id);

ALTER TABLE public.supplier_iban_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_iban_history_select_own ON public.supplier_iban_history;
CREATE POLICY supplier_iban_history_select_own ON public.supplier_iban_history
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS supplier_iban_history_insert_own ON public.supplier_iban_history;
CREATE POLICY supplier_iban_history_insert_own ON public.supplier_iban_history
  FOR INSERT WITH CHECK (user_id = auth.uid());
-- No UPDATE and no DELETE policy on purpose: history is appended, never edited.

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.suppliers'::regclass AND NOT tgisinternal;
--   → set_suppliers_updated_at
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'supplier_iban_history';
--   → supplier_iban_history_select_own SELECT, supplier_iban_history_insert_own INSERT
