-- =====================================================================
-- [TRUTH-FILED] btw_filings — the frozen snapshot of a filed BTW-aangifte
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: the living financial truth is fluid — a late invoice retroactively
-- changes a past quarter. But a BTW-aangifte you already SENT to the
-- Belastingdienst is frozen; it does not change. If the two diverge, that is
-- not an error to hide — it is a suppletie the owner must be told about.
--
-- This table records, per (user, year, quarter), the figures AS FILED plus
-- when. The truth surface compares the current live figures to this snapshot
-- and flags the delta: ≤ €1.000 BTW-difference → carry into the next regular
-- aangifte; > €1.000 → a formal suppletie. Display + guidance only; it never
-- changes a computed figure.
--
-- One row per quarter (unique). Re-filing (after a suppletie) upserts the
-- snapshot to the newly-filed figures. Safe to run more than once.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.btw_filings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year               int  NOT NULL,
  quarter            int  NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  filed_at           timestamptz NOT NULL DEFAULT now(),
  -- the frozen figures, exactly as they stood when the owner marked it filed
  omzet              numeric NOT NULL DEFAULT 0,
  kosten             numeric NOT NULL DEFAULT 0,
  btw_verschuldigd   numeric NOT NULL DEFAULT 0,
  btw_voorbelasting  numeric NOT NULL DEFAULT 0,
  btw_saldo          numeric NOT NULL DEFAULT 0,
  UNIQUE (user_id, year, quarter)
);

ALTER TABLE public.btw_filings ENABLE ROW LEVEL SECURITY;

-- Owner-only: a user sees + writes only their own filings (auth.uid() = user_id).
DROP POLICY IF EXISTS "btw_filings own rows" ON public.btw_filings;
CREATE POLICY "btw_filings own rows" ON public.btw_filings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS btw_filings_user_period_idx
  ON public.btw_filings (user_id, year, quarter);
