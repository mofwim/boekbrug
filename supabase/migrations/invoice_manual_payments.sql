-- =====================================================================
-- [MANUAL-PARTIAL-PAY] Recording a payment BY HAND — in full or in part.
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: the partial-payment engine (invoice_partial_payments.sql) could only ever be
-- reached from ONE place — /api/bank/confirm, i.e. an imported bank statement. A cash
-- payment out of the till, a customer who transfers €400 of €1.000 and tells you by
-- phone, a supplier paid before the statement arrives: none of it could be recorded as
-- what it is. The only manual control, /api/invoice/pay-toggle, was all-or-nothing, so
-- the owner had to either lie ("fully paid") or leave the invoice untouched. Both
-- produce a wrong openstaand, and under KASSTELSEL a wrong BTW-aangifte.
--
-- MODEL: a manual instalment is the same thing as a bank one — a row in
-- bank_tx_invoices carrying amount_applied — except it has no bank transaction behind
-- it. So transaction_id becomes NULLABLE and the row instead carries WHEN it was paid
-- (paid_on) and HOW (method: bank | kas). That keeps ONE derivation of the truth:
--
--     invoices.amount_paid = SUM(bank_tx_invoices.amount_applied)
--
-- which recompute_invoice_amount_paid already enforces on every unlink and undo. Had
-- manual money lived anywhere else, those existing reversal paths would have silently
-- wiped it.
--
-- IDEMPOTENCE: LEAST() clamps against over-payment but does NOT deduplicate — a double
-- tap or a retried POST would book the instalment twice. Every manual booking therefore
-- carries a client-generated key, unique per row, making a repeat a no-op.
--
-- APPLY: run this whole file in the Supabase SQL editor (one transaction).
-- Nothing here deletes data. Idempotent / re-runnable.
-- =====================================================================

BEGIN;

-- ── 1) A payment link no longer needs a bank transaction ─────────────
ALTER TABLE public.bank_tx_invoices
  ALTER COLUMN transaction_id DROP NOT NULL;

ALTER TABLE public.bank_tx_invoices
  ADD COLUMN IF NOT EXISTS paid_on date,
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS client_key uuid;

COMMENT ON COLUMN public.bank_tx_invoices.paid_on IS
  '[MANUAL-PARTIAL-PAY] The day a MANUAL instalment was paid. NULL for bank-linked rows, whose date comes from bank_transactions.date. Mandatory for manual rows (see the CHECK) because the kasstelsel aangifte needs a date per settlement — an undated payment would land in the wrong quarter.';
COMMENT ON COLUMN public.bank_tx_invoices.method IS
  '[MANUAL-PARTIAL-PAY] How a MANUAL instalment was paid: bank | kas. The kasboek reads the ''kas'' rows to know the cash portion of an invoice. NULL for bank-linked rows (bank by definition).';
COMMENT ON COLUMN public.bank_tx_invoices.client_key IS
  '[MANUAL-PARTIAL-PAY] Client-generated idempotency key for a manual booking. LEAST() clamps over-payment but does not deduplicate, so a double tap / retried POST would otherwise book twice.';

-- Method is constrained, but only where it is set (bank rows leave it NULL).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_tx_invoices_method_check') THEN
    ALTER TABLE public.bank_tx_invoices
      ADD CONSTRAINT bank_tx_invoices_method_check
      CHECK (method IS NULL OR method IN ('bank', 'kas'));
  END IF;
END $$;

-- Every row is either bank-linked or a dated manual one. Never neither: a row with no
-- transaction AND no date could not be placed in time, and would silently distort a
-- kasstelsel quarter.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_tx_invoices_origin_check') THEN
    ALTER TABLE public.bank_tx_invoices
      ADD CONSTRAINT bank_tx_invoices_origin_check
      CHECK (transaction_id IS NOT NULL OR paid_on IS NOT NULL);
  END IF;
END $$;

-- One row per idempotency key. Partial (only non-null keys) so the many bank rows,
-- which carry none, do not collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS bank_tx_invoices_client_key_unique
  ON public.bank_tx_invoices (client_key) WHERE client_key IS NOT NULL;

-- Reading an invoice's manual instalments (kasboek, undo, history) must not scan.
CREATE INDEX IF NOT EXISTS idx_bank_tx_invoices_manual
  ON public.bank_tx_invoices (invoice_id, method) WHERE transaction_id IS NULL;

-- NOTE on the pre-existing UNIQUE (transaction_id, invoice_id): in Postgres NULLs are
-- distinct, so every manual row (transaction_id NULL) is automatically exempt — several
-- instalments on the same invoice coexist. Bank rows keep their exact old guarantee.

-- ── 2) apply_manual_payment — atomic manual booking (full OR partial) ─
--    A literal sibling of apply_bank_payment (invoice_partial_payments.sql) minus the
--    bank-line mutex: same caller guard, same row lock, same refusals, the same
--    LEAST clamp, the same 1-cent epsilon for completion, and the same
--    coalesce(payment_date, …) so the FIRST instalment stamps the date.
--    Extra over its sibling:
--      · p_payable_statuses — the caller's PAYABLE list, re-checked UNDER the row lock,
--        so a status that changed between the API's read and this write cannot slip
--        through (an unverified 'processing' invoice must never reach the BTW figures).
--      · p_client_key — idempotency. A repeat returns the ALREADY-BOOKED state instead
--        of adding a second instalment.
CREATE OR REPLACE FUNCTION public.apply_manual_payment(
  p_user_id          uuid,
  p_invoice_id       uuid,
  p_amount           numeric,      -- NULL = settle the whole remaining balance
  p_pay_date         date,
  p_method           text,         -- 'bank' | 'kas'
  p_payable_statuses text[],
  p_client_key       uuid
)
RETURNS TABLE(applied numeric, amount_paid numeric, total numeric, is_paid boolean, duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_status  text;
  v_acc_status  text;
  v_total       numeric;
  v_paid        numeric;
  v_remaining   numeric;
  v_applied     numeric;
  v_now_paid    numeric;
  v_is_paid     boolean;
  v_existing    numeric;
  v_eps         numeric := 0.01;
BEGIN
  -- Caller guard: session client → auth.uid() = user; service-role → NULL (user-pinned
  -- by p_user_id). Reject a mismatched authenticated user.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] caller % may not book for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_method IS NULL OR p_method NOT IN ('bank', 'kas') THEN
    RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] payment method must be bank or kas' USING ERRCODE = '22023';
  END IF;
  IF p_pay_date IS NULL THEN
    RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] payment date is required' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NOT NULL AND p_amount <= 0 THEN
    RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] payment amount must be > 0' USING ERRCODE = '22023';
  END IF;

  -- IDEMPOTENCE: this exact booking already landed → report it, change nothing.
  IF p_client_key IS NOT NULL THEN
    SELECT bti.amount_applied INTO v_existing
    FROM public.bank_tx_invoices bti
    WHERE bti.client_key = p_client_key;
    IF FOUND THEN
      SELECT abs(coalesce(i.total_inc_btw, 0)), coalesce(i.amount_paid, 0), (i.status = 'paid')
        INTO v_total, v_now_paid, v_is_paid
      FROM public.invoices i WHERE i.id = p_invoice_id;
      RETURN QUERY SELECT coalesce(v_existing, 0), coalesce(v_now_paid, 0), coalesce(v_total, 0), coalesce(v_is_paid, false), true;
      RETURN;
    END IF;
  END IF;

  -- Lock + read the invoice under the lock. Ownership enforced (sender OR receiver).
  SELECT i.status, i.accountant_status, abs(coalesce(i.total_inc_btw, 0)), coalesce(i.amount_paid, 0)
    INTO v_inv_status, v_acc_status, v_total, v_paid
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] invoice not found / not owned' USING ERRCODE = '55000';
  END IF;
  IF v_inv_status = 'paid' THEN
    RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] invoice already fully paid' USING ERRCODE = '55000';
  END IF;
  IF v_acc_status = 'verwerkt' THEN
    RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] invoice locked by accountant (verwerkt)' USING ERRCODE = '55000';
  END IF;
  -- Race-proof mirror of the API's PAYABLE check: the status may have moved since the
  -- route read it (another tab confirming, an accountant, the auto-booker).
  IF p_payable_statuses IS NOT NULL
     AND array_length(p_payable_statuses, 1) IS NOT NULL
     AND NOT (v_inv_status = ANY (p_payable_statuses)) THEN
    RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] invoice status % is not payable', v_inv_status
      USING ERRCODE = '55000';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] invoice has no total to settle' USING ERRCODE = '55000';
  END IF;

  v_remaining := v_total - v_paid;
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] invoice already covered' USING ERRCODE = '55000';
  END IF;

  -- NULL amount = "the whole rest" (the empty field: the common case, zero keystrokes).
  -- Never over-pay: the excess of a too-large amount is simply not applied.
  v_applied  := LEAST(coalesce(p_amount, v_remaining), v_remaining);
  v_now_paid := v_paid + v_applied;
  v_is_paid  := v_now_paid >= v_total - v_eps;

  IF v_is_paid THEN
    UPDATE public.invoices
    SET amount_paid    = v_total,          -- clamp exactly to total on completion
        status         = 'paid',
        payment_method = p_method,
        marked_paid_at = now(),
        payment_date   = p_pay_date
    WHERE id = p_invoice_id;
  ELSE
    UPDATE public.invoices
    SET amount_paid  = v_now_paid,
        payment_date = coalesce(payment_date, p_pay_date)  -- first instalment stamps the date
    WHERE id = p_invoice_id;
  END IF;

  -- The instalment itself. transaction_id NULL = manual; paid_on carries its date so a
  -- kasstelsel quarter can place it, and method tells the kasboek whether it was cash.
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied, paid_on, method, client_key)
  VALUES (p_user_id, NULL, p_invoice_id, v_applied, p_pay_date, p_method, p_client_key);

  RETURN QUERY SELECT v_applied, v_now_paid, v_total, v_is_paid, false;
END;
$$;

COMMENT ON FUNCTION public.apply_manual_payment(uuid, uuid, numeric, date, text, text[], uuid) IS
  '[MANUAL-PARTIAL-PAY] Atomically records one manual payment (full or partial) on an invoice: applied = LEAST(amount ?? remaining, remaining); amount_paid advances; status flips to paid only when fully covered; writes a dated bank_tx_invoices row (transaction_id NULL, paid_on, method) so amount_paid stays SUM(amount_applied). Idempotent per client_key (duplicate=true, nothing written). Exception = invoice not payable / locked / not owned.';

REVOKE ALL ON FUNCTION public.apply_manual_payment(uuid, uuid, numeric, date, text, text[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_manual_payment(uuid, uuid, numeric, date, text, text[], uuid) TO authenticated, service_role;

COMMIT;
