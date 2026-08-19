-- =====================================================================
-- [SUPPLETIE] btw_filings — when the books first moved away from what was filed
-- BoekBrug · August 2026
-- =====================================================================
-- WHY: art. 10a AWR jo. art. 15 Uitvoeringsbesluit OB 1968 obliges the entrepreneur to report an
-- incorrect BTW-aangifte once they BECOME AWARE of it, and that obligation is time-bound. So the
-- moment of awareness is a fact worth keeping, and the app is the only place that holds it: it is
-- the instant a change landed in a quarter that had already been filed.
--
-- Two columns, two different questions:
--
--   first_divergence_at — when the books FIRST moved after this filing. Never overwritten while a
--                         divergence stands, because the legal clock runs from the first knowledge,
--                         not the most recent edit. Cleared when the quarter is re-filed (the
--                         suppletie has then been made and a new snapshot is the new truth).
--   last_divergence_at  — the most recent movement. Diagnostic: it tells an accountant whether a
--                         quarter is still being worked on or has been sitting untouched.
--
-- DELIBERATELY NOT A DEADLINE. The owner's screens show no countdown until the eight-week rule has
-- been confirmed with their own accountant — a wrong deadline on a financial screen is worse than
-- no deadline. The timestamp is recorded from today so the answer exists when that is settled;
-- it cannot be reconstructed afterwards.
--
-- Both nullable, no default: a filing made before this migration has no known divergence moment,
-- and NULL says exactly that. Safe to run more than once.
-- =====================================================================

ALTER TABLE public.btw_filings
  ADD COLUMN IF NOT EXISTS first_divergence_at timestamptz;

ALTER TABLE public.btw_filings
  ADD COLUMN IF NOT EXISTS last_divergence_at timestamptz;

-- The accountant's morning run asks one question of this table: "which of my clients have a filed
-- quarter that has moved?". Without an index that is a full scan per run; with it, the answer comes
-- from the rows that actually carry a stamp — a small minority, by design.
CREATE INDEX IF NOT EXISTS btw_filings_diverged_idx
  ON public.btw_filings (user_id, first_divergence_at)
  WHERE first_divergence_at IS NOT NULL;

-- ── CONTROLE ─────────────────────────────────────────────────────────
-- Run after applying; both rows must come back 'true'.
--
--   SELECT 'first_divergence_at' AS kolom,
--          EXISTS (SELECT 1 FROM information_schema.columns
--                  WHERE table_schema = 'public' AND table_name = 'btw_filings'
--                    AND column_name = 'first_divergence_at') AS aanwezig
--   UNION ALL
--   SELECT 'last_divergence_at',
--          EXISTS (SELECT 1 FROM information_schema.columns
--                  WHERE table_schema = 'public' AND table_name = 'btw_filings'
--                    AND column_name = 'last_divergence_at');
