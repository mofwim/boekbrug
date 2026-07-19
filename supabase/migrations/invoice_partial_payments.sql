-- =====================================================================
-- [PARTIAL-PAY] Deelbetaling / instalments — an invoice paid across several
-- bank payments. Migration. BoekBrug · July 2026
-- =====================================================================
-- WHY: the model had NO partial-paid state — an invoice was either fully
-- 'paid' or unpaid. Linking a €400 payment to a €1000 invoice flipped it to
-- fully 'paid' (a WRONG NUMBER: €600 was still openstaand). Instalments were
-- only DETECTED ("lijkt een deelbetaling — controleer") and held, never
-- processed.
--
-- MODEL (minimal, correct, reversible):
--   · invoices.amount_paid       — running total actually settled (sum of the
--                                   amounts applied by each linked payment).
--   · bank_tx_invoices.amount_applied — how much of THAT payment was applied to
--                                   THAT invoice (so an unlink decrements by the
--                                   exact amount, never guesses).
--   Openstaand is derived as: status='paid' ? 0 : max(0, |total| − amount_paid).
--   So a FULLY-paid invoice reads 0 by status (its amount_paid is irrelevant),
--   and only a PARTIAL invoice (still open, amount_paid>0) needs the column —
--   which is exactly why the existing full-pay paths (auto-confirm, batch,
--   multi-confirm) need no change: they set status='paid' and openstaand is 0.
--   P&L / BTW are on accrual (invoice date), so partial payments never touch
--   omzet / voorbelasting / the aangifte — only the paid/openstaand view.
--
-- APPLY: run this whole file in the Supabase SQL editor (one transaction).
-- Nothing here deletes data. Idempotent / re-runnable.
-- =====================================================================

BEGIN;

-- ── 1) Columns ───────────────────────────────────────────────────────
--    amount_paid: NOT NULL default 0 so every existing + future row has a
--    concrete number (openstaand math never meets NULL). Stored as the same
--    sign-free magnitude as |total_inc_btw| (a creditnota's negative total is
--    handled by the app via abs()).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.invoices.amount_paid IS
  '[PARTIAL-PAY] Running total settled against this invoice (magnitude). Openstaand = status=paid ? 0 : max(0, abs(total_inc_btw) - amount_paid). Maintained by apply_bank_payment / book_bank_batch and decremented on unlink.';

--    amount_applied: how much of one payment landed on one invoice. Nullable
--    (older rows predate it; the unlink path falls back to the tx amount when
--    NULL). New writes always set it.
ALTER TABLE public.bank_tx_invoices
  ADD COLUMN IF NOT EXISTS amount_applied numeric;

COMMENT ON COLUMN public.bank_tx_invoices.amount_applied IS
  '[PARTIAL-PAY] Amount of this transaction applied to this invoice. Sum over an invoice''s links = invoices.amount_paid. NULL on pre-migration rows (unlink then falls back to abs(tx.amount)).';

-- ── 2) Backfill ──────────────────────────────────────────────────────
--    Every invoice ALREADY 'paid' is, by definition, fully settled → its
--    amount_paid is its own magnitude. Unpaid invoices stay 0. Idempotent:
--    the WHERE keeps it a no-op on re-run (only lifts 0 → magnitude).
UPDATE public.invoices
SET amount_paid = abs(coalesce(total_inc_btw, 0))
WHERE status = 'paid'
  AND amount_paid = 0
  AND coalesce(total_inc_btw, 0) <> 0;

--    Existing links carried no per-link amount. Each was a FULL settlement of
--    its invoice (1:1 or a batch line that paid that invoice in full), so the
--    applied amount is that invoice's magnitude. Only fill NULLs (idempotent).
UPDATE public.bank_tx_invoices bti
SET amount_applied = abs(coalesce(i.total_inc_btw, 0))
FROM public.invoices i
WHERE bti.invoice_id = i.id
  AND bti.amount_applied IS NULL;

-- ── 3) apply_bank_payment — atomic single-invoice (full OR partial) booking ──
--    The write path for /api/bank/confirm's single-invoice case. Locks the
--    invoice + tx, applies LEAST(payment, remaining) so an invoice is NEVER
--    over-paid, flips to 'paid' ONLY when fully covered, links the tx, and
--    records the exact per-link amount — all in ONE transaction (all-or-
--    nothing). Mirrors book_bank_batch's discipline (mutex + re-verify under
--    lock + reversible + verwerkt guard).
CREATE OR REPLACE FUNCTION public.apply_bank_payment(
  p_user_id   uuid,
  p_tx_id     uuid,
  p_invoice_id uuid,
  p_amount    numeric,   -- the payment magnitude (abs of the bank line)
  p_pay_date  date
)
RETURNS TABLE(applied numeric, amount_paid numeric, total numeric, is_paid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_status   text;
  v_inv_status  text;
  v_acc_status  text;
  v_total       numeric;
  v_paid        numeric;
  v_remaining   numeric;
  v_applied     numeric;
  v_now_paid    numeric;
  v_is_paid     boolean;
  -- One cent of slack: floating totals from OCR/xlsx can be a rounding tick
  -- short of the payment. Covered-within-a-cent counts as fully paid.
  v_eps         numeric := 0.01;
BEGIN
  -- Caller guard (same contract as book_bank_batch): session client → auth.uid()
  -- = user; service-role → NULL (user-pinned by p_user_id). Reject a mismatched
  -- authenticated user.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[PARTIAL-PAY] caller % may not book for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION '[PARTIAL-PAY] payment amount must be > 0' USING ERRCODE = '22023';
  END IF;

  -- MUTEX on the bank line — a concurrent booker for the same tx blocks here and,
  -- after we commit, sees status <> 'pending' → returns empty (caller skips).
  SELECT status INTO v_tx_status
  FROM public.bank_transactions
  WHERE id = p_tx_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_tx_status IS DISTINCT FROM 'pending' THEN
    RETURN;   -- already claimed / not ours → empty result
  END IF;

  -- Lock + read the invoice under the lock (its amount_paid/status can't change
  -- beneath us). Ownership enforced (sender OR receiver = caller).
  SELECT i.status, i.accountant_status, abs(coalesce(i.total_inc_btw, 0)), coalesce(i.amount_paid, 0)
    INTO v_inv_status, v_acc_status, v_total, v_paid
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[PARTIAL-PAY] invoice not found / not owned' USING ERRCODE = '55000';
  END IF;
  IF v_inv_status = 'paid' THEN
    RAISE EXCEPTION '[PARTIAL-PAY] invoice already fully paid' USING ERRCODE = '55000';
  END IF;
  IF v_acc_status = 'verwerkt' THEN
    RAISE EXCEPTION '[PARTIAL-PAY] invoice locked by accountant (verwerkt)' USING ERRCODE = '55000';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION '[PARTIAL-PAY] invoice has no total to settle' USING ERRCODE = '55000';
  END IF;

  -- Apply at most the remaining balance — an invoice is NEVER over-paid, so any
  -- excess in the payment simply isn't applied to this invoice.
  v_remaining := v_total - v_paid;
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION '[PARTIAL-PAY] invoice already covered' USING ERRCODE = '55000';
  END IF;
  v_applied  := LEAST(p_amount, v_remaining);
  v_now_paid := v_paid + v_applied;
  v_is_paid  := v_now_paid >= v_total - v_eps;

  -- Write the invoice: amount_paid always advances; status flips to 'paid' ONLY
  -- when fully covered (else it stays whatever open state it was — still openstaand).
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
        payment_date = coalesce(payment_date, p_pay_date)  -- first instalment stamps the date
    WHERE id = p_invoice_id;
  END IF;

  -- Link the bank line. The whole payment is allocated to this one invoice
  -- (instalment semantics: one tx → one invoice), so the tx is fully consumed.
  UPDATE public.bank_transactions
  SET status = 'matched', invoice_id = p_invoice_id
  WHERE id = p_tx_id AND user_id = p_user_id;

  -- Record the exact per-link amount (reversal index; unlink decrements by this).
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (p_user_id, p_tx_id, p_invoice_id, v_applied)
  ON CONFLICT (transaction_id, invoice_id)
  DO UPDATE SET amount_applied = coalesce(public.bank_tx_invoices.amount_applied, 0) + v_applied;

  RETURN QUERY SELECT v_applied, v_now_paid, v_total, v_is_paid;
END;
$$;

COMMENT ON FUNCTION public.apply_bank_payment(uuid, uuid, uuid, numeric, date) IS
  '[PARTIAL-PAY] Atomically applies one bank payment to one invoice: applied=LEAST(payment, remaining); amount_paid advances; status→paid only when fully covered; links the tx (matched); records bank_tx_invoices.amount_applied. Empty result = tx already claimed. Exception = invoice not payable.';

REVOKE ALL ON FUNCTION public.apply_bank_payment(uuid, uuid, uuid, numeric, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_bank_payment(uuid, uuid, uuid, numeric, date) TO authenticated, service_role;

-- ── 4) recompute_invoice_amount_paid — atomic, drift-free reversal helper ─────
--    The unlink paths remove a payment link, then call this to re-derive
--    amount_paid = SUM(amount_applied) over the invoice's SURVIVING links, under
--    a row lock. This is the authoritative reconciliation of amount_paid to the
--    join table: it is order-independent (two concurrent unlinks each recompute
--    under the lock and both converge on the true remaining sum — no lost-update
--    phantom), and self-healing (a batch unlink that clears every link recomputes
--    to 0, so a pre-migration batch invoice never stays stuck at amount_paid=|total|,
--    which would read €0-openstaand and block re-booking). Clamped to [0, |total|].
--    Call it AFTER the link rows are cleared. Returns the new amount_paid.
CREATE OR REPLACE FUNCTION public.recompute_invoice_amount_paid(
  p_user_id    uuid,
  p_invoice_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_sum   numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[PARTIAL-PAY] caller % may not recompute for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- Lock the invoice; a concurrent apply/recompute serializes on this row.
  SELECT abs(coalesce(total_inc_btw, 0)) INTO v_total
  FROM public.invoices
  WHERE id = p_invoice_id
    AND (sender_id = p_user_id OR receiver_id = p_user_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;   -- not ours / gone → nothing to do
  END IF;

  SELECT coalesce(sum(coalesce(amount_applied, 0)), 0) INTO v_sum
  FROM public.bank_tx_invoices
  WHERE invoice_id = p_invoice_id AND user_id = p_user_id;

  -- Never let the running total exceed the invoice magnitude (defence in depth).
  IF v_total > 0 AND v_sum > v_total THEN
    v_sum := v_total;
  END IF;
  IF v_sum < 0 THEN
    v_sum := 0;
  END IF;

  UPDATE public.invoices SET amount_paid = v_sum WHERE id = p_invoice_id;
  RETURN v_sum;
END;
$$;

COMMENT ON FUNCTION public.recompute_invoice_amount_paid(uuid, uuid) IS
  '[PARTIAL-PAY] Atomically re-derives invoices.amount_paid = SUM(bank_tx_invoices.amount_applied) for an invoice under a row lock. Called by the unlink paths after clearing link rows — order-independent (no concurrent-unlink lost-update) and self-healing (fully-unlinked → 0).';

REVOKE ALL ON FUNCTION public.recompute_invoice_amount_paid(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_invoice_amount_paid(uuid, uuid) TO authenticated, service_role;

COMMIT;
