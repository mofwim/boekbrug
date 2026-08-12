-- migrations: invoice_payment_date_rederive.sql
-- =====================================================================
-- [SEAM] Two undos on one invoice, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHY THIS ONE ──
--
-- /api/invoice/pay-toggle's undo is the only money mutation in this app that is NOT a single
-- database function. It is a sequence of statements with a hand-written compensating rollback, and
-- that rollback restored the snapshot taken at the START of the request. Under two concurrent undos
-- on the same invoice, the loser's rollback puts back a payment the owner deliberately removed.
--
-- It is not an exotic interleaving. It runs through the branch that exists PRECISELY for a lost
-- race — the honest zero-row report on the invoice UPDATE — and the undo path carries no
-- idempotency key, unlike the pay path. Two taps on two devices reach it.
--
-- Everything below is the interleaving itself, statement for statement as the route issues them,
-- against a database that really runs them. The first block demonstrates the bug with the OLD rule
-- so the file records what was actually wrong; the second holds the fix.
--
-- What this file does NOT prove: that the TypeScript issues these statements. That is what the
-- [UNDO-EIGEN-WERK] gates in lifecycle-gates.test.ts hold. Neither half is sufficient alone, and
-- saying so is part of the test.
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

/**
 * One fully-paid EUR 1.000 sales invoice: a matched bank transaction and the link row that makes
 * amount_paid = SUM(amount_applied) true.
 */
CREATE OR REPLACE FUNCTION public.t_paid_invoice(u uuid, inv uuid, tx uuid, lnk uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, sender_id, status, direction, invoice_type, total_inc_btw, amount_paid, payment_date)
  VALUES (inv, u, 'paid', 'outgoing', 'factuur', 1000, 1000, DATE '2026-08-01');
  INSERT INTO public.bank_transactions (id, user_id, amount, date, status, invoice_id)
  VALUES (tx, u, 1000, DATE '2026-08-01', 'matched', inv);
  INSERT INTO public.bank_tx_invoices (id, user_id, transaction_id, invoice_id, amount_applied)
  VALUES (lnk, u, tx, inv, 1000);
END $$;

\echo ''
\echo '— [UNDO-EIGEN-WERK] the bug: the loser''s rollback restores its own stale snapshot —'
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        tx  uuid := '55555555-5555-5555-5555-555555555555';
        lnk uuid := '66666666-6666-6666-6666-666666666666';
        b_snapshot record;   -- what request B read at the top of ITS request
        a_rows int;
        b_rows int;
BEGIN
  PERFORM public.t_paid_invoice(u, inv, tx, lnk);

  -- B starts and snapshots the invoice's links. This is the read that goes stale.
  SELECT bti.id, bti.transaction_id, bti.amount_applied INTO b_snapshot
  FROM public.bank_tx_invoices bti WHERE bti.invoice_id = inv;

  -- ── A runs to completion ──
  UPDATE public.bank_transactions SET status = 'pending', invoice_id = NULL WHERE id = tx AND user_id = u;
  DELETE FROM public.bank_tx_invoices WHERE user_id = u AND invoice_id = inv;
  PERFORM public.recompute_invoice_amount_paid(u, inv);
  UPDATE public.invoices SET status = 'sent', payment_method = NULL, marked_paid_at = NULL,
         payment_date = NULL, payment_prepared_at = NULL
   WHERE id = inv AND status = 'paid';
  GET DIAGNOSTICS a_rows = ROW_COUNT;
  PERFORM public.t_eq('A wins the race and the undo lands', a_rows, 1);
  PERFORM public.t_eq('the payment is gone', (SELECT amount_paid FROM public.invoices WHERE id = inv), 0);

  -- ── B runs the same steps and loses ──
  UPDATE public.bank_transactions SET status = 'pending', invoice_id = NULL WHERE id = tx AND user_id = u;
  DELETE FROM public.bank_tx_invoices WHERE user_id = u AND invoice_id = inv;   -- removes nothing
  PERFORM public.recompute_invoice_amount_paid(u, inv);
  UPDATE public.invoices SET status = 'sent' WHERE id = inv AND status = 'paid';
  GET DIAGNOSTICS b_rows = ROW_COUNT;
  PERFORM public.t_eq('B''s invoice write matches nothing — the honest zero-row branch', b_rows, 0);

  -- …and that branch calls the rollback. THE OLD RULE: restore the snapshot B took at the start.
  INSERT INTO public.bank_tx_invoices (id, user_id, transaction_id, invoice_id, amount_applied)
  VALUES (b_snapshot.id, u, b_snapshot.transaction_id, inv, b_snapshot.amount_applied)
  ON CONFLICT (id) DO UPDATE SET amount_applied = EXCLUDED.amount_applied;
  UPDATE public.bank_transactions SET status = 'matched', invoice_id = inv WHERE id = tx AND user_id = u;
  PERFORM public.recompute_invoice_amount_paid(u, inv);

  -- This is the damage, measured. The owner removed a payment; it is back.
  PERFORM public.t_eq('the deleted payment is BACK on the invoice',
    (SELECT amount_paid FROM public.invoices WHERE id = inv), 1000);
  PERFORM public.t_is('…on an invoice whose status says it is unpaid',
    (SELECT status FROM public.invoices WHERE id = inv), 'sent');
  PERFORM public.t_is('…and the transaction is ''matched'' again, so the matcher will never resurface it',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');
END $$;

\echo ''
\echo '— [UNDO-EIGEN-WERK] the fix: a rollback restores what its OWN delete removed —'
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        tx  uuid := '55555555-5555-5555-5555-555555555555';
        lnk uuid := '66666666-6666-6666-6666-666666666666';
        b_deleted int;
        b_rows    int;
BEGIN
  PERFORM public.t_paid_invoice(u, inv, tx, lnk);

  -- A wins, exactly as above.
  UPDATE public.bank_transactions SET status = 'pending', invoice_id = NULL WHERE id = tx AND user_id = u;
  DELETE FROM public.bank_tx_invoices WHERE user_id = u AND invoice_id = inv;
  PERFORM public.recompute_invoice_amount_paid(u, inv);
  UPDATE public.invoices SET status = 'sent', payment_method = NULL, marked_paid_at = NULL,
         payment_date = NULL, payment_prepared_at = NULL
   WHERE id = inv AND status = 'paid';

  -- B loses. Its DELETE now REPORTS what it removed (`.select()` on the route's delete), and that
  -- report — not the opening snapshot — is what the rollback may restore.
  UPDATE public.bank_transactions SET status = 'pending', invoice_id = NULL WHERE id = tx AND user_id = u;
  WITH gone AS (
    DELETE FROM public.bank_tx_invoices WHERE user_id = u AND invoice_id = inv
    RETURNING id, transaction_id, amount_applied
  )
  SELECT count(*) INTO b_deleted FROM gone;
  PERFORM public.t_eq('B''s delete removed nothing — A had already taken the link', b_deleted, 0);

  PERFORM public.recompute_invoice_amount_paid(u, inv);
  UPDATE public.invoices SET status = 'sent' WHERE id = inv AND status = 'paid';
  GET DIAGNOSTICS b_rows = ROW_COUNT;
  PERFORM public.t_eq('B still reports the conflict honestly', b_rows, 0);

  -- The rollback runs over B's OWN delete report, which is empty. Nothing is restored.
  PERFORM public.t_eq('the payment stays gone', (SELECT amount_paid FROM public.invoices WHERE id = inv), 0);
  PERFORM public.t_eq('no link row came back',
    (SELECT count(*) FROM public.bank_tx_invoices WHERE invoice_id = inv), 0);
  PERFORM public.t_is('and the transaction is still detached, so the matcher can offer it again',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'pending');
END $$;

\echo ''
\echo '— [UNDO-EIGEN-WERK] the rollback the route actually needs still works —'
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        tx  uuid := '55555555-5555-5555-5555-555555555555';
        lnk uuid := '66666666-6666-6666-6666-666666666666';
        deleted_id     uuid;
        deleted_tx     uuid;
        deleted_amount numeric;
        reverted int;
BEGIN
  -- The single-request case: no rival, the links really were removed, and then the invoice write
  -- fails. Restoring is the whole reason the rollback exists — narrowing it must not break this.
  PERFORM public.t_paid_invoice(u, inv, tx, lnk);

  UPDATE public.bank_transactions SET status = 'pending', invoice_id = NULL WHERE id = tx AND user_id = u;
  WITH gone AS (
    DELETE FROM public.bank_tx_invoices WHERE user_id = u AND invoice_id = inv
    RETURNING id, transaction_id, amount_applied
  )
  SELECT id, transaction_id, amount_applied INTO deleted_id, deleted_tx, deleted_amount FROM gone;
  PERFORM public.t_eq('this delete really did remove the link', deleted_amount, 1000);
  PERFORM public.recompute_invoice_amount_paid(u, inv);

  -- …and now the invoice write fails. Roll back over what we removed.
  INSERT INTO public.bank_tx_invoices (id, user_id, transaction_id, invoice_id, amount_applied)
  VALUES (deleted_id, u, deleted_tx, inv, deleted_amount)
  ON CONFLICT (id) DO UPDATE SET amount_applied = EXCLUDED.amount_applied;
  -- The transaction revert is guarded on what THIS request wrote ('pending'), so it can only undo
  -- its own write. Here it is still the last word, so it reverts.
  UPDATE public.bank_transactions SET status = 'matched', invoice_id = inv
   WHERE id = tx AND user_id = u AND status = 'pending';
  GET DIAGNOSTICS reverted = ROW_COUNT;
  PERFORM public.t_eq('the transaction we detached is put back', reverted, 1);
  PERFORM public.recompute_invoice_amount_paid(u, inv);

  PERFORM public.t_eq('the payment is restored to the cent',
    (SELECT amount_paid FROM public.invoices WHERE id = inv), 1000);
  PERFORM public.t_eq('with exactly one link row, not two',
    (SELECT count(*) FROM public.bank_tx_invoices WHERE invoice_id = inv), 1);
  PERFORM public.t_is('the invoice never left ''paid'' — nothing was written to it',
    (SELECT status FROM public.invoices WHERE id = inv), 'paid');
END $$;

\echo ''
\echo '— [UNDO-EIGEN-WERK] the transaction revert refuses when it is no longer the last word —'
DO $$
DECLARE u   uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        tx  uuid := '55555555-5555-5555-5555-555555555555';
        lnk uuid := '66666666-6666-6666-6666-666666666666';
        reverted int;
BEGIN
  -- We detach the transaction; someone else then books it against a DIFFERENT invoice. An
  -- unguarded rollback would drag it back onto ours and overwrite their work with a value that was
  -- already stale when we read it.
  PERFORM public.t_paid_invoice(u, inv, tx, lnk);
  UPDATE public.bank_transactions SET status = 'pending', invoice_id = NULL WHERE id = tx AND user_id = u;

  -- …a rival books the freed transaction elsewhere.
  UPDATE public.bank_transactions SET status = 'matched', invoice_id = '99999999-9999-9999-9999-999999999999'
   WHERE id = tx AND user_id = u;

  -- Our rollback, guarded on what WE wrote.
  UPDATE public.bank_transactions SET status = 'matched', invoice_id = inv
   WHERE id = tx AND user_id = u AND status = 'pending';
  GET DIAGNOSTICS reverted = ROW_COUNT;
  PERFORM public.t_eq('the guarded revert changes nothing', reverted, 0);
  PERFORM public.t_is('…and the rival''s booking survives',
    (SELECT invoice_id::text FROM public.bank_transactions WHERE id = tx),
    '99999999-9999-9999-9999-999999999999');
END $$;

SELECT '[UNDO-EIGEN-WERK] held: a rollback restores only what its own delete removed, the single-request rollback is unchanged, and a revert that is no longer the last word does nothing' AS result;
