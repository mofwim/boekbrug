-- =====================================================================
-- [COST-GUARD] A global ceiling on Anthropic spend, an anonymous rate-limit
-- bucket that actually works, and `role` added to the billing guard.
-- BoekBrug · July 2026
-- =====================================================================
-- Three separate holes, one migration, because all three are "one account can
-- cost the owner unbounded money" and they share a fix window.
--
-- ── 1. THE ANONYMOUS RATE-LIMIT BUCKET NEVER WORKED ──────────────────
-- `rate_limits.user_id` is `uuid NOT NULL REFERENCES profiles(id)`, and
-- check_rate_limit() takes `p_user_id uuid`. Two callers pass something that is
-- not a profile id:
--   · /api/tools/scan-invoice passes 'scan-ip:1.2.3.4'  → not a uuid → cast error
--   · /api/pay/[token]        passes invoices.pay_token → a uuid, but violates the FK
-- and src/lib/rate-limit.ts FAILS OPEN on any error. So the login-free AI
-- scanner — which calls the PAID Claude API with no authentication — has had no
-- durable ceiling at all. Its only surviving guard is an in-memory counter per
-- serverless instance, which that route's own comment admits an attacker
-- bypasses by rotating instances.
--
-- Fixed by ADDING a parallel text-keyed bucket rather than altering the uuid one:
-- the existing function, column, FK and every authenticated caller are left
-- untouched, so this cannot regress a working path.
--
-- ── 2. NO GLOBAL SPEND CEILING ───────────────────────────────────────
-- Every existing limit is PER USER. Six route buckets share AI_OCR at 240/hour;
-- summed, one account can drive ~1.04M Claude calls/month. The email-sync cron
-- has no plan filter and can classify ~240 documents per user per run, twelve
-- runs a day. Per-user quotas cannot bound any of that, because the exposure is
-- the SUM over users and paths.
--
-- What actually protects an unfunded founder with a personal card on the
-- Anthropic account is a single global euro budget per day with a hard stop.
-- ai_budget_consume() below is that: one atomic statement, checked before every
-- Claude call, that refuses once the day's estimated spend is used up.
--
-- ── 3. THE `role` BYPASS IS NOT FIXED HERE — DELIBERATELY ────────────
-- decideAccess() exempts role='accountant' from the paywall unconditionally,
-- and prevent_billing_self_grant does not guard `role`. The obvious fix — add
-- `role` to that trigger — was written, tested against the code, and REJECTED,
-- because it is both breaking and useless:
--
--   * BREAKING: three legitimate paths write `role` with the user's own session
--     client — /api/invite/accept (:87 'zzper', :98 'accountant'),
--     /api/onboarding (the wizard's role step), and the post-signup upsert in
--     src/app/register/page.tsx:175. Guarding the column breaks accountant
--     onboarding and invitation acceptance.
--   * USELESS: src/app/register/page.tsx has a ROLE PICKER ('zzper' |
--     'accountant', :114) whose value flows through signup metadata into
--     handle_new_user(), which honours it. Anyone can simply choose
--     "Accountant" on the signup form. The browser-console trick was never
--     needed, so guarding UPDATE closes nothing.
--
-- role='accountant' is therefore a SELF-DECLARATION, and no trigger can make a
-- self-declaration trustworthy. The fix belongs in the access decision: the
-- exemption now requires EVIDENCE — at least one consented accountant_clients
-- link (self-linking is already blocked by accountant_clients_insert_consent.sql).
-- A real accountant is invited or invites, gets a link, and is free forever. A
-- ZZP'er who ticks "accountant" to dodge the paywall gains nothing but the trial
-- they already had. See src/lib/subscription.ts.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- =====================================================================

BEGIN;

-- ── 1. Anonymous rate-limit bucket ───────────────────────────────────

-- A free-text bucket key for callers that are NOT a profile: an IP, a payment
-- token, a device fingerprint. Kept separate from user_id so the existing
-- uuid+FK path and all its callers are untouched.
ALTER TABLE public.rate_limits
  ADD COLUMN IF NOT EXISTS bucket_key text;

-- user_id must become nullable for a keyed row to exist at all. Widening a NOT
-- NULL is always safe — no existing row is affected.
ALTER TABLE public.rate_limits
  ALTER COLUMN user_id DROP NOT NULL;

-- Exactly one of the two identities must be present. A row with both, or with
-- neither, is a bug we want to hear about immediately.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rate_limits_one_identity'
      AND conrelid = 'public.rate_limits'::regclass
  ) THEN
    ALTER TABLE public.rate_limits
      ADD CONSTRAINT rate_limits_one_identity
      CHECK ((user_id IS NOT NULL) <> (bucket_key IS NOT NULL));
  END IF;
END $$;

-- The uniqueness the counter relies on, for the keyed variant.
CREATE UNIQUE INDEX IF NOT EXISTS rate_limits_bucket_endpoint_key
  ON public.rate_limits (bucket_key, endpoint)
  WHERE bucket_key IS NOT NULL;

COMMENT ON COLUMN public.rate_limits.bucket_key IS
  '[COST-GUARD] Rate-limit identity for callers that are not a profile (an IP, a pay token). Exactly one of user_id / bucket_key is set — see rate_limits_one_identity.';

-- Text-keyed twin of check_rate_limit. Same algorithm, same atomicity: one
-- INSERT ... ON CONFLICT DO UPDATE, so concurrent requests cannot race past it.
CREATE OR REPLACE FUNCTION public.check_rate_limit_key(
  p_bucket_key text,
  p_endpoint text,
  p_max_requests integer,
  p_window_minutes integer
)
RETURNS TABLE(allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now          timestamptz := now();
  v_window_start timestamptz;
  v_count        integer;
BEGIN
  IF p_bucket_key IS NULL OR btrim(p_bucket_key) = '' THEN
    -- No identity → no ceiling is possible → refuse. This is the ONLY safe
    -- answer on an anonymous, money-spending path.
    RETURN QUERY SELECT false, 0, v_now + make_interval(mins => p_window_minutes);
    RETURN;
  END IF;

  INSERT INTO public.rate_limits (bucket_key, endpoint, count, window_start)
  VALUES (p_bucket_key, p_endpoint, 1, v_now)
  ON CONFLICT (bucket_key, endpoint) DO UPDATE
    SET count = CASE
                  WHEN public.rate_limits.window_start
                       < v_now - make_interval(mins => p_window_minutes)
                  THEN 1                               -- window rolled over
                  ELSE public.rate_limits.count + 1
                END,
        window_start = CASE
                  WHEN public.rate_limits.window_start
                       < v_now - make_interval(mins => p_window_minutes)
                  THEN v_now
                  ELSE public.rate_limits.window_start
                END
  RETURNING public.rate_limits.count, public.rate_limits.window_start
       INTO v_count, v_window_start;

  RETURN QUERY SELECT
    v_count <= p_max_requests,
    GREATEST(p_max_requests - v_count, 0),
    v_window_start + make_interval(mins => p_window_minutes);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit_key(text, text, integer, integer)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_key(text, text, integer, integer)
  TO service_role;

-- ── 2. Global AI spend ceiling ───────────────────────────────────────

-- One row per day. Deliberately tiny and global: this is not per-user
-- accounting, it is the fuse on the whole building.
CREATE TABLE IF NOT EXISTS public.ai_spend_daily (
  day date PRIMARY KEY,
  calls integer NOT NULL DEFAULT 0,
  cost_micros bigint NOT NULL DEFAULT 0,  -- millionths of a euro; integers only, no float drift
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_spend_daily IS
  '[COST-GUARD] Global estimated Anthropic spend per UTC day. Written only by ai_budget_consume(). cost_micros is millionths of a euro — integer arithmetic so a fuse can never drift.';

ALTER TABLE public.ai_spend_daily ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service_role bypasses RLS, everyone else sees nothing.
-- This table is infrastructure, never user data.

/**
 * Reserve budget for ONE Claude call, atomically.
 *
 * Returns allowed=false once the day's estimate would exceed p_budget_micros —
 * and reserves NOTHING in that case, so a refused call costs no budget.
 *
 * Called BEFORE the API request (reserve-then-spend). Over-reserving on a call
 * that later fails is the safe direction: the fuse trips slightly early rather
 * than slightly late.
 */
CREATE OR REPLACE FUNCTION public.ai_budget_consume(
  p_cost_micros bigint,
  p_budget_micros bigint
)
RETURNS TABLE(allowed boolean, spent_micros bigint, budget_micros bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_day   date := (now() AT TIME ZONE 'UTC')::date;
  v_spent bigint;
BEGIN
  -- A non-positive budget means "no ceiling configured" → allow, and still
  -- count, so the owner can read real spend before deciding on a number.
  IF p_budget_micros IS NULL OR p_budget_micros <= 0 THEN
    INSERT INTO public.ai_spend_daily (day, calls, cost_micros)
    VALUES (v_day, 1, GREATEST(p_cost_micros, 0))
    ON CONFLICT (day) DO UPDATE
      SET calls = public.ai_spend_daily.calls + 1,
          cost_micros = public.ai_spend_daily.cost_micros + GREATEST(p_cost_micros, 0),
          updated_at = now()
    RETURNING public.ai_spend_daily.cost_micros INTO v_spent;
    RETURN QUERY SELECT true, v_spent, 0::bigint;
    RETURN;
  END IF;

  SELECT cost_micros INTO v_spent
    FROM public.ai_spend_daily WHERE day = v_day FOR UPDATE;

  IF v_spent IS NULL THEN v_spent := 0; END IF;

  IF v_spent + GREATEST(p_cost_micros, 0) > p_budget_micros THEN
    -- Fuse blown. Reserve nothing.
    RETURN QUERY SELECT false, v_spent, p_budget_micros;
    RETURN;
  END IF;

  INSERT INTO public.ai_spend_daily (day, calls, cost_micros)
  VALUES (v_day, 1, GREATEST(p_cost_micros, 0))
  ON CONFLICT (day) DO UPDATE
    SET calls = public.ai_spend_daily.calls + 1,
        cost_micros = public.ai_spend_daily.cost_micros + GREATEST(p_cost_micros, 0),
        updated_at = now()
  RETURNING public.ai_spend_daily.cost_micros INTO v_spent;

  RETURN QUERY SELECT true, v_spent, p_budget_micros;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ai_budget_consume(bigint, bigint)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.ai_budget_consume(bigint, bigint)
  TO service_role;

-- ── 3. Cheap evidence for the accountant exemption ───────────────────
-- The exemption moves from "the user says they are an accountant" to "a
-- consented client link exists". decideAccess() is pure, so the caller supplies
-- that boolean — and the middleware asks on every dashboard request for an
-- accountant. This index makes that an index-only existence check.
CREATE INDEX IF NOT EXISTS accountant_clients_accountant_idx
  ON public.accountant_clients (accountant_id);

-- prevent_billing_self_grant is deliberately LEFT AS IS (see header §3).

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
-- 1. The anonymous bucket now counts instead of failing open:
--      select * from public.check_rate_limit_key('scan-ip:1.2.3.4', '/test', 2, 60);
--      -- run 3×: expect allowed = true, true, false
--
-- 2. An empty key is refused, never allowed:
--      select * from public.check_rate_limit_key('', '/test', 5, 60);  -- allowed = false
--
-- 3. The spend fuse:
--      select * from public.ai_budget_consume(1000, 2500);  -- allowed true, spent 1000
--      select * from public.ai_budget_consume(1000, 2500);  -- allowed true, spent 2000
--      select * from public.ai_budget_consume(1000, 2500);  -- allowed FALSE, spent stays 2000
--      select * from public.ai_spend_daily;
--      delete from public.ai_spend_daily;   -- reset after testing
--
-- 4. The accountant-exemption index exists:
--      select indexname from pg_indexes
--       where tablename = 'accountant_clients'
--         and indexname = 'accountant_clients_accountant_idx';
--
-- No role guard was added — see §3 of the header for why that would have broken
-- accountant onboarding and invitation acceptance without closing anything.
-- =====================================================================
