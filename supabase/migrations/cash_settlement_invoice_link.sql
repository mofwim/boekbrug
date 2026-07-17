-- [CASH-SETTLE] Link a kasboek entry to the invoice it settles, mirroring
-- bank_transactions.invoice_id. This lets a supplier invoice paid IN CASH create a linked,
-- reversible 'betaling' entry that moves the kas balance WITHOUT re-booking the cost (the
-- invoice already booked the cost + voorbelasting on accrual). The app-level reconcile
-- (src/lib/cash.ts computeCashSettlementSync) keeps this one-to-one and self-healing.
--
-- Safe to run more than once (IF NOT EXISTS). No data backfill here — the reconcile creates
-- the settlement entries for existing paid-in-cash invoices the first time the kasboek loads.

ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS invoice_id uuid
  REFERENCES public.invoices(id) ON DELETE SET NULL;

-- One settlement entry per invoice (partial unique index: only the invoice-linked rows are
-- constrained, so manual cash entries — invoice_id NULL — are unaffected). This makes the
-- reconcile's "create if missing" idempotent even under a race.
CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_one_settlement_per_invoice
  ON public.cash_entries (invoice_id)
  WHERE invoice_id IS NOT NULL;

COMMENT ON COLUMN public.cash_entries.invoice_id IS
  '[CASH-SETTLE] The invoice this cash movement settles (a "betaling" entry). Balance-only, never a cost.';
