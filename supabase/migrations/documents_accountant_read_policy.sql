-- =====================================================================
-- [SEC-DOCS-RLS] Version-control the accountant document-read policy
-- =====================================================================
-- Problem (audit gap):
--   The policy that decides which of a CLIENT's documents a linked ACCOUNTANT
--   may read — `documents_accountant_read` — plus the `documents.shared` column
--   are referenced all over the code (brug/page.tsx, subject-status, email/file,
--   BestandenPage) but exist ONLY in production: they are absent from database.sql
--   and from every file under supabase/migrations/. The single most security-
--   sensitive gate on the document side was therefore unreviewable, and a fresh
--   environment rebuilt from migrations would create NEITHER the policy nor the
--   column — accountants would silently see zero client docs, or (if hand-applied
--   loosely, e.g. `USING (shared = true)` without the linked-client predicate) a
--   broad version would be a cross-tenant document leak.
--
-- This migration captures the CORRECT policy so it lives in version control and,
-- being idempotent (DROP + CREATE), it also REPAIRS a too-broad production policy
-- if one exists. It is reconstructed to mirror the already-committed, correctly
-- scoped `invoices_accountant_read` (database.sql):
--     USING ( shared = true
--             AND (is_my_accountant_client(sender_id) OR is_my_accountant_client(receiver_id)) )
-- Documents have a single owner column (`user_id`) instead of sender/receiver, and
-- we additionally exclude trashed docs (an owner who trashed a file should not keep
-- exposing it to their accountant — matches the trashed=false filter already applied
-- in /brug, the closing package and subject-status).
--
-- ⚠️ Before applying to production: diff this against the LIVE policy, e.g.
--     SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
--     FROM pg_policy WHERE polrelid = 'public.documents'::regclass;
--   Confirm the live USING clause matches (shared + linked-client + not-trashed).
--   If the live clause is broader, applying this migration tightens it (good); if it
--   carries extra prod-only nuance, fold that in here first.
--
-- Dependencies (both confirmed present in database.sql):
--   • public.documents.shared  boolean       (the share flag the app writes)
--   • public.is_my_accountant_client(uuid)    STABLE SECURITY DEFINER helper:
--       EXISTS (SELECT 1 FROM accountant_clients
--               WHERE accountant_id = auth.uid() AND zzper_id = client)
--
-- This is an ADDITIVE (permissive) SELECT policy: it ORs with documents_select_own,
-- so owners keep full access and accountants gain read-only access to their linked
-- clients' shared, non-trashed documents. No INSERT/UPDATE/DELETE grant is created.

DROP POLICY IF EXISTS documents_accountant_read ON public.documents;

CREATE POLICY documents_accountant_read ON public.documents
  FOR SELECT TO authenticated
  USING (
    shared = true
    AND trashed IS NOT TRUE
    AND is_my_accountant_client(user_id)
  );
