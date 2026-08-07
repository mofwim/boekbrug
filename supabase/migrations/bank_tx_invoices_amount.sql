-- =====================================================================
-- [BETAALPLAN] CORRECTION — this migration adds nothing. It undoes a mistake.
-- BoekBrug · August 2026
-- =====================================================================
-- WHAT THIS FILE ORIGINALLY DID, AND WHY IT WAS WRONG
--
-- It added a column `bank_tx_invoices.amount` to record how much of a payment went to each
-- invoice, on the reasoning that without it a per-invoice unlink cannot give back the right
-- number. That reasoning is correct. The column was already there.
--
-- It is called `amount_applied`, it arrived with invoice_partial_payments.sql, and everything
-- already uses it:
--   · apply_bank_payment WRITES it (bank_confirm_atomic.sql), accumulating on conflict;
--   · it reads Σ amount_applied of the line's OTHER links UNDER the transaction lock, which is
--     the same sum guard payment-plan.ts performs in TypeScript — only atomically, and therefore
--     stronger;
--   · /api/bank/unlink READS it to reverse the exact amount, falling back to the transaction
--     magnitude only for pre-migration links;
--   · recompute_invoice_amount_paid derives invoices.amount_paid from Σ amount_applied.
--
-- So the new column was never read by anything, and worse, the code that wrote it also READ it
-- when working out how much of a payment was already spent. It was always NULL, which that code
-- treats as "this link settled its invoice in full" — so it added the invoice's whole total
-- instead. On any transaction with existing links the screen would then refuse perfectly valid
-- allocations, with a message about money that was never spent.
--
-- ── THE LESSON, WRITTEN DOWN BECAUSE IT WILL REPEAT ──
-- The gap was found by reading the join table's own migration, which does not mention
-- amount_applied — it was added later, by a different file. A schema is not one file, and
-- "the column is not there" is a claim about every migration, not about the one that created
-- the table. Grep the column name before adding it.
--
-- APPLY: safe whether or not the original version was ever run. If it was, this removes the dead
-- column. If it was not, this does nothing at all. No data is lost either way: nothing ever wrote
-- a value into it.
-- =====================================================================

BEGIN;

ALTER TABLE public.bank_tx_invoices DROP COLUMN IF EXISTS amount;
DROP INDEX IF EXISTS idx_bank_tx_invoices_tx_amount;

COMMENT ON COLUMN public.bank_tx_invoices.amount_applied IS
  '[PARTIAL-PAY] Euros of THIS transaction applied to THIS invoice. Written by apply_bank_payment / book_bank_batch, read by the unlink reversal and by recompute_invoice_amount_paid. NULL = a link from before the column existed, which settled its invoice in full.';

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
-- 1. The dead column is gone and the real one is intact:
--      select column_name from information_schema.columns
--       where table_name = 'bank_tx_invoices' order by column_name;
--    Expect: amount_applied, created_at, id, invoice_id, transaction_id, user_id — and NO 'amount'.
--
-- 2. The check that is actually worth keeping — payments whose allocation does not match the
--    money that moved. An empty result is the healthy state; anything listed is worth looking at
--    BEFORE a quarter is filed:
--      select t.id, t.amount as bank_line, sum(bti.amount_applied) as allocated
--        from public.bank_transactions t
--        join public.bank_tx_invoices bti on bti.transaction_id = t.id
--       where bti.amount_applied is not null
--       group by t.id, t.amount
--      having abs(abs(t.amount)) < abs(sum(bti.amount_applied)) - 0.01;
-- =====================================================================
