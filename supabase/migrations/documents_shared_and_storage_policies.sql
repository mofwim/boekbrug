-- =====================================================================
-- [SEC-DOCS-DRIFT] Version-control the prod-only documents objects
-- =====================================================================
-- Problem (audit gap, companion to documents_accountant_read_policy.sql):
--   The app depends on two `documents` columns and three Storage bucket policies
--   that exist ONLY in production — they are absent from database.sql's CREATE
--   TABLE and from every migration:
--     • documents.shared        — the share flag read by /brug, the quarter package,
--                                 and gated by documents_accountant_read.
--     • documents.content_hash  — byte-hash used for cross-path dedup
--                                 (documents.ts, email-integration.ts, intake).
--     • Storage policies documents_upload/read/delete on storage.objects
--                                 (SECTION 8 of database.sql shows them as COMMENTS
--                                 only, "run in the Storage SQL editor, not here").
--   A fresh environment rebuilt from migrations would therefore have neither the
--   columns (every insert referencing `shared`/`content_hash` fails) nor the
--   storage RLS (uploads/reads denied, or — if hand-applied loosely — a cross-user
--   object leak). This migration captures all of it so the gate is reproducible.
--
--   Idempotent (IF NOT EXISTS / DROP+CREATE): applying it against a production DB
--   that already has these objects is a no-op for the columns and a re-assert for
--   the policies. ⚠️ Diff the storage policies against the live ones first
--   (SELECT policyname, qual FROM pg_policies WHERE schemaname='storage';) and note
--   that CREATE POLICY on storage.objects requires the migration role to own /
--   have privileges on the storage schema (the Supabase service role does).

-- ── documents columns ────────────────────────────────────────────────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_hash text;

-- Non-unique index backing the dedup lookups (.eq('content_hash', …)). NOT unique
-- on purpose: a UNIQUE (user_id, content_hash) would break the intentional
-- "upload again" / allowDuplicate feature that creates a second row with the same
-- hash. (See report item A4.)
CREATE INDEX IF NOT EXISTS idx_documents_user_content_hash
  ON public.documents (user_id, content_hash);

-- ── Storage bucket "documents" policies (owner-scoped: key path = <uid>/…) ──
-- The accountant never reads via these — /brug signs client files with the
-- service_role client, which bypasses Storage RLS. So owner-only is complete.
DROP POLICY IF EXISTS "documents_upload" ON storage.objects;
CREATE POLICY "documents_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "documents_read" ON storage.objects;
CREATE POLICY "documents_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "documents_delete" ON storage.objects;
CREATE POLICY "documents_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
