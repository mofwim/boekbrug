-- =====================================================================
-- [COST-GUARD] The settlement: correct a reservation to what the call
-- really cost.
-- BoekBrug · August 2026
-- =====================================================================
-- ai_spend_guard.sql gave the app a global daily fuse, charged BEFORE each
-- Claude call from an estimate. That estimate has to guess two things it cannot
-- know yet, and both guesses are high by design:
--
--   · the answer length. It reserves max_tokens (2000); a real invoice
--     extraction answers in ~400. Output tokens cost 5× input, so this single
--     guess is most of the error.
--   · the cache state. It charges every input token at the cache-WRITE rate
--     (1.25× input); inside a batch the ~4,300-token system prompt is a cache
--     READ at 0.1× — a 12× spread on the largest part of the input.
--
-- Reserving high is correct. KEEPING the high number is not, and here is what
-- it cost in practice: at ~€0.019 reserved per document, a €5 day blew the fuse
-- at ~260 reads while the real spend was under €2. And because the fuse is
-- GLOBAL, the owner who imported a quarter of backlog on a Tuesday afternoon
-- turned off automatic reading for every other user until midnight UTC.
--
-- This function is the correction. src/lib/ai-budget.ts calls it within
-- milliseconds of each response with the difference between the reservation and
-- the tokens Anthropic actually reported. Same €5, roughly 700 real documents.
--
-- ── THREE THINGS IT DELIBERATELY DOES NOT DO ─────────────────────────
--
-- 1. It does not touch `calls`. That column counts CALLS, and a settlement is
--    not a call. Adding to it here would double every number in the only place
--    the owner can see how much the app is actually doing.
--
-- 2. It never lets the day's total go below zero. A refund can only arrive
--    after its own reservation, so a negative total means something is wrong —
--    and a fuse that has been driven negative is a fuse that no longer trips.
--    GREATEST(..., 0) makes that state unreachable rather than merely unlikely.
--
-- 3. It does not create today's row. If there is nothing to settle against, the
--    reservation belonged to YESTERDAY (a call that crossed midnight UTC) and
--    refunding it out of today's budget would be taking money from the wrong
--    day. The old day keeps its slight over-count, which is the safe direction:
--    a fuse that trips early is a nuisance, one that trips late is a bill.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- Depends on ai_spend_guard.sql (public.ai_spend_daily).
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.ai_budget_settle(p_delta_micros bigint)
RETURNS TABLE(settled boolean, spent_micros bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_day   date := (now() AT TIME ZONE 'UTC')::date;
  v_spent bigint;
BEGIN
  IF p_delta_micros IS NULL OR p_delta_micros = 0 THEN
    SELECT cost_micros INTO v_spent FROM public.ai_spend_daily WHERE day = v_day;
    RETURN QUERY SELECT false, COALESCE(v_spent, 0::bigint);
    RETURN;
  END IF;

  -- UPDATE only, never INSERT — see §3 of the header. FOR UPDATE is implicit in
  -- the UPDATE itself, so two settlements of two concurrent calls serialise.
  UPDATE public.ai_spend_daily
     SET cost_micros = GREATEST(cost_micros + p_delta_micros, 0),
         updated_at = now()
   WHERE day = v_day
  RETURNING public.ai_spend_daily.cost_micros INTO v_spent;

  IF v_spent IS NULL THEN
    -- No row for today: the reservation was made before midnight UTC. Leave it.
    RETURN QUERY SELECT false, 0::bigint;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_spent;
END;
$$;

COMMENT ON FUNCTION public.ai_budget_settle(bigint) IS
  '[COST-GUARD] Adjust today''s estimated spend by the difference between a reservation and the tokens Anthropic actually reported. Never changes `calls`, never goes below zero, never creates a day.';

REVOKE EXECUTE ON FUNCTION public.ai_budget_settle(bigint)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.ai_budget_settle(bigint)
  TO service_role;

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
-- 1. A reservation, then its refund:
--      select * from public.ai_budget_consume(19250, 5000000);  -- allowed, spent 19250
--      select * from public.ai_budget_settle(-12000);           -- settled t, spent 7250
--      select * from public.ai_spend_daily;                     -- calls = 1, NOT 2
--
-- 2. A call that turned out DEARER than estimated is charged, not ignored:
--      select * from public.ai_budget_settle(3000);             -- spent 10250
--
-- 3. The floor holds — a refund larger than the day cannot go negative:
--      select * from public.ai_budget_settle(-999999999);       -- spent 0, never < 0
--
-- 4. Nothing to settle against is a no-op, not a new row:
--      delete from public.ai_spend_daily;
--      select * from public.ai_budget_settle(-500);             -- settled f, spent 0
--      select count(*) from public.ai_spend_daily;              -- 0
--
--    Clean up after testing:
--      delete from public.ai_spend_daily;
-- =====================================================================

-- ── CONTROLE ───────────────────────────────────────────────────────────────────
--
-- Dit bestand had er geen, en dat is niet los te zien van het feit dat het maandenlang
-- ongemerkt NIET toegepast was. De zekering telde wél, maar corrigeerde nooit.
--
-- 1) Staat de functie er, en mag alleen de server erbij?
--    Verwacht: één rij, anon = false, authenticated = false, service_role = true.
--
--   SELECT p.proname,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'ai_budget_settle';
--
-- 2) En of hij ook echt gebruikt wordt. Draai dit NA een dag waarop de app AI heeft gedaan:
--    `updated_at` hoort dan LATER te zijn dan het moment waarop de dag begon, want elke
--    afrekening raakt die kolom aan. Blijft updated_at gelijk aan het eerste call-moment, dan
--    komt settleAiBudget niet langs — en staat de schatting er nog steeds.
--
--   SELECT day, calls, cost_micros, updated_at FROM public.ai_spend_daily ORDER BY day DESC LIMIT 7;
--
-- ── WAT DEZE MIGRATIE MET TERUGWERKENDE KRACHT NIET DOET ──
--
-- Niets. En dat is opzet, maar het heeft een gevolg dat je moet weten voordat je een grens kiest.
--
-- De functie raakt alleen de rij van VANDAAG aan (`WHERE day = v_day`) en maakt nooit een dag aan.
-- Alle dagen die vóór het toepassen zijn weggeschreven, dragen dus nog steeds de RESERVERING en
-- niet het werkelijke verbruik — en die reservering is bewust aan de ruime kant.
--
-- Dit document adviseert AI_DAILY_BUDGET_EUR=0 te draaien om "je werkelijke uitgaven te leren
-- kennen voordat je een getal kiest". Doe dat oordeel dus op de dagen VANAF vandaag. De oudere
-- rijen lezen te hoog, en een grens die daarop wordt gekozen valt te ruim uit — precies de
-- verkeerde kant voor een zekering.
