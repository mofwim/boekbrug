-- =====================================================================
-- [FACTUURVRAAG] The client may read a question their accountant asked
-- about one of THEIR OWN invoices.
-- BoekBrug · August 2026
-- =====================================================================
-- WHY: accountant_subject_status has allowed subject_type='invoice' since
-- the day it was created — the CHECK constraint names both kinds. What was
-- never written is the policy that lets the CLIENT read the invoice ones.
--
-- The consequence was a feature that existed on three surfaces and could
-- not happen:
--
--   · invoices.accountant_status = 'vraag' is READ by the accountant home
--     ("Open vraag" KPI), by the client list (a red dot), and by the
--     werkboard todo list (❓ client_question) — and written by NO route.
--   · The DB trigger (accountant_write_guard_fix) explicitly PERMITS an
--     accountant to move accountant_status and accountant_note. The
--     permission was granted; the write path was never built.
--   · /dashboard/vragen — "je boekhouder heeft een vraag", with the
--     subject and one field to answer — filters subject_type='document',
--     so an invoice question could never appear on it.
--
-- So the single most common thing a bookkeeper says about an
-- administration — "this one line, what is it?" — had no home in the app,
-- and the counters built for it read zero forever. That conversation left
-- BoekBrug and came back over WhatsApp.
--
-- WHAT THIS DOES NOT CHANGE: the client may READ, never write. A status is
-- an assertion BY THE ACCOUNTANT; the client answering does not tick it
-- off. Answering runs over /api/messages, exactly as it does for a
-- document question, and the question stands until the accountant clears
-- it themselves.
--
-- Safe to run more than once.
-- =====================================================================

-- The client may READ the status of their OWN invoices (subject_type='invoice').
-- Both directions: an incoming purchase invoice has receiver_id = the client, an
-- outgoing sales invoice has sender_id = the client, and an accountant has
-- questions about both.
DROP POLICY IF EXISTS acc_status_client_read_invoice ON public.accountant_subject_status;
CREATE POLICY acc_status_client_read_invoice ON public.accountant_subject_status
  FOR SELECT
  USING (
    subject_type = 'invoice'
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = accountant_subject_status.subject_id
        AND (i.sender_id = auth.uid() OR i.receiver_id = auth.uid())
    )
  );

COMMENT ON POLICY acc_status_client_read_invoice ON public.accountant_subject_status IS
  '[FACTUURVRAAG] The client reads questions asked about their own invoices. SELECT only: a status is the accountant''s assertion, and the client answering it does not make it answered.';
