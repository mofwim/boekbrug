-- =====================================================================
-- [BANK-BATCH-ATOMIC] Atomic multi-invoice batch booking — migration
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: runBankAutoConfirm's batch pass booked a multi-invoice tie in
-- several separate statements (pay each invoice, THEN link the tx, THEN
-- record the join rows). Two overlapping runs over the SAME batch tx could
-- interleave so that one run paid invoice A + won the tx link while the
-- other paid invoice B, lost the link, and rolled B back — leaving the tx
-- 'matched' but B 'received' (unpaid) and never retried. A paid invoice
-- shown "te laat" forever = a payment-linkage LOSS.
--
-- FIX: do the whole tie in ONE database transaction (this function). It
-- takes a row lock on the bank line FIRST (the mutex), re-verifies every
-- invoice is still payable UNDER that lock, then pays + links + records —
-- all-or-nothing. A concurrent booker blocks on the lock and, after we
-- commit, sees the tx is no longer 'pending' and gets zero rows back (it
-- skips cleanly, never double-books). Any invoice that turned unpayable in
-- the window aborts the WHOLE batch (RAISE → rollback), so a batch is never
-- half-booked.
--
-- SAFETY: identical money discipline to the app path it replaces —
--   · only pays invoices that are currently UNPAID and not accountant-
--     'verwerkt' (B.4), owned by the caller,
--   · links exactly one representative invoice_id onto the tx (the same
--     shape the manual allCovered path writes),
--   · records EVERY paid invoice in bank_tx_invoices (collision-free undo
--     index), so unlink / delete-statement still reverses by id.
-- Fully reversible; the caller still writes the audit row.
--
-- APPLY: run this whole file in the Supabase SQL editor (one transaction).
-- Nothing here deletes data. Idempotent / re-runnable (CREATE OR REPLACE).
-- The CODE that calls book_bank_batch degrades safely if this is not yet
-- applied (the rpc errors → the batch simply isn't auto-booked that run),
-- so there is no hard ordering requirement, but apply this FIRST to enable
-- the feature.
-- =====================================================================

BEGIN;

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
  v_rep       uuid;
  v_bad       int;
BEGIN
  -- Caller identity guard. This function runs from BOTH a session client
  -- (the verify/pay route → auth.uid() = the user) AND service-role (cron /
  -- import → auth.uid() IS NULL, already user-pinned by the caller). Allow a
  -- NULL uid (service-role) but reject a MISMATCHED authenticated user.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[BANK-BATCH] caller % may not book for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';   -- insufficient_privilege
  END IF;

  IF p_invoice_ids IS NULL OR array_length(p_invoice_ids, 1) IS NULL THEN
    RAISE EXCEPTION '[BANK-BATCH] no invoices supplied' USING ERRCODE = '22023';
  END IF;

  -- (1) MUTEX — lock the bank line. A concurrent booker for the same tx blocks
  --     here; after we commit it re-reads the row and sees status <> 'pending'
  --     and returns 0 rows. This empty-return path assumes READ COMMITTED (the
  --     PostgREST default): the loser's FOR UPDATE re-reads our committed
  --     'matched' row. Under REPEATABLE READ / SERIALIZABLE the loser's FOR
  --     UPDATE instead raises a serialization error — which the caller catches
  --     as batchErr and skips, so it still fails SAFE (never double-books).
  SELECT status INTO v_tx_status
  FROM public.bank_transactions
  WHERE id = p_tx_id AND user_id = p_user_id
  FOR UPDATE;

  -- Not ours, gone, or already booked/linked by a concurrent run → nothing to
  -- do. Return an EMPTY set (no error): the caller treats this as "skip".
  IF NOT FOUND OR v_tx_status IS DISTINCT FROM 'pending' THEN
    RETURN;
  END IF;

  -- (2) Lock every invoice in a deterministic order (id) to avoid deadlocks
  --     between two overlapping batches that share an invoice, then re-verify
  --     each is still payable UNDER the lock: exists, owned by this user, not
  --     already 'paid' (by another tx or a manual/cash payment), and not
  --     accountant-'verwerkt' (B.4). ANY failure aborts the whole batch.
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
  WHERE i.id IS NULL                        -- missing / not owned by caller
     OR i.status = 'paid'                   -- already paid → would double-count
     OR i.accountant_status = 'verwerkt';   -- B.4 locked by the accountant

  IF v_bad > 0 THEN
    RAISE EXCEPTION '[BANK-BATCH] % invoice(s) no longer payable — batch aborted', v_bad
      USING ERRCODE = '55000';   -- object_not_in_prerequisite_state
  END IF;

  -- (3) [PARTIAL-PAY] Record EVERY invoice this payment paid, WITH the amount applied —
  --     and do it BEFORE the invoices are updated, because the amount this batch applies is
  --     the balance that is still OPEN right now: abs(total) − amount_paid. Using the full
  --     total here would make SUM(amount_applied) exceed the invoice whenever the batch
  --     completes an invoice that earlier instalments had already partly settled, and
  --     recompute_invoice_amount_paid (which re-derives amount_paid from that SUM on every
  --     unlink) would then clamp/overstate. The rows are locked FOR UPDATE above, so this
  --     pre-update read is stable. Also the collision-free reversal index (unchanged role).
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  SELECT p_user_id, p_tx_id, i.id,
         GREATEST(0, abs(coalesce(i.total_inc_btw, 0)) - coalesce(i.amount_paid, 0))
  FROM unnest(p_invoice_ids) AS ids(id)
  JOIN public.invoices i ON i.id = ids.id
  ON CONFLICT (transaction_id, invoice_id) DO NOTHING;

  -- (4) Pay every invoice. All verified unpaid above → each flips exactly once.
  --     [PARTIAL-PAY] amount_paid must land on the FULL magnitude: this batch settles the
  --     invoice completely. Leaving it at its mid-instalment figure (the old behaviour) made
  --     a fully-paid invoice read as still-partly-open, and under KASSTELSEL the uncounted
  --     portion silently dropped out of the BTW-aangifte.
  UPDATE public.invoices
  SET status         = 'paid',
      payment_method = 'bank',
      marked_paid_at = now(),
      payment_date   = p_pay_date,
      amount_paid    = abs(coalesce(total_inc_btw, 0))
  WHERE id = ANY (p_invoice_ids);

  -- (5) Link the bank line → matched, with a representative invoice_id (the
  --     last id — the same element the prior app code used as `rep`).
  v_rep := p_invoice_ids[array_upper(p_invoice_ids, 1)];
  UPDATE public.bank_transactions
  SET status = 'matched', invoice_id = v_rep
  WHERE id = p_tx_id AND user_id = p_user_id;

  -- Hand the paid ids back so the caller builds its result + audit row.
  RETURN QUERY SELECT ids.id FROM unnest(p_invoice_ids) AS ids(id);
END;
$$;

COMMENT ON FUNCTION public.book_bank_batch(uuid, uuid, uuid[], date) IS
  '[BANK-BATCH-ATOMIC] Atomically books one multi-invoice batch tie: locks the bank line (mutex), re-verifies every invoice is still unpaid + not verwerkt under the lock, records bank_tx_invoices join rows with amount_applied = the still-open balance (pre-update), pays them all (amount_paid → full magnitude), and links the tx (matched + representative invoice_id) — all-or-nothing. Empty result = tx already claimed (skip). Exception = an invoice turned unpayable (whole batch rolled back).';

-- Both the authenticated session client and the service-role pipeline call this.
REVOKE ALL ON FUNCTION public.book_bank_batch(uuid, uuid, uuid[], date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_bank_batch(uuid, uuid, uuid[], date) TO authenticated, service_role;

COMMIT;
