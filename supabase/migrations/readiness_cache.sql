-- supabase/migrations/readiness_cache.sql
-- [SNEL-BORD] The last readiness report computed for one owner's quarter, kept so the accountant's
-- board can show something the moment it opens.
--
-- APPLY: run in the Supabase SQL editor. Creates one table. No existing data is read, written or
-- moved by applying it. Idempotent.
--
-- ── WHY A CACHE AND NOT A FASTER QUERY ──
-- /api/readiness is a projection over the whole administration: ~22 database rounds and, measured
-- on the live file, about 1.500 rows for one client for one quarter. That is the honest price of
-- the answer and it is not the problem. The problem is that the werkboard fires it ONCE PER CLIENT,
-- four at a time. An office with eighty clients therefore pays that price eighty times every time
-- somebody opens the board, and stares at "laden" while it happens. The economics do not widen.
--
-- ── WHY THIS IS NOT A SECOND AUTHORITY ──
-- Nothing computes readiness here. This table only ever holds what /api/readiness ITSELF produced,
-- written by that route at the end of its own run, keyed on exactly what the answer depends on:
-- the owner, the year and the quarter. The report is a pure function of those three (the caller's
-- identity decides only whether they may ASK), which is what makes one row per key correct — an
-- accountant and an owner looking at the same quarter get the same report, so they may share it.
--
-- If readiness ever starts depending on who is asking, this table becomes wrong and the key has to
-- grow. That is the one assumption worth writing down.
--
-- ── AND WHY IT MAY NEVER LOOK FRESH ──
-- A cached verdict is a statement about a moment that has passed. The board therefore prints WHEN
-- each figure was computed and refreshes every row behind it, so a stale number is visibly stale
-- and briefly so. computed_at is not decoration; it is the half of the answer that makes the other
-- half honest.

CREATE TABLE IF NOT EXISTS public.readiness_cache (
  owner_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year        int         NOT NULL,
  quarter     int         NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  -- The report object exactly as /api/readiness returned it. Stored whole and never picked apart
  -- in SQL: the moment this table starts holding a SELECTION of the report, the board and the
  -- route are reading two different things and the drift begins.
  report      jsonb       NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, year, quarter)
);

-- The board asks for one quarter across many owners.
CREATE INDEX IF NOT EXISTS readiness_cache_quarter_idx
  ON public.readiness_cache (year, quarter);

-- RLS on, and deliberately NO policies: this table is written and read by the service role only.
-- An accountant's session may not read a client's administration directly, and the report is that
-- administration in summary — the routes prove the link first and then read as the pipeline.
ALTER TABLE public.readiness_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.readiness_cache FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.readiness_cache IS
  'Laatste readiness-rapport per eigenaar per kwartaal, zoals /api/readiness het zelf berekende. Geen eigen berekening; alleen een opname met het moment erbij. Zie src/lib/readiness-cache.ts.';

-- ── CONTROLE ───────────────────────────────────────────────────────────────────
-- Na het openen van één readiness-scherm hoort hier één rij te staan:
--   SELECT owner_id, year, quarter, computed_at, jsonb_typeof(report) FROM public.readiness_cache;
-- En vanuit een browsersessie mag het niet kunnen:
--   SELECT has_table_privilege('authenticated', 'public.readiness_cache', 'SELECT');  -- false
