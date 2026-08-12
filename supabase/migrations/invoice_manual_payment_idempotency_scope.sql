-- =====================================================================
-- [PAY-KEY-SCOPE] apply_manual_payment's idempotency branch read a stranger's invoice.
-- BoekBrug · August 2026
-- =====================================================================
-- THE BUG. Every other read in this function is scoped to the caller: the main path locks the
-- invoice with `AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)` and refuses when it
-- finds nothing. The idempotency branch, fifteen lines above it, did neither. It looked the
-- client_key up with no owner and no invoice, and then read totals with
--
--     FROM public.invoices i WHERE i.id = p_invoice_id
--
-- and returned them. So the shortcut that exists to make a RETRY cheap was also the one read in
-- the function nobody owned.
--
-- REACHABLE, not theoretical. The function is SECURITY DEFINER and GRANTed to `authenticated`,
-- so it answers at /rest/v1/rpc/apply_manual_payment with the anon key that ships in the browser
-- bundle — the exact door the caller guard at the top of the function was written for. A logged-in
-- attacker passes their OWN p_user_id (the guard is satisfied), their OWN client_key from any
-- earlier booking (they generated it), and a STRANGER's p_invoice_id. FOUND is true, the unscoped
-- read runs, and back come that invoice's total_inc_btw, amount_paid and paid state.
--
-- Reproduced against a real PostgreSQL 16 before this was written: attacker key + victim invoice
-- returned total=8450.75, amount_paid=3200.50, duplicate=true.
--
-- No money moves — the write paths were always owner-scoped — but a competitor learns what a
-- supplier invoices and how much of it is still open, which is the kind of thing a bookkeeping
-- app is trusted to hold. The tenant boundary is the product.
--
-- THE FIX, in three parts:
--
--  1. The key lookup is scoped to (client_key, user_id, invoice_id). A retry of the SAME booking
--     matches all three by construction: pay-toggle sends the browser's own key back with the same
--     invoice, and the auto-incasso key is sha256('auto-incasso:' || invoice_id || ':' || paid_on)
--     — derived FROM the invoice, so it cannot legitimately point at another one. Only the
--     receiver of an incoming invoice reaches that pass (incasso-settle.ts scopes on receiver_id),
--     so p_user_id is fixed per invoice there too.
--
--  2. The invoice read carries the same ownership predicate as the main path, and a miss now
--     RAISES instead of returning zeros. A booking whose invoice the caller does not own is not a
--     duplicate to report — it is a question that must not be answered.
--
--  3. A key that exists but belongs to a different booking is REFUSED by name. Without part 3 it
--     would fall through to the main path and die on the partial unique index with a bare 23505
--     the caller cannot read. That key was already spent on other money; saying so is the whole
--     point of an idempotency key.
--
-- Note that part 1 alone closes the leak — the fall-through is owner-checked. Parts 2 and 3 exist
-- because a second reader of this function should not have to prove that again.
--
-- CREATE OR REPLACE of the whole function, the codebase's convention for an RPC fix (precedent:
-- invoice_payment_date_rederive.sql, invoice_move_payment_creditnota_guard.sql). Every line
-- outside the idempotency branch is byte-identical to invoice_manual_payments.sql.
--
-- APPLY: run this whole file in the Supabase SQL editor (one transaction).
-- Nothing here deletes data. Idempotent / re-runnable.
-- =====================================================================

BEGIN;

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
  v_key_taken   boolean;
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
  --
  -- [PAY-KEY-SCOPE] "This exact booking" means all three of key, caller and invoice. The key alone
  -- named a row anyone could point anywhere; see the header.
  IF p_client_key IS NOT NULL THEN
    SELECT bti.amount_applied INTO v_existing
    FROM public.bank_tx_invoices bti
    WHERE bti.client_key = p_client_key
      AND bti.user_id    = p_user_id
      AND bti.invoice_id = p_invoice_id;
    IF FOUND THEN
      -- Same ownership predicate as the locking read below. A replay is still a read of an
      -- invoice, and it is answered only to someone entitled to the answer.
      SELECT abs(coalesce(i.total_inc_btw, 0)), coalesce(i.amount_paid, 0), (i.status = 'paid')
        INTO v_total, v_now_paid, v_is_paid
      FROM public.invoices i
      WHERE i.id = p_invoice_id
        AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id);
      IF NOT FOUND THEN
        RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] invoice not found / not owned' USING ERRCODE = '55000';
      END IF;
      RETURN QUERY SELECT coalesce(v_existing, 0), coalesce(v_now_paid, 0), coalesce(v_total, 0), coalesce(v_is_paid, false), true;
      RETURN;
    END IF;

    -- The key exists, but on another invoice or for another caller: not a replay of THIS booking.
    -- Falling through would hit the partial unique index on client_key and surface as a bare
    -- 23505; a key that was already spent on other money is worth saying out loud.
    SELECT true INTO v_key_taken
    FROM public.bank_tx_invoices bti WHERE bti.client_key = p_client_key LIMIT 1;
    IF FOUND THEN
      -- Worded to avoid the word "already" on purpose. incasso-settle.ts triages this function's
      -- errors by substring and treats anything containing "already" as a benign
      -- already-paid/already-covered, logging nothing. A refusal that means the booking did NOT
      -- happen must never land in that branch.
      RAISE EXCEPTION '[MANUAL-PARTIAL-PAY] idempotency key belongs to a different booking'
        USING ERRCODE = '55000';
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
  '[MANUAL-PARTIAL-PAY] Atomically records one manual payment (full or partial) on an invoice: applied = LEAST(amount ?? remaining, remaining); amount_paid advances; status flips to paid only when fully covered; writes a dated bank_tx_invoices row (transaction_id NULL, paid_on, method) so amount_paid stays SUM(amount_applied). Idempotent per (client_key, user_id, invoice_id) — a replay of the SAME booking returns duplicate=true and writes nothing; a key already spent on another booking is refused. [PAY-KEY-SCOPE] Every read is owner-scoped, the replay shortcut included. Exception = invoice not payable / locked / not owned.';

COMMIT;
