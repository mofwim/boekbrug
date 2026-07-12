-- [READINESS-P3] accountant_subject_status — per-subject processing state owned by
-- the accountant. This migration RECONCILES prod-only drift: the table already
-- exists in PROD (with its two RLS policies) but was never captured in
-- supabase/migrations, so a fresh environment lacked it entirely.
--
-- It mirrors the live prod columns + policies EXACTLY, and ADDS one thing prod
-- lacks: a UNIQUE INDEX on (accountant_id, subject_type, subject_id) so an
-- upsert has a real conflict target (previously a status could be duplicated).
--
-- Scope of the feature: subject_type='document'. Invoices already carry their own
-- per-item state via invoices.accountant_status; this table closes the SAME gap
-- for physical documents, which have no status column. Honesty rule: a status is
-- an accountant assertion — a document with no row makes no status claim.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded policies + CREATE INDEX IF NOT
-- EXISTS, so re-running against prod (where the table/policies already exist) is a
-- no-op except for adding the missing unique index.

CREATE TABLE IF NOT EXISTS public.accountant_subject_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accountant_id uuid NOT NULL,
  subject_type text CHECK (subject_type IN ('invoice', 'document')),
  subject_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'te_verwerken'
    CHECK (status IN ('te_verwerken', 'in_behandeling', 'verwerkt', 'vraag')),
  verwerkt_at timestamptz,
  vraag_text text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.accountant_subject_status ENABLE ROW LEVEL SECURITY;

-- ── RLS (mirrors prod) ──────────────────────────────────────────────────────
-- Owner (the accountant) fully controls their own rows via their normal session.
-- No service_role is needed for accountant writes.
DROP POLICY IF EXISTS acc_status_owner_all ON public.accountant_subject_status;
CREATE POLICY acc_status_owner_all ON public.accountant_subject_status
  FOR ALL
  USING (accountant_id = auth.uid())
  WITH CHECK (accountant_id = auth.uid());

-- The client may READ the status of their OWN documents (subject_type='document'),
-- so they can see what their accountant asserted — but never write it.
DROP POLICY IF EXISTS acc_status_client_read_document ON public.accountant_subject_status;
CREATE POLICY acc_status_client_read_document ON public.accountant_subject_status
  FOR SELECT
  USING (
    subject_type = 'document'
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = accountant_subject_status.subject_id
        AND d.user_id = auth.uid()
    )
  );

-- ── NEW vs prod: unique index → upsert conflict target ──────────────────────
-- Without this, ON CONFLICT (accountant_id, subject_type, subject_id) has nothing
-- to bind to and the upsert would insert duplicate status rows per subject.
CREATE UNIQUE INDEX IF NOT EXISTS accountant_subject_status_unique
  ON public.accountant_subject_status (accountant_id, subject_type, subject_id);
