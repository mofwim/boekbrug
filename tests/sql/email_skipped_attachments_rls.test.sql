-- migrations: email_skipped_attachments_owner_read.sql
-- =====================================================================
-- [OBSERVABILITY] The skip registry must be readable by its owner — and by nobody else.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- WHY THIS FILE EXISTS
-- On 19 August 2026 `public.email_skipped_attachments` had RLS ENABLED and ZERO policies in
-- production. The import pipeline writes it as service_role, so rows landed fine — 335 of them.
-- /api/email/skipped reads it on the user-facing client, where RLS applies, and a table with no
-- policy returns NOTHING and raises NO ERROR.
--
-- So "Overgeslagen bij import (en waarom)" — the panel whose whole purpose is that no attachment
-- is ever silently lost — told an owner with 324 skipped files that nothing had been skipped.
--
-- The route was not careless. It checks the error it expected and answers 503 rather than an
-- empty list. But an RLS denial is not an error: it is a successful read of zero rows, so every
-- guard passed and the panel printed reassurance. That is the whole lesson of this file — the
-- failure mode was invisible to the application layer by construction, so the proof has to live
-- at the database.
--
-- WHAT IS ASSERTED
--   · the owner reads their OWN rows           — the bug, in its positive form
--   · the owner reads NOBODY else's            — the thing a fix could easily overshoot
--   · a stranger with a session reads none
--   · an unauthenticated session reads none
--   · the policy is SELECT-only                — the pipeline writes as service_role; a session
--                                                that could write its own skip history would be
--                                                able to fake its own import diagnostics
--
-- The first assertion is also this file's control: with the policy dropped it returns 0, which is
-- precisely the production defect, so a harness that silently stopped applying RLS would fail
-- here before it could pass anything else.
--
-- MECHANICS, same as invoice_rls_isolation.test.sql: auth.uid() is re-bound to a session GUC so
-- one connection can impersonate each actor, and impersonated statements run under
-- SET ROLE authenticated — never the table owner, whom RLS does not apply to.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

-- ── What the pipeline wrote (service_role, RLS never applies to the table owner) ──────────────
-- Two owners, because "the owner sees their rows" and "the owner sees ONLY their rows" are
-- different claims and a single-tenant fixture can only ever prove the first one.
INSERT INTO public.email_skipped_attachments (user_id, source_message_id, filename, reason) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'msg-1:a.pdf', 'a.pdf', 'geen factuur'),
  ('c0000000-0000-0000-0000-000000000001', 'msg-2:b.pdf', 'b.pdf', 'te groot'),
  ('c0000000-0000-0000-0000-000000000001', 'msg-3:c.jpg', 'c.jpg', 'onleesbaar'),
  ('d0000000-0000-0000-0000-000000000002', 'msg-4:d.pdf', 'd.pdf', 'geen factuur');

SET ROLE authenticated;

-- ── C reads exactly their own three, and not D's ─────────────────────────────────────────────
SELECT set_config('test.uid', 'c0000000-0000-0000-0000-000000000001', false);
DO $$
DECLARE n int; leaked int;
BEGIN
  SELECT count(*) INTO n FROM public.email_skipped_attachments;
  IF n <> 3 THEN
    RAISE EXCEPTION '[OBSERVABILITY] the owner must read their own 3 skipped rows, read: %. '
      'Zero here is the production bug: the panel then reports "niets overgeslagen".', n;
  END IF;

  SELECT count(*) INTO leaked FROM public.email_skipped_attachments
   WHERE user_id <> 'c0000000-0000-0000-0000-000000000001';
  IF leaked <> 0 THEN
    RAISE EXCEPTION '[OBSERVABILITY] the owner reached % row(s) belonging to someone else', leaked;
  END IF;
END $$;

-- ── D sees only their own one ────────────────────────────────────────────────────────────────
SELECT set_config('test.uid', 'd0000000-0000-0000-0000-000000000002', false);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.email_skipped_attachments;
  IF n <> 1 THEN
    RAISE EXCEPTION '[OBSERVABILITY] the second owner must read exactly their own row, read: %', n;
  END IF;
END $$;

-- ── A stranger with a valid session sees nothing ─────────────────────────────────────────────
-- Filenames are business information: who invoices this owner, and what they call things.
SELECT set_config('test.uid', 'e0000000-0000-0000-0000-0000000000ee', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.email_skipped_attachments) <> 0 THEN
    RAISE EXCEPTION '[OBSERVABILITY] a stranger reached another owner''s skipped filenames';
  END IF;
END $$;

-- ── No session at all sees nothing ───────────────────────────────────────────────────────────
-- The policy is granted TO authenticated, so this is belt and braces — but "anon can read it"
-- is exactly the kind of widening a later, well-meant edit makes while fixing something else.
SELECT set_config('test.uid', '', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.email_skipped_attachments) <> 0 THEN
    RAISE EXCEPTION '[OBSERVABILITY] an unauthenticated session reached the skip registry';
  END IF;
END $$;

RESET ROLE;

-- ── The grant stays a READ ───────────────────────────────────────────────────────────────────
-- Asserted against the catalogue rather than by attempting a write, because a failed INSERT under
-- RLS and a failed INSERT for any other reason look identical from the client side.
DO $$
DECLARE cmds text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT cmd ORDER BY cmd), '{}') INTO cmds
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'email_skipped_attachments';
  IF cmds <> ARRAY['SELECT']::text[] THEN
    RAISE EXCEPTION '[OBSERVABILITY] the skip registry must carry SELECT policies only, has: %. '
      'The pipeline writes it as service_role; a session that can write its own skip history can '
      'fake its own import diagnostics.', cmds;
  END IF;
END $$;

SELECT '✅ [OBSERVABILITY] the skip registry reads for its owner, and for no one else.' AS result;
