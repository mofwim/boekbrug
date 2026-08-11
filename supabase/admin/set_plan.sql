-- supabase/admin/set_plan.sql
-- [PLAN-HAND] Give one account the Plus limits by hand, and take them back again.
--
-- ⚠ THIS FILE WRITES. It lives in supabase/admin/ and not in supabase/queries/ for that reason:
--   everything under queries/ is read-only and a test enforces it. Anything here changes data.
--
-- ── WHY THIS IS AN UPDATE AND NOT A CODE CHANGE ──
--
-- The product already has exactly one answer to "who has no monthly limit", and it is the plan:
--
--     limitForPlan()   if (plan !== "free") return 0;      // 0 means: no limit
--     decidePlan()     subscription_status = 'active'  ->  plan 'plus'
--
-- Verified by running it: 'active' and 'past_due' and 'paused' all resolve to plus with the
-- aiDocuments limit reported as NONE, while null and 'canceled' resolve to free with a limit of 50.
--
-- So an owner exemption is DATA. Writing a second mechanism in code — a hardcoded id, an env
-- allowlist — would create a second answer to the same question, and two answers about who has a
-- limit is how the billing screen ends up saying one thing while the gate does another. It would
-- also need a deploy to change, and could not be undone from a SQL console at two in the morning.
--
-- ── WHAT IT COSTS, HONESTLY ──
--
--   · Settings → Facturering will read "BoekBrug Plus — actief". That is true of the LIMITS and
--     not of any payment; there is no Stripe subscription behind it and none is created.
--   · Nothing charges. Checkout is the only thing that talks to Stripe, and it is not involved.
--   · The Stripe webhook is the only writer of subscription_status, and it writes per Stripe
--     event for a profile matched by a Stripe customer. An account with no stripe_customer_id
--     never matches one, so nothing will overwrite this value behind your back.
--   · "Beheer abonnement" renders its no-subscription form, because stripe_customer_id stays
--     null. It does not open a Stripe portal that would fail.
--
-- ── WHAT NOT TO DO ──
--
-- Do NOT set role = 'accountant' to get the same effect. It also gives unlimited use, and it
-- replaces the entire interface with the accountant portal: a different navigation, different
-- screens, and your own bookkeeping is no longer what the app is showing you.

-- ═══ GRANT ════════════════════════════════════════════════════════════════════════════════════
-- Replace the id. This one is from the [EERLIJK-GEBRUIK] log line that prompted it.

UPDATE public.profiles
SET subscription_status = 'active'
WHERE id = 'ac22189e-7052-4c48-b4ec-90947cf92ecc'
RETURNING id, role, subscription_status, current_period_end;

-- Read it back through the same fields the gate reads, so the answer comes from the data and not
-- from this file's own promise about it. Expect: role 'zzper', subscription_status 'active'.
SELECT id, role, subscription_status, current_period_end, stripe_customer_id
FROM public.profiles
WHERE id = 'ac22189e-7052-4c48-b4ec-90947cf92ecc';


-- ═══ REVOKE ═══════════════════════════════════════════════════════════════════════════════════
-- Back to the free limits. NULL, not 'canceled': both resolve to free, but 'canceled' says a
-- subscription ended and there never was one — a false trace in your own records.
--
-- UPDATE public.profiles
-- SET subscription_status = NULL
-- WHERE id = 'ac22189e-7052-4c48-b4ec-90947cf92ecc'
-- RETURNING id, subscription_status;


-- ═══ THE MONTH ALREADY SPENT ══════════════════════════════════════════════════════════════════
-- The grant lifts the limit from now on. It does not un-hold the ten invoices that were already
-- left unread this month — those are still sitting in the mailbox with the sync deferring them.
-- The next email-sync run picks them up on its own, because the plan is read fresh every run.
--
-- To see where the counter stands for this account, without changing anything:
--
-- SELECT period, metric, count
-- FROM public.usage_counters
-- WHERE user_id = 'ac22189e-7052-4c48-b4ec-90947cf92ecc'
-- ORDER BY period DESC, metric;
