-- migrations: invoice_payment_date_rederive.sql
-- =====================================================================
-- [SEAM] recompute_invoice_amount_paid, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHY THIS ONE ──
--
-- This function holds the one invariant the whole instalment system rests on:
--
--     invoices.amount_paid = SUM(bank_tx_invoices.amount_applied)
--
-- Every reversal path calls it after clearing link rows — unlink a bank line, undo a pay-toggle,
-- delete a statement, supersede an invoice, move a payment to another invoice. If it is wrong, an
-- invoice claims to have been paid money that no longer has a row behind it, and nothing anywhere
-- disagrees: both numbers came from us.
--
-- The second half is subtler and is about a DATE. Under the kasstelsel the BTW lands in the quarter
-- an invoice was PAID, so payment_date decides which return the money belongs in. Undo the first of
-- three instalments and the invoice must stop claiming that first date — its money is gone.
-- Otherwise a payment moves into an already-filed quarter, quietly, and the filed figure and the
-- app's figure disagree about a quarter that is closed.
-- =====================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.t_eq(what text, got numeric, want numeric) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, got;
END $$;

CREATE OR REPLACE FUNCTION public.t_is(what text, got text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, got;
END $$;

\echo ''
\echo '— [PARTIAL-PAY] amount_paid is the SUM of what is still linked —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
BEGIN
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid, payment_date)
  VALUES (inv, u, 'received', 'factuur', 1000, 999, DATE '2020-01-01');   -- deliberately wrong
  INSERT INTO public.bank_tx_invoices (user_id, invoice_id, amount_applied, paid_on, method)
  VALUES (u, inv, 300, DATE '2026-06-01', 'bank'),
         (u, inv, 250, DATE '2026-07-01', 'kas');

  PERFORM public.t_eq('the function returns what it derived',
    public.recompute_invoice_amount_paid(u, inv), 550);
  PERFORM public.t_eq('and writes it — a stale 999 is corrected, not preserved',
    (SELECT amount_paid FROM public.invoices WHERE id = inv), 550);

  -- Remove the LAST instalment: the sum falls, the date does not move (the earliest survives).
  DELETE FROM public.bank_tx_invoices WHERE paid_on = DATE '2026-07-01';
  PERFORM public.t_eq('removing an instalment lowers the sum',
    public.recompute_invoice_amount_paid(u, inv), 300);
  PERFORM public.t_is('the earliest surviving date still stands',
    (SELECT payment_date::text FROM public.invoices WHERE id = inv), '2026-06-01');

  -- Every link gone: self-healing to zero, which is what makes an undo complete.
  DELETE FROM public.bank_tx_invoices WHERE invoice_id = inv;
  PERFORM public.t_eq('with nothing linked it is zero',
    public.recompute_invoice_amount_paid(u, inv), 0);
  PERFORM public.t_eq('…in the row too',
    (SELECT amount_paid FROM public.invoices WHERE id = inv), 0);
END $$;

\echo ''
\echo '— [PAYDATE-REDERIVE] undoing the FIRST instalment moves the date forward —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
BEGIN
  -- The case this half of the function exists for. Three instalments across two quarters; the owner
  -- undoes the March one. Keep claiming 2026-03-10 and the kasstelsel puts this money in Q1 — a
  -- quarter that is filed — while the euros that are actually there arrived in Q2 and Q3.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid, payment_date, payment_method)
  VALUES (inv, u, 'received', 'factuur', 900, 900, DATE '2026-03-10', 'bank');
  INSERT INTO public.bank_tx_invoices (user_id, invoice_id, amount_applied, paid_on, method)
  VALUES (u, inv, 300, DATE '2026-03-10', 'bank'),
         (u, inv, 300, DATE '2026-05-20', 'kas'),
         (u, inv, 300, DATE '2026-08-01', 'bank');

  DELETE FROM public.bank_tx_invoices WHERE paid_on = DATE '2026-03-10';
  PERFORM public.recompute_invoice_amount_paid(u, inv);
  PERFORM public.t_is('the invoice stops claiming a date whose money is gone',
    (SELECT payment_date::text FROM public.invoices WHERE id = inv), '2026-05-20');
  PERFORM public.t_is('and takes that instalment''s method with it',
    (SELECT payment_method FROM public.invoices WHERE id = inv), 'kas');
  PERFORM public.t_eq('the sum follows too', (SELECT amount_paid FROM public.invoices WHERE id = inv), 600);
END $$;

\echo ''
\echo '— [PAYDATE-REDERIVE] a bank link takes its date from the TRANSACTION —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        tx uuid := '22222222-2222-2222-2222-222222222222';
BEGIN
  -- A link made by the bank path carries no paid_on: its date is the bank line's. A manual
  -- instalment carries its own. The ordering has to see both, or the "earliest" is whichever kind
  -- happens to have a date.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur', 1000, 0);
  INSERT INTO public.bank_transactions VALUES (tx, u, -400, DATE '2026-02-02', 'matched', inv);
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (u, tx, inv, 400);
  INSERT INTO public.bank_tx_invoices (user_id, invoice_id, amount_applied, paid_on, method)
  VALUES (u, inv, 100, DATE '2026-09-09', 'kas');

  PERFORM public.recompute_invoice_amount_paid(u, inv);
  PERFORM public.t_eq('both kinds of link count', (SELECT amount_paid FROM public.invoices WHERE id = inv), 500);
  PERFORM public.t_is('and the bank line''s own date is the earliest',
    (SELECT payment_date::text FROM public.invoices WHERE id = inv), '2026-02-02');
END $$;

\echo ''
\echo '— [PARTIAL-PAY] the clamps, and what it deliberately does NOT do —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
BEGIN
  -- Defence in depth: links that sum past the invoice cannot make amount_paid exceed it. If they
  -- ever do, the invariant is already broken upstream and the honest ceiling is the invoice.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur', 500, 0);
  INSERT INTO public.bank_tx_invoices (user_id, invoice_id, amount_applied, paid_on, method)
  VALUES (u, inv, 400, DATE '2026-01-01', 'bank'), (u, inv, 400, DATE '2026-02-01', 'bank');
  PERFORM public.t_eq('over-linked money is clamped to the invoice',
    public.recompute_invoice_amount_paid(u, inv), 500);

  -- A creditnota is stored negative; abs() is the ceiling, and amount_applied is a magnitude, so
  -- the two agree without either carrying a sign.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'creditnota', -150, 0);
  INSERT INTO public.bank_tx_invoices (user_id, invoice_id, amount_applied, paid_on, method)
  VALUES (u, inv, 150, DATE '2026-01-01', 'bank');
  PERFORM public.t_eq('a creditnota settles by its magnitude',
    public.recompute_invoice_amount_paid(u, inv), 150);

  -- STATUS IS NOT THIS FUNCTION'S JOB, and that is worth pinning rather than discovering. The
  -- reversal paths clear it themselves; recomputing to 0 while leaving 'paid' standing is the
  -- documented division of labour, so a future reader does not "fix" it here and break the callers
  -- that rely on setting it in their own order.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'paid', 'factuur', 1000, 1000);
  PERFORM public.recompute_invoice_amount_paid(u, inv);
  PERFORM public.t_eq('no links left → amount_paid 0', (SELECT amount_paid FROM public.invoices WHERE id = inv), 0);
  PERFORM public.t_is('…and status is left to the caller', (SELECT status FROM public.invoices WHERE id = inv), 'paid');

  -- No surviving link → the date is left alone rather than blanked. A pre-join-table invoice has a
  -- recorded payment_date and no rows to re-derive it from; erasing it would lose the only record.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid, payment_date)
  VALUES (inv, u, 'paid', 'factuur', 1000, 1000, DATE '2024-05-05');
  PERFORM public.recompute_invoice_amount_paid(u, inv);
  PERFORM public.t_is('an old recorded date survives when there is nothing to re-derive from',
    (SELECT payment_date::text FROM public.invoices WHERE id = inv), '2024-05-05');
END $$;

\echo ''
\echo '— [PARTIAL-PAY] scoping and the caller guard —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        other uuid := '88888888-8888-8888-8888-888888888888';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        caught boolean := false;
BEGIN
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur', 1000, 400);
  INSERT INTO public.bank_tx_invoices (user_id, invoice_id, amount_applied, paid_on, method)
  VALUES (u, inv, 400, DATE '2026-01-01', 'bank');

  -- An invoice that is not the caller's is "nothing to do", not an error — the reversal paths call
  -- this for whatever they cleared, and a row that was never theirs must simply be left alone.
  PERFORM public.t_eq('someone else''s invoice returns 0', public.recompute_invoice_amount_paid(other, inv), 0);
  PERFORM public.t_eq('…and is not touched', (SELECT amount_paid FROM public.invoices WHERE id = inv), 400);

  -- Links are summed per USER as well as per invoice, so a link row carrying a foreign user_id
  -- cannot inflate someone's amount_paid.
  INSERT INTO public.bank_tx_invoices (user_id, invoice_id, amount_applied, paid_on, method)
  VALUES (other, inv, 5000, DATE '2026-01-02', 'bank');
  PERFORM public.t_eq('a foreign link row is not counted', public.recompute_invoice_amount_paid(u, inv), 400);

  -- SECURITY DEFINER + GRANT authenticated + PostgREST at /rest/v1/rpc/.
  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT ''99999999-9999-9999-9999-999999999999''::uuid' $x$;
  BEGIN PERFORM public.recompute_invoice_amount_paid(u, inv);
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  PERFORM public.t_is('a stranger may not recompute for someone else', caught::text, 'true');

  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT NULL::uuid' $x$;
  PERFORM public.t_eq('service-role still works', public.recompute_invoice_amount_paid(u, inv), 400);
END $$;

\echo ''
\echo '✅ recompute_invoice_amount_paid: every assertion held against a real PostgreSQL.'
