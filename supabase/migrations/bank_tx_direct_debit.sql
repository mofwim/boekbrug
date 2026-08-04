-- [DD-SIGNAL] What the bank statement itself says about the instrument.
--
-- Every Dutch export format names an automatische incasso, and the app was reading past all of
-- them. Three columns, because the statement gives three different kinds of answer:
--
--   · type_code   — the bank's own classification. MT940 puts a four-character SWIFT code at the
--                   end of the :61: line (NDDT = Direct Debit); CAMT has <BkTxCd> (family RDDT,
--                   sub-family ESDD); ING's CSV has a `Code` column whose value is literally "IC"
--                   and a `Mutatiesoort` column whose value is "Incasso".
--   · mandate_id  — the machtigingskenmerk. The strongest signal there is: a SEPA direct debit
--                   cannot exist without a mandate, and a credit transfer never carries one.
--                   CAMT has <MndtId>; Rabobank gives it its own CSV column.
--   · creditor_id — the incassant-ID of the collecting party (NL + 2 + ZZZ + 12). CAMT has
--                   <CdtrSchmeId>; Rabobank has a column; ABN AMRO writes it into the description.
--
-- Kept RAW, never a stored verdict. The rule that turns these into "this was a collection" lives
-- in src/lib/direct-debit.ts, so it stays in one place and a row cannot disagree with it — which
-- matters most for the case that costs money: the same markers appear on a STORNO, where the money
-- came back and the invoice is not paid at all. Only the sign tells those two apart.
--
-- FAIL-SOFT, and that is not decoration here. bank-ingest already catches 42703 (undefined_column)
-- on its insert and retries without the newer columns, because a failed insert is not a degraded
-- hint — it is money that silently never arrives. These three ride that same path.

BEGIN;

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS type_code text,
  ADD COLUMN IF NOT EXISTS mandate_id text,
  ADD COLUMN IF NOT EXISTS creditor_id text;

-- The question asked of this table is "which suppliers collect from me by mandate?", answered per
-- owner over the lines that carry any marker at all. Partial, so the index holds the direct debits
-- rather than every transaction in the book.
CREATE INDEX IF NOT EXISTS idx_bank_tx_direct_debit
  ON public.bank_transactions (user_id, date)
  WHERE mandate_id IS NOT NULL OR creditor_id IS NOT NULL OR type_code IS NOT NULL;

-- [AUTO-INCASSO] When the app last offered the mandate for this supplier.
--
-- The proposal is made from evidence in the statement, and it must be made ONCE. Without this the
-- hourly reconcile would offer the same supplier every hour for as long as the owner has not
-- answered — and a notification that repeats is a notification that gets turned off, taking the
-- ones that matter with it.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS incasso_suggested_at timestamptz;

COMMENT ON COLUMN public.bank_transactions.mandate_id IS
  '[DD-SIGNAL] Machtigingskenmerk from the statement (CAMT <MndtId>, Rabobank column, or an ABN description). Its presence is proof the line was a SEPA direct debit; the DIRECTION still decides whether it was a collection or a storno. See src/lib/direct-debit.ts.';
COMMENT ON COLUMN public.suppliers.incasso_suggested_at IS
  '[AUTO-INCASSO] When the app last offered to remember this supplier as collecting automatically. Set so the offer is made once, never every hour.';

COMMIT;
