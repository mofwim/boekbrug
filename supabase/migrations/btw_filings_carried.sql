-- =====================================================================
-- [SUPPLETIE-VERREKEND] btw_filings — a correction that has been carried into a later aangifte
-- BoekBrug · August 2026
-- =====================================================================
-- WHY: a BTW correction of €1.000 or less does not need a separate suppletie — it may be processed
-- in the next regular aangifte. The app says so. It then has to know that it HAS been, or it would
-- offer the same correction again next quarter, and the owner would declare it twice.
--
-- WHAT IS RECORDED, AND WHY IT IS AN AMOUNT AND NOT A FLAG:
--
--   carried_saldo  — how much BTW of this quarter's divergence has already been declared elsewhere.
--                    A flag would be wrong: a quarter can move AGAIN after a correction was carried,
--                    and what is then still owed is (current − filed) − carried. With a boolean that
--                    second movement would be invisible, which is the more expensive of the two
--                    mistakes — an undeclared correction rather than a repeated one.
--   carried_into_* — which aangifte it went into, so the owner and the accountant can find it back.
--   carried_at     — when. Evidence, in the same spirit as filed_at.
--
-- THE SNAPSHOT IS NOT TOUCHED. The obvious alternative — re-freeze the earlier quarter to its
-- current figures once the difference has been declared — would make the arithmetic work and would
-- destroy the only record of what was actually sent to the Belastingdienst. That record is what
-- every divergence is measured against ([FILING-NO-OVERWRITE] in btw-filing.ts), and losing it is
-- unrecoverable. So the original stays, and what was declared since is recorded beside it.
--
-- NEVER STAMPED AUTOMATICALLY. Marking a correction as carried because a later quarter was filed
-- would assume the owner included it. When they did not — they forgot, or their accountant filed a
-- separate suppletie instead — the app would have silently discharged an obligation that still
-- stands. The owner ticks it, at the moment of filing, with the amount in front of them.
--
-- All nullable, no defaults: a filing with nothing carried says so with NULL. Safe to run twice.
-- =====================================================================

ALTER TABLE public.btw_filings
  ADD COLUMN IF NOT EXISTS carried_saldo numeric;

ALTER TABLE public.btw_filings
  ADD COLUMN IF NOT EXISTS carried_into_year int;

ALTER TABLE public.btw_filings
  ADD COLUMN IF NOT EXISTS carried_into_quarter int;

ALTER TABLE public.btw_filings
  ADD COLUMN IF NOT EXISTS carried_at timestamptz;

-- A carried quarter must name a real quarter, or "verwerkt in 2026-Q7" ends up on a screen an
-- accountant reads. NOT VALID would let existing rows escape it; there are none to escape.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'btw_filings_carried_quarter_check'
  ) THEN
    ALTER TABLE public.btw_filings
      ADD CONSTRAINT btw_filings_carried_quarter_check
      CHECK (carried_into_quarter IS NULL OR carried_into_quarter BETWEEN 1 AND 4);
  END IF;
END $$;

-- ── CONTROLE ─────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'btw_filings'
--     AND column_name LIKE 'carried%'
--   ORDER BY column_name;
--   -- expects: carried_at, carried_into_quarter, carried_into_year, carried_saldo
