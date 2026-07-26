# BoekBrug — Go-live runbook

*Everything left before BoekBrug can take its first euro. July 2026.*

> **Read this first.** Every code task is done, tested and pushed. What remains
> on this page is almost entirely **real-world action only you can take** — a
> KVK number, a bank account, a Stripe login, ten conversations. That is not a
> gap in the work; it is where the work stops being code.
>
> Nothing here is urgent in the "the app is broken" sense. The app is live-safe
> today: billing ships dark, the purge ships dry-run, and nobody is charged or
> locked out until you decide otherwise.

---

## 0. State of play

| | |
|---|---|
| **Can the app take money?** | Yes — code-complete, shipped **dark** (`BILLING_ENFORCED` unset). |
| **Is anyone being charged?** | No. Not one line of billing code can charge anybody until you set live keys AND flip the switch. |
| **Is anything blocking a deploy?** | No. `tsc` clean · 105/105 test files (61 on the access decision) · eslint clean on touched files · production build green. |
| **Biggest remaining security item** | The SheetJS upgrade (§4) — one command. |
| **Trial length** | **30 days**, no card. Matches every leader in SMB accounting. |
| **When a trial lapses** | The account drops to read-only **Archief** — never locked out of its own records. |
| **Biggest remaining *business* item** | Ten conversations (§5). Not code. |

---

## 1. Before you can charge anything (real-world)

1. **KVK registration + a business bank account.** Stripe will not pay out
   without them. If either is missing, nothing below can proceed.
2. **Create a Stripe account** and complete business verification. Allow a few
   days — verification is not instant.
3. **Create one product, one price:** `€ 12,00 / month`, EUR, **incl. 21% btw**.
   Dutch B2C prices are quoted inclusive, and the number on `/prijzen` comes
   from `PLAN.priceLabel` in `src/lib/plan.ts` — showing one price and
   charging another is the single most damaging bug a pricing page can have, so
   keep the two identical.
4. **Enable iDEAL** as a payment method. Card-only would lose real Dutch
   customers at the last click.
5. **Enable Stripe Invoicing** so every charge produces a btw-invoice — you are
   legally required to issue one.
6. **Enable the Billing Portal** (Settings → Billing → Customer portal) with
   *cancel subscription* allowed. Self-serve cancel is not optional under EU
   consumer law, and it is what `/api/billing/portal` opens.

---

## 2. Apply the five migrations

In the Supabase SQL editor, in this order. All are idempotent and delete
nothing; each ends with a VERIFY block — run it.

| # | File | What it does |
|---|---|---|
| 1 | `supabase/migrations/billing_subscription.sql` | Subscription columns + the **self-grant guard trigger**. Without the trigger, any logged-in user could set `subscription_plan='pro'` from their browser console. |
| 2 | `supabase/migrations/billing_trial_reminder.sql` | The trial-reminder send log. **Depends on #1** — apply it second. |
| 3 | `supabase/migrations/trial_30_days.sql` | Trial 14 → 30 days, and extends every trial still running. **Depends on #1.** |
| 4 | `supabase/migrations/retention_purge.sql` | `purged_at`, so GDPR erasure can be idempotent. Inert on its own. |
| 5 | `supabase/migrations/ai_spend_guard.sql` | **Apply this one first if you apply nothing else today.** The global Anthropic spend fuse plus a working anonymous rate-limit bucket — until it lands, the login-free AI scanner has no durable cost ceiling at all. |

Two older migrations are still listed as pending in `docs/WORK_QUEUE.md`
(`circle_integrity_and_indexes.sql`, `ledger_daily.sql`). Unlike the ones
above, **those two gate existing features** — a ledger upload cannot save until
`ledger_daily` exists. Worth clearing while you are in the SQL editor.

---

## 3. Environment variables (Vercel → Settings → Environment Variables)

```
STRIPE_SECRET_KEY=sk_test_...      ← test keys FIRST
STRIPE_PRICE_ID=price_...          ← differs between test and live mode
STRIPE_WEBHOOK_SECRET=whsec_...
BILLING_ENFORCED=                  ← leave UNSET until §6
RETENTION_PURGE_ENABLED=           ← leave UNSET. Probably forever.
AI_DAILY_BUDGET_EUR=0              ← 0 = count spend, do not limit. The right
                                     setting for your first days: you learn the
                                     real shape of your Anthropic bill before
                                     choosing a ceiling. Unset would mean €5/day.
```

Then **Stripe → Developers → Webhooks → add endpoint**:

- URL: `https://boekbrug.nl/api/billing/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`
- Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

> That signing secret is the only thing standing between a public endpoint and
> anyone on the internet granting themselves a paid plan. Without it the webhook
> refuses every event, by design.

---

## 4. The one open security item

SheetJS is pinned at `xlsx@0.18.5` with two live CVEs. The fixed releases were
never published to npm — SheetJS left the registry — so this is a dependency
**source** change, and it needs an environment that can reach `cdn.sheetjs.com`
(the session that shipped the containment was blocked by egress policy):

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm audit            # expect: no xlsx advisories
npx tsc --noEmit && npx tsx --test src/lib/*.test.ts && npm run build
```

Then upload one real Z-report, one grootboek export and one bank `.xlsx` to
confirm parsing is unchanged.

**Until then you are not exposed to the worse half.** The prototype-pollution
CVE is contained at the parser boundary (`xlsx-adapter.ts`), and the ReDoS is
bounded. Do this before onboarding people who upload files, not after.

`package.json` was deliberately left pointing at 0.18.5 rather than at a tarball
that could not be installed or tested here — an unverifiable dependency change
would risk breaking every build.

---

## 5. Prove it works, then go live

**In test mode** (test keys + the test-mode price id):

1. Subscribe with card `4242 4242 4242 4242`. Then again with test iDEAL.
2. Watch the webhook land (Stripe → Webhooks → recent deliveries) and the
   profile flip to `active`/`pro`.
3. Cancel via the portal → confirm access survives to `current_period_end`.
4. Re-subscribe → confirm it returns to `active`.
5. Trigger a failed payment → confirm the "betaling niet gelukt" mail arrives
   **and that access is not lost** (`past_due` keeps people in on purpose).
6. Confirm a btw-invoice was generated and downloads from the portal.

**Then, and only then:**

7. Swap to **live keys and the live price id** (they differ per mode).
8. Put **one real €12 payment through on your own account.** Check the money
   lands and the invoice is valid.
9. Set `BILLING_ENFORCED=true`.

The paywall is now live.

---

## 6. The experiment this was all for

Building the machine was never the point. The point is the number it produces.

- **Cohort:** 10 hand-picked people — 6 ZZP'ers, 2 accountants, 2 from a ZZP or
  expat community. Onboard each personally.
- **The ask:** €12/month. Not "try it free" — *ask for the card*.
- **Measure:** signup → activation (first invoice sent or first document
  scanned) → **paid**.
- **Decision gate:** **≥3 of 10 pay** → double down, and only then run a small
  (€100–200) ads test to measure CAC. **0 pay** → interview every refuser. Their
  answer is worth more than any strategy document, this one included.

**No paid advertising until that gate passes.** Ads magnify what works; there is
nothing proven to magnify yet. Until a stranger pays you, everything above is a
very well-tested hypothesis.

---

## 7. Watch these in week one

| Where | What you are looking for |
|---|---|
| Stripe → Webhooks | Any delivery that is not 200. A failing webhook means someone paid and the app does not know. |
| Vercel logs, `[BILLING]` | `UNATTRIBUTED subscription` — a real payment that could not be matched to an account. Needs a human immediately. |
| Vercel logs, `[SEC-XLSX]` | `prototype pollution attempt detected` — somebody uploaded a hostile spreadsheet. |
| Vercel logs, `[CRON-RETENTION]` | Any candidate at all. Nothing can be due before 2033; a candidate now means a wrong date was stamped. Investigate, do not enable. |
| Sentry | New errors in `/api/billing/*` and the two new crons. |

---

## 8. What is deliberately not built

Annual plans · accountant plans · coupons · proration · a full dunning sequence ·
Mollie · multi-currency · feature-level free tier. Each is an answer to a
question you have not earned yet, and the one-price experiment is cleaner
without them. Reasoning per item: `docs/BILLING.md` §7.

One accepted limitation: when a ZZP'er's trial expires, their accountant loses
the bridge to that client's documents. With ten hand-picked users that is a
conversation, not an outage — but revisit it before opening the bookkeeper
channel properly.

---

*Related: `docs/BILLING.md` (how billing works) · `docs/BoekBrug_Security_Hunt_Report.md`
(what has been hardened) · `docs/WORK_QUEUE.md` (older pending items).*
