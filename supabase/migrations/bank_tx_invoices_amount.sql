-- =====================================================================
-- [BETAALPLAN] How MUCH of a payment went to each invoice.
-- BoekBrug · August 2026
-- =====================================================================
-- bank_tx_invoices already records WHICH invoices a bank payment settled — that is what makes a
-- reversal safe by id instead of by invoice number. What it never recorded is HOW MUCH went to
-- each one, because until now a link only ever meant "this payment settled this invoice in full".
--
-- That assumption breaks the moment a real batch arrives. A wholesaler debits €5.000 for a week of
-- deliveries and the last invoice is short-paid by €200. A supplier deducts a €150 creditnota
-- before paying. Both are ordinary, and neither can be expressed by a link with no amount on it.
--
-- ── WHY THE COLUMN MATTERS FOR THE REVERSAL, NOT ONLY THE BOOKING ──
--
-- Booking a partial allocation without storing it is survivable — invoices.amount_paid carries the
-- result. UNDOING it is not. To detach one invoice from a batch you have to give back exactly what
-- that invoice received, and if the link does not say, the only options are to guess (give back the
-- invoice's full total, un-paying money that is still gone) or to refuse. The first is a wrong
-- number in someone's BTW return; the second is a button that does not work.
--
-- So the amount is stored on the link that caused it, signed, with the creditnota's minus intact:
-- a €1.000 invoice and a −€150 creditnota against one €850 debit reverse to exactly the two figures
-- that were booked.
--
-- ── NULL IS NOT ZERO HERE EITHER ──
--
-- Rows written before this migration have no amount and get NULL, not 0. NULL means "this link
-- predates the column and settled its invoice in full" — which is what every old link meant by
-- construction. Defaulting them to 0 would tell every reversal path that these payments moved no
-- money at all, silently turning the entire payment history into unpaid invoices.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- Depends on bank_tx_invoices.sql.
-- =====================================================================

BEGIN;

ALTER TABLE public.bank_tx_invoices
  ADD COLUMN IF NOT EXISTS amount numeric;

COMMENT ON COLUMN public.bank_tx_invoices.amount IS
  '[BETAALPLAN] Signed euros of THIS transaction applied to THIS invoice (negative for a creditnota). NULL = a link written before this column existed, which by construction settled its invoice in full.';

-- The plan is written as one batch per transaction, so reversal and re-booking both read every
-- line of a payment at once.
CREATE INDEX IF NOT EXISTS idx_bank_tx_invoices_tx_amount
  ON public.bank_tx_invoices (transaction_id) INCLUDE (invoice_id, amount);

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
-- 1. The column is there and old rows are NULL, not 0:
--      select count(*) filter (where amount is null)  as pre_migration_links,
--             count(*) filter (where amount is not null) as with_amount
--        from public.bank_tx_invoices;
--
-- 2. After booking a batch from the bank screen, its lines add up to the payment:
--      select t.id, t.amount as bank_line, sum(bti.amount) as allocated
--        from public.bank_transactions t
--        join public.bank_tx_invoices bti on bti.transaction_id = t.id
--       where bti.amount is not null
--       group by t.id, t.amount
--      having abs(abs(t.amount) - abs(sum(bti.amount))) > 0.01;
--    Rows here are payments whose allocation does not match the money that moved. An empty
--    result is the healthy state; anything listed is worth looking at BEFORE a quarter is filed.
-- =====================================================================
