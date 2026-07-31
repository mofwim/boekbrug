-- =====================================================================
-- [PAYDATE-REDERIVE] After a reversal, an invoice's payment date must describe the money that is
-- STILL on it — not the money that left.
-- BoekBrug · July 2026
-- =====================================================================
-- THE BUG. Invoice A is settled in two instalments: EUR 1.000 on 1 May, EUR 2.000 on 15 June.
-- The owner undoes the FIRST one. amount_paid is re-derived correctly (2.000 remains), but
-- payment_date keeps saying 1 May — the date of the instalment that just went away. The only
-- money still on that invoice arrived on 15 June.
--
-- Why that is not cosmetic: under the KASSTELSEL, payment_date is what decides which QUARTER a
-- payment counts in. A stale date moves money into a quarter it never belonged to, and it does so
-- without a warning anywhere — the figure simply comes out wrong. The same applies to
-- payment_method: keep 'bank' after unlinking the bank instalment and the surviving cash payment
-- disappears from the kasboek's reasoning.
--
-- WHERE IT LIVES. Every reversal path already calls recompute_invoice_amount_paid to re-derive
-- amount_paid = SUM(bank_tx_invoices.amount_applied) under a row lock: /api/bank/unlink (single
-- and batch), the undo in /api/invoice/pay-toggle, and /api/bank/delete-statement. Each of them
-- carried its own `payment_date: stillHasPayment ? inv.payment_date : null` — the stale value.
-- Fixing it in each caller would be four chances to disagree; deriving it in the same function
-- that already derives the amount is one truth, and every existing caller inherits it with no
-- change on their side.
--
-- DELIBERATELY ADDITIVE. The function only WRITES payment_date/payment_method when surviving
-- links exist to derive them from. With no links left it touches neither field — the callers
-- already clear them explicitly for that case, and a legacy invoice whose payment predates the
-- join table must never have its date wiped by a reconciliation pass. So this migration can only
-- correct a wrong date; it can never remove a right one.
--
-- APPLY: run this whole file in the Supabase SQL editor. Nothing here deletes data.
-- Idempotent / re-runnable.
-- =====================================================================

BEGIN;

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
  v_total  numeric;
  v_sum    numeric;
  v_date   date;
  v_method text;
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
    RETURN 0;   -- not ours / gone -> nothing to do
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

  -- [PAYDATE-REDERIVE] The date and method of the EARLIEST payment still on this invoice. A bank
  -- link takes its date from the transaction; a manual instalment carries paid_on/method itself.
  -- Ordered by that effective date, with created_at breaking ties so the result is stable.
  SELECT coalesce(l.paid_on, bt.date), coalesce(l.method, 'bank')
    INTO v_date, v_method
  FROM public.bank_tx_invoices l
  LEFT JOIN public.bank_transactions bt
    ON bt.id = l.transaction_id AND bt.user_id = p_user_id
  WHERE l.invoice_id = p_invoice_id AND l.user_id = p_user_id
  ORDER BY coalesce(l.paid_on, bt.date) NULLS LAST, l.created_at
  LIMIT 1;

  -- Only write what we could actually derive. No surviving links -> both stay untouched: the
  -- callers clear them for that case, and a pre-join-table invoice must keep its recorded date.
  IF v_date IS NOT NULL THEN
    UPDATE public.invoices
    SET amount_paid = v_sum, payment_date = v_date, payment_method = coalesce(v_method, payment_method)
    WHERE id = p_invoice_id;
  ELSE
    UPDATE public.invoices SET amount_paid = v_sum WHERE id = p_invoice_id;
  END IF;

  RETURN v_sum;
END;
$$;

COMMENT ON FUNCTION public.recompute_invoice_amount_paid(uuid, uuid) IS
  '[PARTIAL-PAY] Atomically re-derives invoices.amount_paid = SUM(bank_tx_invoices.amount_applied) for an invoice under a row lock. Called by the reversal paths after clearing link rows - order-independent (no concurrent-unlink lost-update) and self-healing (fully-unlinked -> 0). [PAYDATE-REDERIVE] Also re-derives payment_date/payment_method from the EARLIEST surviving link, so undoing the first of several instalments cannot leave the invoice claiming a date whose money is gone (which would move it into the wrong kasstelsel quarter). Both fields are left untouched when no link survives.';

REVOKE ALL ON FUNCTION public.recompute_invoice_amount_paid(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_invoice_amount_paid(uuid, uuid) TO authenticated, service_role;

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────────────────────
-- The function carries the new behaviour. Must be true.
SELECT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'recompute_invoice_amount_paid'
    AND pg_get_functiondef(p.oid) LIKE '%PAYDATE-REDERIVE%'
) AS has_paydate_rederive;
