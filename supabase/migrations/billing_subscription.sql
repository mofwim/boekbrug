-- =====================================================================
-- [BILLING] Subscription state on profiles + self-grant guard.
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: the app could not take money. `profiles` already carried
-- `subscription_plan` (default 'free') and `subscription_stripe_id` from the
-- original design, but nothing ever wrote them, there was no trial clock, no
-- Stripe customer link and no renewal date — so every account was free forever
-- and the single most important business question ("will anyone pay?") could
-- not be asked. This migration adds the minimum state a Stripe subscription
-- needs, and closes the hole that state opens.
--
-- THE HOLE THIS CLOSES: policy `profiles_update_own` is
--   FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid())
-- with NO column restriction. RLS is the only guard in front of the public anon
-- key, so the moment billing columns exist ANY logged-in user could run
--   update profiles set subscription_plan='pro', subscription_status='active'
-- straight from the browser and hand themselves a paid plan. The guard trigger
-- below makes the billing columns writable by the service-role webhook only —
-- the same shape as the existing `prevent_accountant_amount_changes` guard.
--
-- WHY A DEFAULT ON trial_ends_at (and not an app write): giving the column a
-- DEFAULT means (a) Postgres back-fills every EXISTING row in one shot, so no
-- current user — including the owner — is ever locked out by a NULL trial, and
-- (b) new signups are stamped by `handle_new_user()` without that trigger even
-- naming the column. The trial clock therefore has no app write path at all,
-- which is also why the guard trigger can forbid user writes outright.
-- `now()` is STABLE, so ADD COLUMN takes the fast path: no table rewrite, and
-- every pre-existing row gets the same "14 days from migration time".
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent — safe to
-- re-run. The application ships DARK (BILLING_ENFORCED unset ⇒ nobody is ever
-- redirected) and reads these columns defensively, so applying this migration
-- late never breaks the app; it only unlocks the paywall once enforcement is
-- switched on.
-- =====================================================================

BEGIN;

-- ── 1. Columns ───────────────────────────────────────────────────────

-- Lifecycle state. Normalised in src/lib/billing.ts from the raw Stripe
-- subscription status; 'none' means "never had a subscription".
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trialing';

-- End of the no-card trial. Defaulted (see header) so existing rows back-fill.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '14 days');

-- Stripe Customer id (cus_...). One customer per profile — see unique index.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- End of the paid period Stripe has already collected for. Access survives
-- until this moment even after a cancellation, which is what the customer paid
-- for, so cancelling is never punitive.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

-- ── 2. Allowed values ────────────────────────────────────────────────
-- Idempotent: only added when absent, so a re-run is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_subscription_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_subscription_status_check
      CHECK (subscription_status = ANY (ARRAY[
        'none'::text,       -- never subscribed, trial spent
        'trialing'::text,   -- inside the free trial (trial_ends_at in the future)
        'active'::text,     -- paying
        'past_due'::text,   -- payment failed, Stripe is retrying (still allowed in)
        'unpaid'::text,     -- retries exhausted
        'paused'::text,     -- Stripe pause collection
        'incomplete'::text, -- first payment never completed
        'canceled'::text    -- ended (access may still run to current_period_end)
      ]));
  END IF;
END $$;

-- ── 3. Lookup index ──────────────────────────────────────────────────
-- The Stripe webhook arrives knowing only the Stripe customer id and must find
-- the profile by it — without this every event is a full table scan. UNIQUE
-- additionally makes a split-brain (two profiles sharing one Stripe customer,
-- i.e. two accounts on one subscription) impossible at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_customer_id_key
  ON public.profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ── 4. Documentation ─────────────────────────────────────────────────
COMMENT ON COLUMN public.profiles.subscription_status IS
  '[BILLING] Normalised subscription lifecycle state. Written ONLY by the Stripe webhook via the service-role client (see prevent_billing_self_grant).';
COMMENT ON COLUMN public.profiles.trial_ends_at IS
  '[BILLING] End of the 14-day no-card trial. Set by column DEFAULT at signup — never written by the app, so it cannot be extended by a user.';
COMMENT ON COLUMN public.profiles.stripe_customer_id IS
  '[BILLING] Stripe Customer id (cus_...). Unique — one Stripe customer per profile.';
COMMENT ON COLUMN public.profiles.current_period_end IS
  '[BILLING] End of the paid period already collected by Stripe. Access is honoured until this moment even after cancellation.';

-- ── 5. Self-grant guard ──────────────────────────────────────────────
-- Same shape as public.prevent_accountant_amount_changes: the service-role
-- client (the Stripe webhook) runs with auth.uid() = NULL and is let straight
-- through; everyone else may not move a billing column at all.
--
-- This does NOT disturb any existing write. Every profile update in the app
-- (onboarding PATCH, settings save, invite role flip, kas opening balance,
-- register upsert) patches a narrow set of non-billing columns, so all the
-- IS DISTINCT FROM tests below are false and the row passes through untouched.
CREATE OR REPLACE FUNCTION public.prevent_billing_self_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Exception: service_role / pipeline (auth.uid() = NULL) — the Stripe webhook.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.subscription_status    IS DISTINCT FROM OLD.subscription_status)    OR
     (NEW.subscription_plan      IS DISTINCT FROM OLD.subscription_plan)      OR
     (NEW.subscription_stripe_id IS DISTINCT FROM OLD.subscription_stripe_id) OR
     (NEW.trial_ends_at          IS DISTINCT FROM OLD.trial_ends_at)          OR
     (NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id)     OR
     (NEW.current_period_end     IS DISTINCT FROM OLD.current_period_end)
  THEN
    RAISE EXCEPTION
      'Permission denied: subscription fields are set by the Stripe webhook only (profile_id: %)',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_billing_guard ON public.profiles;
CREATE TRIGGER profiles_billing_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_billing_self_grant();

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
--   select subscription_status, subscription_plan, trial_ends_at,
--          stripe_customer_id, current_period_end
--     from public.profiles limit 5;
--
-- Expect: every existing row 'trialing' / 'free' / a timestamp 14 days out.
--
-- The guard should REJECT this when run as a logged-in user (not the SQL
-- editor, which is service-role and is meant to pass):
--
--   update public.profiles set subscription_plan = 'pro' where id = auth.uid();
--   -- ERROR: Permission denied: subscription fields are set by the Stripe webhook only
-- =====================================================================
