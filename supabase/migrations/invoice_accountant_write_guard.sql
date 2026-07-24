-- invoice_accountant_write_guard.sql
-- [AUDIT-2026-07] Two DB-level hardenings for invoice writes, from the invoice-
-- processing audit:
--
--  A. prevent_accountant_amount_changes() guarded only amounts/dates/sender_id.
--     The accountant UPDATE policy (invoices_accountant_update_v2) is not
--     column-restricted, so a linked accountant could still — outside every
--     guarded app path — flip `direction` (turning a client's omzet into
--     voorbelasting), set `status` ('archived' drops the row out of the
--     quarterly totals; 'paid' invents a payment with no audit row and no
--     bank-tx detach), re-point `receiver_id` to a DIFFERENT linked client
--     (moving an expense + its voorbelasting into another tenant's books), or
--     write payment fields / `pay_token` directly. The accountant's ONLY
--     legitimate invoice write is `accountant_status` (kwartaal page), so the
--     guard now protects every financially-relevant column.
--
--  B. The B.4 'verwerkt' guard existed ONLY on prod (see the drift note in
--     database.sql) — a fresh provision had no DB-level lock on a verwerkt
--     invoice, even though /api/invoice/pay-toggle and the confirm route
--     depend on it (they string-match 'verwerkt' in the error). This adds the
--     guard to the repo with deterministic names. If prod already carries its
--     own copy under another name the two coexist harmlessly (either RAISE
--     aborts the write first).
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Service-role writes
-- (auth.uid() IS NULL) bypass both guards — pipeline paths re-assert their own
-- preconditions (e.g. bank-auto-confirm's verwerkt WHERE clause).

-- ── A. Accountant write guard — extended column list ─────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_accountant_amount_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Exception 1: service_role / pipeline (auth.uid() = NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Exception 2: ZZP invoice owner (sender) may change anything
  IF OLD.sender_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  -- Exception 3: receiver of an incoming invoice (mark-as-paid)
  IF OLD.receiver_id = auth.uid() AND OLD.direction = 'incoming' THEN
    RETURN NEW;
  END IF;
  -- Everyone else (accountant) — protected columns. The accountant's only
  -- legitimate invoice write is accountant_status; every financially-relevant
  -- column is locked here.
  IF (NEW.total_ex_btw        IS DISTINCT FROM OLD.total_ex_btw)        OR
     (NEW.btw_amount          IS DISTINCT FROM OLD.btw_amount)          OR
     (NEW.total_inc_btw       IS DISTINCT FROM OLD.total_inc_btw)       OR
     (NEW.invoice_date        IS DISTINCT FROM OLD.invoice_date)        OR
     (NEW.due_date            IS DISTINCT FROM OLD.due_date)            OR
     (NEW.sender_id           IS DISTINCT FROM OLD.sender_id)           OR
     (NEW.receiver_id         IS DISTINCT FROM OLD.receiver_id)         OR
     (NEW.direction           IS DISTINCT FROM OLD.direction)           OR
     (NEW.status              IS DISTINCT FROM OLD.status)              OR
     (NEW.amount_paid         IS DISTINCT FROM OLD.amount_paid)         OR
     (NEW.payment_method      IS DISTINCT FROM OLD.payment_method)      OR
     (NEW.payment_date        IS DISTINCT FROM OLD.payment_date)        OR
     (NEW.marked_paid_at      IS DISTINCT FROM OLD.marked_paid_at)      OR
     (NEW.payment_prepared_at IS DISTINCT FROM OLD.payment_prepared_at) OR
     (NEW.pay_token           IS DISTINCT FROM OLD.pay_token)           OR
     (NEW.invoice_number      IS DISTINCT FROM OLD.invoice_number)      OR
     (NEW.invoice_type        IS DISTINCT FROM OLD.invoice_type)
  THEN
    RAISE EXCEPTION
      'Permission denied: only the invoice owner can modify amounts, dates, status or payment fields (invoice_id: %)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Re-bind (no-op when the trigger already exists with this name, as on prod).
DROP TRIGGER IF EXISTS prevent_accountant_amount_changes ON public.invoices;
CREATE TRIGGER prevent_accountant_amount_changes
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_accountant_amount_changes();

-- ── B. B.4 'verwerkt' guard — now reproducible from the repo ──────────────────
-- Once the accountant marks an invoice 'verwerkt', its financial fields are
-- frozen for every SESSION write (owner included — the app then shows the
-- "vraag de boekhouder om de verwerking ongedaan te maken" dialog). Changing
-- accountant_status itself stays allowed — that IS the undo flow — but never
-- combined with a financial change in the same statement.
-- The error message deliberately contains 'verwerkt': pay-toggle and the
-- confirm route detect the conflict by that substring.
CREATE OR REPLACE FUNCTION public.prevent_verwerkt_invoice_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- service_role / pipeline bypass (paths re-assert their own verwerkt checks)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.accountant_status IS DISTINCT FROM 'verwerkt' THEN
    RETURN NEW;
  END IF;
  IF (NEW.total_ex_btw   IS DISTINCT FROM OLD.total_ex_btw)   OR
     (NEW.btw_amount     IS DISTINCT FROM OLD.btw_amount)     OR
     (NEW.total_inc_btw  IS DISTINCT FROM OLD.total_inc_btw)  OR
     (NEW.invoice_date   IS DISTINCT FROM OLD.invoice_date)   OR
     (NEW.due_date       IS DISTINCT FROM OLD.due_date)       OR
     (NEW.invoice_number IS DISTINCT FROM OLD.invoice_number) OR
     (NEW.status         IS DISTINCT FROM OLD.status)         OR
     (NEW.amount_paid    IS DISTINCT FROM OLD.amount_paid)    OR
     (NEW.payment_method IS DISTINCT FROM OLD.payment_method) OR
     (NEW.payment_date   IS DISTINCT FROM OLD.payment_date)   OR
     (NEW.marked_paid_at IS DISTINCT FROM OLD.marked_paid_at)
  THEN
    RAISE EXCEPTION
      'Factuur % is verwerkt door de boekhouder — vraag eerst om de verwerking ongedaan te maken',
      COALESCE(OLD.invoice_number, OLD.id::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_verwerkt_guard ON public.invoices;
CREATE TRIGGER invoices_verwerkt_guard
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_verwerkt_invoice_changes();
