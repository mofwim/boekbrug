-- supabase/migrations/cash_settlement_per_instalment.sql
-- [CASH-INSTALMENT] One kasboek entry per CASH INSTALMENT, instead of one per invoice.
--
-- Why this exists. Paying a purchase invoice in cash writes a balance-only 'betaling' entry in
-- the kasboek (cash_settlement_invoice_link.sql). That model allowed exactly ONE entry per
-- invoice — a unique index enforced it — which was right while an invoice could only be paid in
-- cash all at once. Since manual instalments exist (invoice_manual_payments.sql) it is not:
--
--     €1.210 invoice · € 500 cash on 3 May · € 710 cash on 12 June
--
-- collapsed into ONE entry of €1.210 dated 12 June. The drawer was then €500 too high for five
-- weeks, and half the money moved out of Q2 into a quarter that may already have been filed —
-- while the kasboek is exactly the document the Belastingdienst reads day by day, and a drawer
-- that dips below zero is the single strongest red flag they use. So the app REFUSED a cash
-- instalment ("een deelbetaling kan alleen via Bank"), which is an honest refusal but a real
-- limitation: paying a supplier in two cash handovers is ordinary in a shop.
--
-- The fix is structural, not a workaround: a kasboek entry now belongs to ONE instalment
-- (bank_tx_invoices.id), so it carries that instalment's own amount and its own date. The drawer
-- moves on the day the money actually moved, every time.
--
-- Legacy rows (written before this, one per invoice) keep settlement_id NULL and stay valid: the
-- reconcile treats a NULL-keyed entry as "the aggregate entry for this invoice" and heals it into
-- per-instalment entries the first time it runs over an invoice that has instalment rows.

-- 1) The link to the instalment. ON DELETE CASCADE, deliberately — and NOT "SET NULL", which was
--    the first instinct and is a trap: undoing a payment deletes ALL of an invoice's payment
--    links at once (pay-toggle undo is all-or-nothing), so SET NULL would turn two entries of the
--    same invoice into two NULL-keyed rows, collide on the unique index below, and make the
--    DELETE — the undo itself — fail. CASCADE is also the honest meaning: if the instalment no
--    longer exists, neither does the drawer movement it was. The reconcile would remove it on its
--    next run anyway; CASCADE just makes it immediate and race-free.
ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS settlement_id uuid
  REFERENCES public.bank_tx_invoices(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.cash_entries.settlement_id IS
  '[CASH-INSTALMENT] The single cash instalment (bank_tx_invoices row, method=''kas'') this drawer movement is. NULL for a legacy aggregate entry written before per-instalment settlements existed.';

-- 2) Uniqueness moves from "one per invoice" to "one per instalment". coalesce() folds the legacy
--    NULL into a fixed sentinel so an invoice can still hold at most ONE aggregate entry — without
--    it, Postgres treats every NULL as distinct and the idempotency guard would quietly disappear
--    for exactly the rows that still rely on it.
DROP INDEX IF EXISTS cash_entries_one_settlement_per_invoice;

CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_one_settlement_per_instalment
  ON public.cash_entries (invoice_id, coalesce(settlement_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE invoice_id IS NOT NULL;

-- 3) The reconcile reads a user's linked entries on every kasboek load and after every pay/undo.
CREATE INDEX IF NOT EXISTS idx_cash_entries_settlement
  ON public.cash_entries (settlement_id) WHERE settlement_id IS NOT NULL;
