-- circle_integrity_and_indexes.sql
-- [CIRCLE-DB] Close the database-layer gaps the automation audit found. This is IDEMPOTENT and
-- safe to run on production: every column your live DB already has is guarded by IF NOT EXISTS
-- (so those lines are no-ops in prod but restore reproducibility for a fresh environment), and
-- the real prod-affecting changes are the FK ON DELETE fix, the FK indexes, and needs_reauth.
--
-- Apply in the Supabase SQL editor. Nothing here deletes data.

-- ── 1) Schema-drift columns the code hard-depends on (exist in prod, no migration created them)
ALTER TABLE public.documents          ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE public.documents          ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;
ALTER TABLE public.email_connections  ADD COLUMN IF NOT EXISTS last_synced_email_at timestamptz;

-- ── 2) [EMAIL-REAUTH] Flag a mailbox whose token refresh failed, so a dead connection surfaces
--      (a reconnect prompt + a one-time notification) instead of silently importing nothing.
ALTER TABLE public.email_connections  ADD COLUMN IF NOT EXISTS needs_reauth boolean NOT NULL DEFAULT false;

-- ── 3) Deletion integrity: invoices.document_id had NO on-delete, so deleting an invoice's
--      evidence document raised 23503 and BLOCKED the delete. Match the reverse link (SET NULL).
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_document_id_fkey;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;

-- ── 4) Indexes on the circle's link columns (only cash_entries.invoice_id was covered). These
--      speed up auto-reconcile lookups and the ON DELETE SET NULL scans at scale.
CREATE INDEX IF NOT EXISTS idx_bank_transactions_invoice_id
  ON public.bank_transactions (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_invoice_id
  ON public.documents (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_document_id
  ON public.invoices (document_id) WHERE document_id IS NOT NULL;

-- ── 5) content_hash lookup index (dedup SELECTs scan documents by hash on every intake).
CREATE INDEX IF NOT EXISTS idx_documents_content_hash
  ON public.documents (user_id, content_hash) WHERE content_hash IS NOT NULL;

-- ── 6) [OPTIONAL — race-safe dedup] A UNIQUE index makes the byte-hash dedup atomic (two
--      concurrent uploads of the same file can't both insert). It will FAIL if duplicate
--      (user_id, content_hash) rows already exist. Run the check first; only then uncomment.
--
--   SELECT user_id, content_hash, count(*)
--   FROM public.documents
--   WHERE content_hash IS NOT NULL
--   GROUP BY user_id, content_hash HAVING count(*) > 1;
--
--   -- If that returns 0 rows:
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_user_content_hash
--     ON public.documents (user_id, content_hash) WHERE content_hash IS NOT NULL;
