-- =====================================================================
-- [BETAALPLAN] allocate_bank_payment — an AMOUNT on one invoice, without consuming the line.
-- BoekBrug · August 2026
-- =====================================================================
-- ── THE BUG THIS FIXES, AND HOW IT GOT PAST EVERY TEST ──
--
-- /api/bank/allocate loops over the plan's lines and calls apply_bank_payment once per invoice.
-- That function ends with, unconditionally:
--
--     -- The whole payment is allocated to this one invoice
--     -- (instalment semantics: one tx → one invoice), so the tx is fully consumed.
--     UPDATE public.bank_transactions SET status = 'matched', invoice_id = p_invoice_id ...
--
-- and it opens by refusing any transaction whose status is not 'pending'. So the first invoice of
-- a batch books, the transaction locks itself as 'matched', and every line after it returns empty
-- — which the route correctly reports as "de verdeling is halverwege gestopt".
--
-- EVERY multi-invoice allocation failed after its first invoice. The whole feature.
--
-- It passed the gates because all 22 tests of payment-plan.ts are pure: they prove the PLAN is
-- arithmetically sound and never touch a database. The defect lives precisely in the seam between
-- a proven plan and the function that writes it — which is the one place nothing in this repo
-- tests, and the reason that gap is worth closing beyond this one function.
--
-- ── WHY A NEW FUNCTION AND NOT A FIX TO THE OLD ONE ──
--
-- apply_bank_payment is not wrong; it is answering a different question. Its contract is "this
-- payment settles this invoice" — the ordinary one-to-one confirm, where consuming the line IS
-- correct, and where several existing callers rely on exactly that. Changing it would silently
-- alter their behaviour to fix a caller it was never written for.
--
-- The right semantics already exist, in confirm_bank_payment (bank_confirm_atomic.sql): it reads
-- Σ amount_applied of the line's OTHER links under the transaction lock and flips the line to
-- 'matched' ONLY when it is spent to the cent. What it does not take is a requested AMOUNT — it
-- always applies LEAST(available, open), so it cannot express "€3.000 of this €3.200 invoice",
-- which is the entire point of a plan.
--
-- This function is those two halves joined: confirm_bank_payment's line accounting, plus
-- apply_bank_payment's amount control. Nothing new is invented — the arithmetic, the locks, the
-- refusals and the cent rule are all copied from the two functions that already prove them.
--
-- APPLY: run in the Supabase SQL editor. No data changed, no existing function touched.
-- Depends on invoice_partial_payments.sql and bank_confirm_atomic.sql.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.allocate_bank_payment(
  p_user_id    uuid,
  p_tx_id      uuid,
  p_invoice_id uuid,
  p_amount     numeric,
  p_pay_date   date
)
RETURNS TABLE(applied numeric, amount_paid numeric, total numeric, is_paid boolean, line_done boolean, line_remaining numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_eps         numeric := 0.005;
  v_tx_status   text;
  v_tx_amount   numeric;
  v_inv_status  text;
  v_acc_status  text;
  v_total       numeric;
  v_paid        numeric;
  v_open        numeric;
  v_elsewhere   numeric;
  v_available   numeric;
  v_applied     numeric;
  v_now_paid    numeric;
  v_is_paid     boolean;
  v_line_rest   numeric;
BEGIN
  -- ── CALLER GUARD — the one line this function was written without ──
  --
  -- Same contract as apply_bank_payment, confirm_bank_payment and book_bank_batch: with the session
  -- client auth.uid() is the caller, so it must equal p_user_id; with service-role it is NULL and
  -- the call is pinned by p_user_id alone.
  --
  -- Its absence was not theoretical. This function is SECURITY DEFINER, so RLS does not apply to
  -- anything it touches, and it is GRANTed to `authenticated` — and PostgREST exposes every such
  -- function directly at /rest/v1/rpc/, with the anon key that ships in the browser bundle. Both
  -- scoping predicates below match on the ARGUMENT (`user_id = p_user_id`, `sender_id = p_user_id
  -- OR receiver_id = p_user_id`), never on the session. So any registered user could name a
  -- stranger's uuid, transaction and invoice and have this function read and lock them.
  --
  -- The money write was blocked today by prevent_accountant_amount_changes, whose deny list
  -- includes amount_paid — but that is a trigger on a DIFFERENT table whose exception list other
  -- migrations edit, so the protection was accidental and one edit from gone. What was reachable
  -- without any trigger help was a cross-tenant oracle: the distinct exceptions below ("invoice not
  -- found / not owned" vs "already fully paid" vs "locked by accountant" vs "already covered") tell
  -- a stranger whether a named invoice of a named user exists, is paid, is locked, and still owes.
  --
  -- The file header claims every refusal was copied from the two functions this one was built from.
  -- This is the one that was not, and it is why a sweep for "SECURITY DEFINER + p_user_id + GRANT
  -- authenticated + no auth.uid()" over every migration returned exactly one hit: this file.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[BETAALPLAN] caller % may not allocate for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- The line, locked. 'pending' is the only state that may still be spent; anything else means
  -- another booking already claimed it, and an empty result tells the caller to stop.
  SELECT status, abs(coalesce(amount, 0)) INTO v_tx_status, v_tx_amount
  FROM public.bank_transactions
  WHERE id = p_tx_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_tx_status IS DISTINCT FROM 'pending' THEN
    RETURN;
  END IF;
  IF v_tx_amount <= 0 THEN
    RAISE EXCEPTION '[BETAALPLAN] transaction has no amount to spend' USING ERRCODE = '55000';
  END IF;

  -- The invoice, locked and re-verified under that lock. Every refusal here is one the caller
  -- also checks before writing anything; they are repeated because a plan proven a second ago is
  -- not a plan proven now.
  SELECT i.status, i.accountant_status, abs(coalesce(i.total_inc_btw, 0)), coalesce(i.amount_paid, 0)
    INTO v_inv_status, v_acc_status, v_total, v_paid
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[BETAALPLAN] invoice not found / not owned' USING ERRCODE = '55000';
  END IF;
  IF v_inv_status = 'paid' THEN
    RAISE EXCEPTION '[BETAALPLAN] invoice already fully paid' USING ERRCODE = '55000';
  END IF;
  IF v_acc_status = 'verwerkt' THEN
    RAISE EXCEPTION '[BETAALPLAN] invoice locked by accountant (verwerkt)' USING ERRCODE = '55000';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION '[BETAALPLAN] invoice has no total to settle' USING ERRCODE = '55000';
  END IF;

  v_open := v_total - v_paid;
  IF v_open <= v_eps THEN
    RAISE EXCEPTION '[BETAALPLAN] invoice already covered' USING ERRCODE = '55000';
  END IF;

  -- What this line already gave to OTHER invoices, read under the tx lock so it is exact rather
  -- than a snapshot a concurrent booking can invalidate. This is the sum guard the caller performs
  -- in TypeScript — here it is atomic, which is what makes it true.
  SELECT coalesce(sum(coalesce(amount_applied, 0)), 0) INTO v_elsewhere
  FROM public.bank_tx_invoices
  WHERE transaction_id = p_tx_id AND user_id = p_user_id
    AND invoice_id <> p_invoice_id;

  v_available := v_tx_amount - v_elsewhere;
  IF v_available <= v_eps THEN
    RAISE EXCEPTION '[BETAALPLAN] payment fully applied' USING ERRCODE = '55000';
  END IF;

  -- The requested amount, capped by both ceilings. Capping rather than refusing is deliberate HERE
  -- and nowhere else: the caller already refuses an over-ask with a sentence naming both figures,
  -- so reaching this line at all means the plan was valid when it was made and something shifted
  -- underneath it. Booking the smaller, provable number and reporting it back beats an exception
  -- that leaves a valid batch half-applied over a cent of drift.
  v_applied  := LEAST(GREATEST(coalesce(p_amount, 0), 0), v_available, v_open);
  IF v_applied <= v_eps THEN
    RAISE EXCEPTION '[BETAALPLAN] nothing left to allocate to this invoice' USING ERRCODE = '55000';
  END IF;

  v_now_paid := v_paid + v_applied;
  v_is_paid  := v_now_paid >= v_total - v_eps;

  IF v_is_paid THEN
    UPDATE public.invoices
    SET amount_paid    = v_total,
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

  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (p_user_id, p_tx_id, p_invoice_id, v_applied)
  ON CONFLICT (transaction_id, invoice_id)
  DO UPDATE SET amount_applied = coalesce(public.bank_tx_invoices.amount_applied, 0) + v_applied;

  -- ── THE LINE IS ONLY FINISHED WHEN IT IS SPENT ──
  -- This is the whole difference from apply_bank_payment, and the reason this function exists.
  -- A line with money left stays 'pending' so the next invoice of the same plan can still reach
  -- it; only a line spent to the cent becomes 'matched'.
  v_line_rest := v_tx_amount - (v_elsewhere + v_applied);
  IF v_line_rest <= v_eps THEN
    UPDATE public.bank_transactions
    SET status = 'matched', invoice_id = p_invoice_id
    WHERE id = p_tx_id AND user_id = p_user_id;
  ELSE
    UPDATE public.bank_transactions
    SET invoice_id = p_invoice_id
    WHERE id = p_tx_id AND user_id = p_user_id;
  END IF;

  RETURN QUERY SELECT v_applied, v_now_paid, v_total, v_is_paid,
                      (v_line_rest <= v_eps), GREATEST(0, v_line_rest);
END;
$$;

COMMENT ON FUNCTION public.allocate_bank_payment(uuid, uuid, uuid, numeric, date) IS
  '[BETAALPLAN] One line of a multi-invoice allocation: applies a REQUESTED amount to one invoice, capped by the line''s remaining money and the invoice''s open balance, and flips the transaction to matched ONLY when the line is spent to the cent — so the next line of the same plan can still reach it. apply_bank_payment consumes the line on its first call and cannot be looped.';

REVOKE ALL ON FUNCTION public.allocate_bank_payment(uuid, uuid, uuid, numeric, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_bank_payment(uuid, uuid, uuid, numeric, date)
  TO authenticated, service_role;

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying) — this is the case that was broken:
--
--   One EUR 5.000 debit over three purchase invoices of 1.200, 800 and 3.000.
--   Before this function the second call returned empty and the batch stopped.
--
--   select * from public.allocate_bank_payment(:user, :tx, :inv_a, 1200, current_date);
--     -- applied 1200, line_done false, line_remaining 3800
--   select * from public.allocate_bank_payment(:user, :tx, :inv_b,  800, current_date);
--     -- applied  800, line_done false, line_remaining 3000   <-- used to return NOTHING
--   select * from public.allocate_bank_payment(:user, :tx, :inv_c, 3000, current_date);
--     -- applied 3000, line_done TRUE,  line_remaining 0
--
--   select status from public.bank_transactions where id = :tx;   -- 'matched', only now
--   select sum(amount_applied) from public.bank_tx_invoices where transaction_id = :tx;  -- 5000
-- =====================================================================
