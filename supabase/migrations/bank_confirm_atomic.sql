-- =====================================================================
-- [BANK-CONFIRM-ATOMIC] Atomic single-invoice confirm — the whole money
-- decision under one lock. Migration. BoekBrug · July 2026
-- =====================================================================
-- WHY (1): /api/bank/confirm's OVERPAY branch (payment larger than the
-- invoice's open balance) ran as separate statements: read the sibling
-- links, pay the invoice, write the link, decide coverage. Two overlapping
-- confirms of DIFFERENT invoices against the SAME bank line could each read
-- the links before either had written — both believed they had the full
-- line to spend, and Σ amount_applied ended ABOVE the line's own amount:
-- the same euros booked twice. The app-side [BANK-OVERAPPLIED-LOUD]
-- detector made that state impossible to miss; this function makes it
-- impossible to reach. The fits-inside case already had its atomic path
-- (apply_bank_payment); this closes the other half by deciding WHICH case
-- applies under the same lock the booking then uses.
--
-- WHY (2): book_bank_batch re-verified payability under its lock but NOT
-- the cent-exact tie itself. A concurrent instalment landing between the
-- caller's plan and the lock could shrink an invoice's open balance, and
-- the batch then booked amounts that no longer summed to the bank line.
-- The tie is the batch's entire justification — it is now re-proven under
-- the lock, and a broken tie aborts the whole batch (stays for the human).
--
-- MODEL — confirm_bank_payment(user, tx, invoice, pay_date):
--   · locks the bank line (mutex; concurrent booker gets an empty result),
--   · locks the invoice, re-verifies payable (owned, unpaid, not verwerkt),
--   · reads Σ amount_applied of the line's OTHER links UNDER the tx lock,
--   · derives available = |tx| − elsewhere  (nothing left → exception),
--   ·          applied  = LEAST(available, open balance of the invoice),
--   · pays the invoice (fully when covered within the cent, else instalment),
--   · upserts the join row (+= applied), and
--   · flips the tx to 'matched' ONLY when every euro of the line is booked;
--     otherwise the line stays 'pending' with invoice_id recorded, exactly
--     like the app path it replaces.
--   Returns every figure the route needs to answer honestly (applied,
--   amount_paid, total, is_paid, all_covered, line_remaining).
--
-- APPLY: run this whole file in the Supabase SQL editor (one transaction).
-- Nothing here deletes data. Idempotent / re-runnable (CREATE OR REPLACE).
-- The CODE that calls confirm_bank_payment degrades safely if this is not
-- yet applied (undefined function → the route takes its previous multi-
-- statement path, which keeps the loud over-application detector), so there
-- is no hard ordering requirement — but apply this to close the race.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_bank_payment(
  p_user_id    uuid,
  p_tx_id      uuid,
  p_invoice_id uuid,
  p_pay_date   date
)
RETURNS TABLE(
  applied        numeric,
  amount_paid    numeric,
  total          numeric,
  is_paid        boolean,
  all_covered    boolean,
  line_remaining numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_status  text;
  v_tx_amount  numeric;
  v_inv_status text;
  v_acc_status text;
  v_total      numeric;
  v_paid       numeric;
  v_open       numeric;
  v_elsewhere  numeric;
  v_available  numeric;
  v_applied    numeric;
  v_now_paid   numeric;
  v_is_paid    boolean;
  v_line_rest  numeric;
  -- One cent of slack, same as apply_bank_payment: floating totals from
  -- OCR/xlsx can be a rounding tick short. Covered-within-a-cent counts.
  v_eps        numeric := 0.01;
BEGIN
  -- Caller guard (same contract as apply_bank_payment / book_bank_batch):
  -- session client → auth.uid() = user; service-role → NULL (user-pinned by
  -- p_user_id). Reject a mismatched authenticated user.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[BANK-CONFIRM] caller % may not book for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- MUTEX on the bank line. Every path that spends this line's money
  -- (apply_bank_payment, book_bank_batch, this function) takes this lock
  -- first, so the sibling-links sum below cannot change beneath us.
  SELECT status, abs(coalesce(amount, 0)) INTO v_tx_status, v_tx_amount
  FROM public.bank_transactions
  WHERE id = p_tx_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_tx_status IS DISTINCT FROM 'pending' THEN
    RETURN;   -- already claimed / not ours → empty result (caller answers 409)
  END IF;
  IF v_tx_amount <= 0 THEN
    RAISE EXCEPTION '[BANK-CONFIRM] transaction has no amount to spend' USING ERRCODE = '55000';
  END IF;

  -- Lock + re-verify the invoice under the lock.
  SELECT i.status, i.accountant_status, abs(coalesce(i.total_inc_btw, 0)), coalesce(i.amount_paid, 0)
    INTO v_inv_status, v_acc_status, v_total, v_paid
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[BANK-CONFIRM] invoice not found / not owned' USING ERRCODE = '55000';
  END IF;
  IF v_inv_status = 'paid' THEN
    RAISE EXCEPTION '[BANK-CONFIRM] invoice already fully paid' USING ERRCODE = '55000';
  END IF;
  IF v_acc_status = 'verwerkt' THEN
    RAISE EXCEPTION '[BANK-CONFIRM] invoice locked by accountant (verwerkt)' USING ERRCODE = '55000';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION '[BANK-CONFIRM] invoice has no total to settle' USING ERRCODE = '55000';
  END IF;

  v_open := v_total - v_paid;
  IF v_open <= 0 THEN
    RAISE EXCEPTION '[BANK-CONFIRM] invoice already covered' USING ERRCODE = '55000';
  END IF;

  -- What this line already gave to OTHER invoices — read under the tx lock,
  -- so it is exact, not a snapshot a concurrent confirm can invalidate.
  SELECT coalesce(sum(coalesce(amount_applied, 0)), 0) INTO v_elsewhere
  FROM public.bank_tx_invoices
  WHERE transaction_id = p_tx_id AND user_id = p_user_id
    AND invoice_id <> p_invoice_id;

  v_available := v_tx_amount - v_elsewhere;
  IF v_available <= v_eps THEN
    RAISE EXCEPTION '[BANK-CONFIRM] payment fully applied' USING ERRCODE = '55000';
  END IF;

  -- The single money decision, under both locks: give this invoice what the
  -- line still has, capped at what the invoice can absorb.
  v_applied  := LEAST(v_available, v_open);
  v_now_paid := v_paid + v_applied;
  v_is_paid  := v_now_paid >= v_total - v_eps;

  IF v_is_paid THEN
    UPDATE public.invoices
    SET amount_paid    = v_total,          -- clamp exactly to total on completion
        status         = 'paid',
        payment_method = 'bank',
        marked_paid_at = now(),
        payment_date   = p_pay_date
    WHERE id = p_invoice_id;
  ELSE
    UPDATE public.invoices
    SET amount_paid  = v_now_paid,
        payment_date = coalesce(payment_date, p_pay_date)
    WHERE id = p_invoice_id;
  END IF;

  -- Reversal index, exact per-link amount (unlink decrements by this).
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (p_user_id, p_tx_id, p_invoice_id, v_applied)
  ON CONFLICT (transaction_id, invoice_id)
  DO UPDATE SET amount_applied = coalesce(public.bank_tx_invoices.amount_applied, 0) + v_applied;

  -- Is the LINE finished? Same cent rule as bankLineFullyApplied app-side.
  v_line_rest := v_tx_amount - (v_elsewhere + v_applied);
  IF v_line_rest <= v_eps THEN
    UPDATE public.bank_transactions
    SET status = 'matched', invoice_id = p_invoice_id
    WHERE id = p_tx_id AND user_id = p_user_id;
  ELSE
    -- Money of this line is still unassigned: keep it 'pending' (visible,
    -- actionable) and record the most recent invoice — the same shape the
    -- app's multi-confirm flow has always written.
    UPDATE public.bank_transactions
    SET invoice_id = p_invoice_id
    WHERE id = p_tx_id AND user_id = p_user_id;
  END IF;

  RETURN QUERY SELECT v_applied, v_now_paid, v_total, v_is_paid,
                      (v_line_rest <= v_eps), GREATEST(0, v_line_rest);
END;
$$;

COMMENT ON FUNCTION public.confirm_bank_payment(uuid, uuid, uuid, date) IS
  '[BANK-CONFIRM-ATOMIC] The whole confirm decision under one lock: available = |tx| − Σ(other links), applied = LEAST(available, invoice open); pays (fully or as instalment), upserts the join row, flips the tx to matched only when the line is spent to the cent. Empty result = tx already claimed. Exceptions (55000): not payable / already covered / payment fully applied. Closes the concurrent-confirm race that could over-apply a line.';

REVOKE ALL ON FUNCTION public.confirm_bank_payment(uuid, uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_bank_payment(uuid, uuid, uuid, date) TO authenticated, service_role;

-- ── book_bank_batch: re-prove the TIE under the lock ─────────────────
-- Identical to the existing function plus one guard: after payability is
-- re-verified, the sum of the invoices' OPEN balances must still equal the
-- bank line to the cent. A concurrent instalment that shrank any member's
-- open balance between the caller's plan and this lock breaks the tie —
-- the batch's entire justification — so the whole batch aborts and stays
-- for the human. (Numeric is exact in Postgres; no float lottery here.)
CREATE OR REPLACE FUNCTION public.book_bank_batch(
  p_user_id     uuid,
  p_tx_id       uuid,
  p_invoice_ids uuid[],
  p_pay_date    date
)
RETURNS TABLE(invoice_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_status text;
  v_tx_amount numeric;
  v_sum_open  numeric;
  v_rep       uuid;
  v_bad       int;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[BANK-BATCH] caller % may not book for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_invoice_ids IS NULL OR array_length(p_invoice_ids, 1) IS NULL THEN
    RAISE EXCEPTION '[BANK-BATCH] no invoices supplied' USING ERRCODE = '22023';
  END IF;

  -- (1) MUTEX — lock the bank line (see the original migration's note on
  --     isolation levels; the empty-return contract is unchanged).
  SELECT status, abs(coalesce(amount, 0)) INTO v_tx_status, v_tx_amount
  FROM public.bank_transactions
  WHERE id = p_tx_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_tx_status IS DISTINCT FROM 'pending' THEN
    RETURN;
  END IF;

  -- (2) Lock every invoice in deterministic order, then re-verify payability
  --     under the lock (unchanged from the original).
  PERFORM 1
  FROM public.invoices
  WHERE id = ANY (p_invoice_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT count(*) INTO v_bad
  FROM unnest(p_invoice_ids) AS want(id)
  LEFT JOIN public.invoices i
    ON i.id = want.id
   AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)
  WHERE i.id IS NULL
     OR i.status = 'paid'
     OR i.accountant_status = 'verwerkt';

  IF v_bad > 0 THEN
    RAISE EXCEPTION '[BANK-BATCH] % invoice(s) no longer payable — batch aborted', v_bad
      USING ERRCODE = '55000';
  END IF;

  -- (2b) [BANK-BATCH-TIE-LOCKED] Re-prove the cent-exact tie on the CURRENT
  --      open balances, under the lock. The caller planned against a snapshot;
  --      if an instalment landed since, these amounts no longer sum to the
  --      line and booking them would settle invoices with money that is not
  --      there. A broken tie aborts everything — nothing half-books.
  SELECT coalesce(sum(GREATEST(0, abs(coalesce(i.total_inc_btw, 0)) - coalesce(i.amount_paid, 0))), 0)
    INTO v_sum_open
  FROM unnest(p_invoice_ids) AS ids(id)
  JOIN public.invoices i ON i.id = ids.id;

  IF abs(v_sum_open - v_tx_amount) > 0.01 THEN
    RAISE EXCEPTION '[BANK-BATCH] tie no longer exact (open sum % vs line %) — batch aborted',
      v_sum_open, v_tx_amount USING ERRCODE = '55000';
  END IF;

  -- (3) Join rows with the amount applied (still-open balance, pre-update).
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  SELECT p_user_id, p_tx_id, i.id,
         GREATEST(0, abs(coalesce(i.total_inc_btw, 0)) - coalesce(i.amount_paid, 0))
  FROM unnest(p_invoice_ids) AS ids(id)
  JOIN public.invoices i ON i.id = ids.id
  ON CONFLICT (transaction_id, invoice_id) DO NOTHING;

  -- (4) Pay every invoice in full.
  UPDATE public.invoices
  SET status         = 'paid',
      payment_method = 'bank',
      marked_paid_at = now(),
      payment_date   = p_pay_date,
      amount_paid    = abs(coalesce(total_inc_btw, 0))
  WHERE id = ANY (p_invoice_ids);

  -- (5) Link the bank line → matched, representative invoice_id.
  v_rep := p_invoice_ids[array_upper(p_invoice_ids, 1)];
  UPDATE public.bank_transactions
  SET status = 'matched', invoice_id = v_rep
  WHERE id = p_tx_id AND user_id = p_user_id;

  RETURN QUERY SELECT ids.id FROM unnest(p_invoice_ids) AS ids(id);
END;
$$;

COMMENT ON FUNCTION public.book_bank_batch(uuid, uuid, uuid[], date) IS
  '[BANK-BATCH-ATOMIC] Atomically books one multi-invoice batch tie: locks the bank line (mutex), re-verifies every invoice is still unpaid + not verwerkt under the lock, RE-PROVES the cent-exact tie on the current open balances ([BANK-BATCH-TIE-LOCKED]), records bank_tx_invoices join rows with amount_applied = the still-open balance (pre-update), pays them all, and links the tx — all-or-nothing. Empty result = tx already claimed (skip). Exception = an invoice turned unpayable or the tie broke (whole batch rolled back).';

REVOKE ALL ON FUNCTION public.book_bank_batch(uuid, uuid, uuid[], date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_bank_batch(uuid, uuid, uuid[], date) TO authenticated, service_role;

COMMIT;
