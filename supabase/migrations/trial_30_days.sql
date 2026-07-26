-- =====================================================================
-- [BILLING] Trial 14 → 30 days.
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: 14 days was chosen without looking at the market. Then we looked.
--
--   · QuickBooks, Xero, FreshBooks: 30 days, no card.
--   · Jortt: 30 days. MoneyMonk: 30 days, explicitly no card.
--   · Moneybird: 60 days.
--   · e-Boekhouden: 15 months free for starters.
--
-- Every leader in SMB accounting runs 14–30 days with no card, and BoekBrug's
-- 14 was the shortest in the Dutch market. Worse, RevenueCat's subscription
-- data finds FINANCE specifically is a category where short trials
-- underperform: people evaluate bookkeeping across several sessions, not one.
--
-- A ZZP'er also needs a full month to see the point of this product at all. The
-- BTW quarter, the bank statement, the accountant hand-off — the things that
-- make BoekBrug worth paying for only show up once a month or once a quarter. A
-- 14-day trial can end before the user has met the feature that would have sold
-- it to them.
--
-- Cost of the change: the marginal cost of a median user is ~€0.20/month, so
-- sixteen extra days is a few cents. There is no cheaper acquisition lever
-- available, and it is one line.
--
-- EXISTING TRIALS ARE EXTENDED, not left short. Anyone still inside a 14-day
-- trial is moved to 30 days from their signup. Nobody's clock ever moves
-- BACKWARD (the GREATEST guard), and an already-expired trial is untouched —
-- reviving it would silently re-grant access to accounts that already lapsed.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- Depends on billing_subscription.sql — apply that first.
-- =====================================================================

BEGIN;

-- New signups get 30 days.
ALTER TABLE public.profiles
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '30 days');

COMMENT ON COLUMN public.profiles.trial_ends_at IS
  '[BILLING] End of the 30-day no-card trial. Set by column DEFAULT at signup — never written by the app, so it cannot be extended by a user.';

-- Extend everyone still inside a trial, and only forward.
--
-- created_at + 30 days is the correct target (not trial_ends_at + 16 days):
-- it makes the rule "your trial is 30 days from signup" true for every account,
-- old and new, rather than creating a cohort with an odd 46-day window.
UPDATE public.profiles
   SET trial_ends_at = GREATEST(trial_ends_at, created_at + interval '30 days')
 WHERE trial_ends_at IS NOT NULL
   AND trial_ends_at > now()          -- still running: never revive a lapsed trial
   AND created_at IS NOT NULL;

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
--   select id, created_at, trial_ends_at,
--          (trial_ends_at::date - created_at::date) as trial_days
--     from public.profiles
--    order by created_at desc limit 10;
--
-- Expect: trial_days = 30 for every account whose trial had not yet expired,
-- and unchanged for any that had. No row should show a trial_ends_at earlier
-- than it had before this migration.
-- =====================================================================
