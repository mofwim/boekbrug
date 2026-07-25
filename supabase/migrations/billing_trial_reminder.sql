-- =====================================================================
-- [BILLING] Trial-ending reminder marker.
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: /api/cron/trial-reminder runs daily and mails owners whose free trial is
-- about to end. Without a marker it would mail the same person every single day
-- of the warning window — the fastest way to teach somebody to filter you into
-- spam right before you ask them to pay.
--
-- CLAIM-THEN-SEND: the column is stamped BEFORE the mail goes out, exactly like
-- the invoice-reminder cron claims its tier first. Two overlapping runs then
-- cannot both send, and the worse failure (nagging a customer twice) is made
-- impossible. The cost is that a send which fails after the claim is not
-- retried — which is the right trade: a missed reminder is a nudge, a duplicate
-- reminder is an annoyance you cannot take back.
--
-- Deliberately NOT covered by prevent_billing_self_grant: this is a send-log
-- timestamp, not an entitlement. The worst a user can do by clearing it is mail
-- themselves one extra reminder, and guarding it would mean rewriting the
-- billing trigger for no security gain.
--
-- SEPARATE FILE ON PURPOSE: billing_subscription.sql may already have been
-- applied by hand, and quietly editing an applied migration is how a column
-- silently never lands. This one stands alone and is idempotent.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- =====================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.profiles.trial_reminder_sent_at IS
  '[BILLING] When the "your trial is ending" mail was claimed for this owner. Set BEFORE sending (claim-then-send) so overlapping cron runs cannot double-mail. NULL = never sent.';

-- "Who still needs the mail?" without scanning every profile. The set of owners
-- in an unfinished trial is tiny next to the table.
CREATE INDEX IF NOT EXISTS profiles_trial_reminder_due_idx
  ON public.profiles (trial_ends_at)
  WHERE trial_reminder_sent_at IS NULL;

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
--   select id, trial_ends_at, trial_reminder_sent_at
--     from public.profiles
--    order by trial_ends_at limit 5;
--
-- Expect: trial_reminder_sent_at NULL on every row.
--
-- NOTE: this index and column depend on trial_ends_at, which comes from
-- billing_subscription.sql. Apply that one FIRST.
-- =====================================================================
