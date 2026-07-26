-- =====================================================================
-- [A1] Retention purge — make the 7-year erasure timer executable.
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: `api/account/delete` bans the user and stamps
-- deletion_requests.data_eligible_for_deletion_at = now + 7 years, but
-- `isEligibleForDeletion` (src/lib/retention.ts) had NO CALLER anywhere in the
-- app and no purge job existed. The timer was a stored timestamp that nothing
-- ever read: a deleted account's documents rows and every Storage object would
-- persist forever, so GDPR Article 17 erasure never actually executed. See
-- docs/BoekBrug_Security_Hunt_Report.md → A1.
--
-- WHAT THIS ADDS: the single column the purge job needs to be idempotent, plus
-- the index that makes "who is due?" cheap.
--
-- purged_at is the claim marker. The job stamps it when a user's files are
-- erased, and `decidePurge` refuses any row that already carries one — so a
-- re-run, an overlapping run, or a manual replay can never double-purge (and,
-- more importantly, can never delete a second time what a later restore put
-- back).
--
-- NOTE ON SAFETY: this migration is inert on its own. It creates no job and
-- deletes nothing. The purge route additionally ships in DRY-RUN by default
-- (RETENTION_PURGE_ENABLED unset ⇒ it only reports what it WOULD erase), so
-- applying this migration cannot cause a single byte to be deleted.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- =====================================================================

BEGIN;

-- ── 1. The claim marker ──────────────────────────────────────────────
ALTER TABLE public.deletion_requests
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

COMMENT ON COLUMN public.deletion_requests.purged_at IS
  '[A1] When this account''s files were actually erased by the retention purge. Non-null = done; decidePurge() refuses any row that carries one, which is what makes the job idempotent.';

-- ── 2. "Who is due?" without a full scan ─────────────────────────────
-- Partial index: only rows that are still awaiting a purge are ever queried,
-- and that set is tiny compared to the table.
CREATE INDEX IF NOT EXISTS deletion_requests_purge_due_idx
  ON public.deletion_requests (data_eligible_for_deletion_at)
  WHERE purged_at IS NULL AND deleted_at IS NOT NULL;

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
--   select id, user_id, deleted_at, data_eligible_for_deletion_at, purged_at
--     from public.deletion_requests
--    order by created_at desc limit 5;
--
-- Expect: purged_at NULL on every existing row.
--
-- Nothing in this application is due for erasure before 2033 (7 years from the
-- first possible deactivation), so the purge job should report ZERO candidates
-- for years. A non-zero dry-run count before then means something stamped a
-- wrong eligible date — investigate BEFORE enabling the purge.
-- =====================================================================
