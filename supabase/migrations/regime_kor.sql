-- =====================================================================
-- [REGIME-FLAGS] Kleineondernemersregeling (KOR) opt-in on the profile.
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: an owner on the KOR (kleineondernemersregeling) charges NO BTW and
-- files a special return. BoekBrug's concept aangifte still computes a
-- verschuldigde BTW (5a) from the sales — under the KOR that figure must NOT
-- be paid. The app cannot infer the regime from the data, so it must let the
-- owner DECLARE it, and then hand the accountant a flag ("KOR is actief —
-- bereken geen BTW") instead of a silently-wrong 5a. This one boolean is that
-- declaration. It changes NO figure by itself — it only drives the regime flag
-- surfaced in readiness, the closing package and the concept aangifte notes.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- =====================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kor_active boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.kor_active IS
  '[REGIME-FLAGS] Owner has opted into the kleineondernemersregeling (KOR). When true, the owner charges no BTW — surfaced as an accountant-handoff flag so the concept 5a is handled KOR-conform, never paid as computed. Drives only the flag, never a figure.';

COMMIT;
