-- [BANK-IBAN] Store the counterpart's IBAN on each bank transaction.
--
-- The bank parser already reads the counterpart's account number from the statement, but the
-- import discarded it. Keeping it lets the matcher pair a payment to the invoice that carries the
-- SAME supplier account (invoices.vendor_iban) — a strong, collision-free signal: a bare amount can
-- coincide across suppliers, a full IBAN cannot. With IBAN + exact amount a supplier payment
-- auto-confirms instead of waiting for a manual tap.
--
-- Safe + additive: one nullable text column, no data touched. The app writes it going forward
-- (existing rows stay null until re-imported); the code degrades gracefully if this isn't applied
-- yet (bank import retries without the column). An index for the matcher's IBAN lookups.

ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS counterpart_iban text;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_counterpart_iban
  ON public.bank_transactions (user_id, counterpart_iban) WHERE counterpart_iban IS NOT NULL;
