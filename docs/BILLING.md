# BoekBrug — Billing (Stripe subscriptions)

*Single source of truth for how BoekBrug takes money. July 2026.*

> **Status: built, tested, and SHIPPED DARK.** Every file below is on `main`'s
> branch and passes CI, but `BILLING_ENFORCED` is unset, so **nobody is gated
> and nothing is charged**. Turning it on is a four-step checklist (§6), not a
> deploy.
>
> **One plan. €12/month incl. btw. 30-day no-card trial. A read-only Archief
> floor when it lapses — nobody is ever locked out of their own records.**
> Accountants are never billed. Why exactly this shape: §11.

---

## 1. Why this exists

Before this, `profiles` carried `subscription_plan DEFAULT 'free'` and
`subscription_stripe_id` from the original design — and nothing ever wrote
them. There was no trial clock, no Stripe link, no checkout, no paywall. Every
account was free forever, which meant the one question that decides whether
BoekBrug is a business could not be asked: **will anyone pay?**

This is the smallest honest machine that can ask it. Deliberately *not* built:
annual plans, accountant plans, coupons, proration, dunning sequences, Mollie,
multi-currency. Those are answers to questions we have not earned yet.

---

## 2. The shape of it

```
/prijzen  ──POST──▶  /api/billing/checkout  ──▶  Stripe Checkout (hosted)
                                                        │
                                                        │ signed event
                                                        ▼
   profiles  ◀──service-role write──  /api/billing/webhook
      │
      │ read
      ▼
 src/lib/subscription.ts  ──decision──▶  middleware  ·  TrialBanner  ·  /facturering
```

**Two rules the whole design hangs on:**

1. **Stripe is the source of truth for money.** Our `profiles` row is a *cache*
   of what Stripe told us, written by the webhook and by nothing else. A
   success-redirect is a browser navigation and browser navigations can be
   forged; the webhook is HMAC-signed. Never grant a plan on the strength of a
   return URL.
2. **Fail open.** Every ambiguity — missing column, NULL trial, unparseable
   date, unknown Stripe status, unreadable row — resolves to *allowed*. A
   lockout requires positive proof. See §4.

---

## 3. Files

| File | Role |
|---|---|
| `supabase/migrations/billing_subscription.sql` | Columns, CHECK, unique index, **self-grant guard trigger**. Hand-applied. |
| `src/lib/subscription.ts` | **Pure** access decision + the dark switch. No I/O, no Stripe. |
| `src/lib/subscription.test.ts` | **61 tests** — mostly hunting false lockouts, plus the accountant-evidence rule and the Archief floor. |
| `src/lib/billing.ts` | The **only** place that constructs a Stripe client. |
| `src/lib/billing.test.ts` | 17 tests for the Stripe-shape helpers. |
| `src/app/api/billing/checkout/route.ts` | Starts a hosted Checkout session. |
| `src/app/api/billing/portal/route.ts` | Opens Stripe's hosted portal (card, invoices, cancel). |
| `src/app/api/billing/webhook/route.ts` | **The only writer of subscription state.** |
| `src/middleware.ts` | The gate (inert unless enforced). |
| `src/app/prijzen/*` | Public price page + subscribe button. |
| `src/app/dashboard/settings/facturering/*` | Status + portal door. Stripe's return target. |
| `src/components/billing/TrialBanner.tsx` | "Nog X dagen", shown only in the last 7. |
| `src/lib/plan.ts` | **The only place the price may be written.** Pure — no Stripe, so client components can import it. |
| `src/lib/ai-budget.ts` | The global daily Anthropic spend fuse. See §10. |
| `supabase/migrations/trial_30_days.sql` | Trial 14 → 30 days, extending trials still running. |
| `supabase/migrations/ai_spend_guard.sql` | Spend fuse + a working anonymous rate-limit bucket. |

`src/lib/billing.ts` is to Stripe what `src/lib/ai.ts` is to Claude: one module
owns the vendor. Do not construct a Stripe client anywhere else.

---

## 4. The two decisions worth understanding

### 4.1 Fail open — and why it is not laziness

The failure modes are wildly asymmetric:

- A **false lockout** shuts a paying customer out of their own bookkeeping.
  During a BTW deadline that is how you lose them — and it is always *our* bug:
  a column that does not exist yet, a NULL, a status string Stripe added last
  month, a clock that drifted.
- A **false pass** gives somebody a few extra days of an app they were already
  using, and costs effectively nothing.

So `decideAccess()` denies only on positive proof (a real expiry timestamp in
the past, or a terminal Stripe state with no paid period left). Everything else
returns `allowed: true, reason: 'unknown_state'`. **Never invert this.**

A consequence worth stating: the trial is judged by the **clock**, not by the
status string. A user who starts checkout on day 3 and whose card fails gets
Stripe status `incomplete`; if the trial rule required `status === 'trialing'`,
those 11 remaining days would vanish *because they tried to pay us*.

### 4.2 The self-grant hole this closes

`profiles_update_own` is:

```sql
FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid())
```

— with **no column restriction**. RLS is the only guard in front of the public
anon key, so the moment billing columns exist, any logged-in user could run

```js
supabase.from('profiles').update({ subscription_plan: 'pro',
                                   subscription_status: 'active' })
```

straight from the browser console and hand themselves a paid plan. The
`prevent_billing_self_grant` trigger closes it: the service-role webhook runs
with `auth.uid() IS NULL` and passes; everyone else may not move a billing
column at all. Same shape as the existing `prevent_accountant_amount_changes`.

Verified safe against every existing profile write (onboarding PATCH, settings
save, invite role flip, kas opening balance, register upsert) — all patch narrow
non-billing column sets, so all the `IS DISTINCT FROM` tests are false.

---

## 5. Things that would have broken, and what stops them

Each of these was found by reading the code before writing any, and each has a
specific guard:

| Risk | Guard |
|---|---|
| **Existing users have no `trial_ends_at` → instant lockout for everyone** | The column has a `DEFAULT now() + 30 days`, so Postgres back-fills every existing row in one shot. `now()` is STABLE ⇒ fast path, no table rewrite. |
| **Migration applied by hand, lags behind code → middleware queries a column that does not exist → whole app 500s** | The middleware's extended select falls back to the original narrow select on error; billing simply stays dormant. Every other read is `try`-wrapped. |
| **Adding columns to the middleware's existing query kills the onboarding redirect when they are absent** | Same fallback — the onboarding gate keeps working byte-identically. |
| **Accountants locked out of their own portal** | `decideAccess()` exempts accountants — but on **evidence** (a consented `accountant_clients` link), not on the self-declared `role`. See §12. |
| **A ZZP'er's client cannot pay an invoice** | `/pay/[token]` is in `PUBLIC_PATHS` and untouched. The gate only ever runs on `/dashboard/*`. |
| **Race: customer pays, Stripe returns them, webhook has not landed → bounced to /prijzen → reads as "payment failed"** | `/dashboard/settings/facturering` is explicitly exempt from the gate and is the checkout success URL. It also says "this can take a few seconds". |
| **Redirect loop on the price page** | `/prijzen` is in `PUBLIC_PATHS` (also correct for SEO — a hidden price loses buyers). No other route starts with `/prijzen`, so the `startsWith` rule is safe. |
| **Webhook body parsed before signature check → signature never verifies** | `req.text()`, never `req.json()`. Middleware runs on `/api/*` but only calls `getUser()` (cookies) and returns early — it never touches the body. |
| **Anyone on the internet POSTs "subscription.active"** | HMAC signature verified before a single field is read; unverified payloads are never logged in full. |
| **Out-of-order / replayed webhooks regress state** | Every handler re-reads the subscription from Stripe and writes *that*, so a late old event rewrites the same current truth. Idempotent without an events table. |
| **Stripe SDK dragged into the Edge middleware bundle** | `isBillingEnforced()` lives in the pure `subscription.ts`, not `billing.ts`. **Verified in the build output:** the edge chunk contains `BILLING_ENFORCED` and zero references to `api.stripe.com`. |
| **`sub.current_period_end` is gone in API 2026-06-24** | It moved onto subscription *items*. `subscriptionPeriodEnd()` reads the item and takes the latest; a dedicated test fails loudly if anyone "simplifies" it back. |

---

## 6. Go-live checklist

Nothing below is code. Do them in order.

**Before you can charge anything**
1. KVK + business bank account (Stripe will not pay out without them).
2. Stripe account; complete the business verification.
3. Create **one** product/price: `€ 12,00 / month`, currency EUR, **incl. 21%
   btw** (Dutch B2C prices are quoted inclusive — the displayed price in
   `PLAN.priceLabel` and the Stripe price must be the same number).
4. Enable **iDEAL** as a payment method, and enable **Stripe Invoicing** so
   every charge produces a btw-invoice.
5. Enable the **Billing Portal** (Settings → Billing → Customer portal) with
   "cancel subscription" allowed.

**Wire it up**
6. Apply `supabase/migrations/billing_subscription.sql` in the Supabase SQL
   editor. Run the VERIFY block at the bottom of the file.
7. Set in Vercel (all environments): `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`,
   `STRIPE_WEBHOOK_SECRET`. Leave `BILLING_ENFORCED` **unset**.
8. Stripe → Developers → Webhooks → add endpoint
   `https://boekbrug.nl/api/billing/webhook`, events:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

**Prove it in test mode** (test keys + test price id first)
9. Subscribe with card `4242 4242 4242 4242`, and again with test iDEAL.
10. Watch the webhook arrive (Stripe → Webhooks → recent deliveries) and the
    profile flip to `active`/`pro`.
11. Cancel via the portal → confirm access survives to `current_period_end`.
12. Re-subscribe → confirm it goes back to `active`.
13. Confirm a btw-invoice was generated and is downloadable from the portal.

**Then, and only then**
14. Swap to live keys **and the live price id** (they differ per mode).
15. Put **one real €12 payment through on your own account**. Check the money
    lands and the invoice is valid.
16. Set `BILLING_ENFORCED=true`. The paywall is now live.

> ⚠️ Before onboarding real users who upload files, fix the **OPEN** `C1`
> finding in `docs/BoekBrug_Security_Hunt_Report.md` (`xlsx@0.18.5`, known CVEs,
> reachable server-side on untrusted uploads). It is not a billing bug, but it
> is a financial app taking real customers' data.

---

## 7. Deliberately not built (and why)

| Not built | Why not yet |
|---|---|
| ~~Trial-ending / payment-failed emails~~ | **✅ Built (July 2026).** See §9. |
| Annual plan, accountant plans, coupons | Answers to questions we have not earned. One price is also the cleanest experiment. |
| Full dunning sequence | Stripe already retries; `past_due` keeps access. Build the sequence when there is revenue to protect. |
| Mollie / native iDEAL | Stripe's iDEAL is enough, and one integration beats two. Revisit on fee volume. |
| Feature-level gating (free tier) | The experiment is "will anyone pay for this?", not "which features are worth paying for?". Do not blur it. |

**Known limitation, accepted for v1:** when a ZZP'er's trial expires, their
accountant loses the bridge to that client's documents. With 10 hand-picked
users that is a conversation, not an outage. Revisit before the bookkeeper
channel is opened up.

---

## 8. The experiment this exists to run

Building the machine is not the point. The point is the number it produces.

- **Cohort:** 10 hand-picked users — 6 ZZP'ers, 2 accountants, 2 from a ZZP or
  expat community. Onboard each personally.
- **Ask:** €12/month. Not "try it free" — *ask for the card*.
- **Measure:** signup → activation (first invoice sent or first document
  scanned) → **paid**.
- **Decision gate:** ≥3 of 10 pay → double down, and only then run a small
  (€100–200) ads test to measure CAC. 0 pay → interview every refuser; their
  answer is worth more than any strategy document.
- **No paid advertising until this gate passes.** Ads magnify what works; there
  is nothing proven to magnify yet, and with no paywall there was never
  anything to measure.

---

*BoekBrug Billing — July 2026. Built dark, on purpose.*

---

## 9. Lifecycle e-mails

Two mails, and deliberately only two. A trial that ends with no warning does not
read as "my trial ended" — it reads as "the app took my bookkeeping away". A
failed payment nobody mentions turns a dead card into a cancellation. Everything
past those two (win-back, drip, upsell) is marketing, and marketing nobody asked
for is how a small tool starts to feel like a big one.

| Mail | Trigger | Where |
|---|---|---|
| **Proefperiode loopt af** | daily cron, 3 days or fewer left | `/api/cron/trial-reminder` → `sendTrialEndingEmail` |
| **Betaling niet gelukt** | Stripe `invoice.payment_failed` | `/api/billing/webhook` → `sendPaymentFailedEmail` |

**Why the trial mail is a cron and the payment mail is a webhook.** A failed
charge is an event Stripe already tells us about the moment it happens, so
asking for it again on a schedule would be both slower and duplicated. "Three
days left", by contrast, is not an event at all — nothing happens on that day;
it is simply true from then on, and only a scheduled scan can notice it.

**Claim-then-send.** `profiles.trial_reminder_sent_at`
(`billing_trial_reminder.sql`) is stamped **before** the mail goes out, in an
update scoped `.is('trial_reminder_sent_at', null)`. If another run already
claimed the owner the update touches nothing and we do not send. Two overlapping
cron runs therefore cannot both mail the same person. The trade is deliberate: a
send that fails after the claim is not retried, because a missed nudge is a
nudge, while a duplicate nudge is an annoyance you cannot take back — and it
lands right before you ask that person for money.

**One decision, one truth.** The cron does not re-derive "is this trial ending?"
It calls the same `decideAccess()` / `trialBanner()` pair the middleware and the
on-screen banner use, so the e-mail can never claim something the app contradicts.

**The payment mail says the customer keeps access, because they do.**
`past_due` deliberately stays allowed (§4.1, rule 4). A customer locked out over
an expired card cancels; a customer told "we'll retry, you're fine, here's the
link" updates their card. The mail is written to match the behaviour exactly.

**Safe by construction.** Both paths are best-effort: `deliverEmail(...,
{critical: false})` logs and reports to Sentry but never breaks the cron run or
the webhook. The webhook's mail step additionally never throws — if it did,
Stripe would retry the whole event and re-send the same mail, turning our outage
into the customer's spam. And with the migrations unapplied the cron's query
errors into a clean no-op, so it cannot mail anyone before there is anyone to mail.

---

## 10. Cron inventory (what runs unattended)

Billing and compliance added three scheduled jobs. All three share the same
guard: `Authorization: Bearer $CRON_SECRET`, constant-time compare, fail closed.

| Path | Schedule | What it may do | Dark switch |
|---|---|---|---|
| `/api/cron/trial-reminder` | daily 09:00 | send one mail per owner, stamp a send log | — (no-op with no trials) |
| `/api/cron/retention-purge` | Mondays 03:00 | **irreversibly erase files** past the 7-year window | `RETENTION_PURGE_ENABLED` — unset ⇒ **dry run** |

> ⚠️ `retention-purge` is the only code in BoekBrug that destroys data. It is
> covered in `docs/BoekBrug_Security_Hunt_Report.md` → A1 and guarded four ways
> (cron secret · dark switch · a purely-refusing decision function with 19 tests
> · a UUID-bounded storage prefix). Nothing in this app can be due for erasure
> before 2033. **If a dry run ever reports a candidate before then, a date was
> stamped wrong — investigate, do not enable.**

Vercel plan note: `vercel.json` now declares six crons. The Hobby plan allows
two daily jobs; these schedules assume Pro. If a deploy rejects the cron block,
that is the reason.

---

## 11. The plan shape, and the research behind it

A full study ran before any of this was written: real NL competitor pricing,
the freemium-vs-trial evidence base, and the app's true cost-to-serve measured
from its own code. Conclusions, because the reasoning matters more than the
number.

### 11.1 Pricing is not the constraint. Nine payers is.

| | |
|---|---|
| Marginal cost, median user | **€0.16–0.21/month** |
| Marginal cost, p90 (webshop, connected mailbox) | €1.35–3.85/month |
| Fixed floor (Vercel Pro + Supabase Pro + Resend + domain/Sentry) | ~**€80/month** |
| Net of €12 after BTW and Stripe | **€9.57** |
| **Break-even** | **9 payers at €12** (6 at €19.95, 11 at €9.95) |
| 7-year retention storage, 3 years at 1000 users | **€0** base case, <€150 heavy |

€12 covers a median user with ~97% gross margin. The 7-year obligation is a
legal and operational liability, **not a financial one** — do not spend design
effort optimising storage tiers worth €5/month.

### 11.2 Why not a feature-gated free tier

The market's revealed preference is unanimous and it is not a close call:

| Product | Model |
|---|---|
| QuickBooks · Xero · FreshBooks | 30-day trial, no card |
| Jortt | 30-day trial · then €9.95 intro for 3 months |
| MoneyMonk | 30-day trial, explicitly no card · free under €5,000 revenue |
| Moneybird | **60-day** trial · tiny free tier (3 invoices, 3 documents, 10 transactions) |
| e-Boekhouden | **15 months free** for starters |
| Zoho Books | 14-day trial + free tier capped by the CUSTOMER's revenue, not by features |

**Not one market leader runs classic feature-gated freemium.** The two apparent
exceptions are not exceptions: Zoho gates on a graduation metric, and Wave
monetises payments rather than seats.

And **Wave is the natural experiment that settles it.** Wave built its brand on
"100% free forever" for SMB accounting — the exact thing a free tier here would
be — and in 2024 concluded it could not fund the product that way. What it moved
behind a paywall: **bank auto-import, automatic transaction categorisation, and
receipt scanning.** Those are, feature for feature, BoekBrug's expensive
capabilities. Legacy free accounts migrate to paid from June 2026.

Conversion evidence points the same way: freemium free→paid runs ~2.6–8% and is
**bimodal** (a quarter of freemium products convert below 2.5%), while an opt-in
no-card trial runs ~8.9–18%. Freemium either works structurally or it does not;
there is no average outcome to plan against.

### 11.3 Why the trial is 30 days

It was 14 — the shortest in the Dutch market. RevenueCat's subscription data
finds **finance is a category where short trials specifically underperform**:
people evaluate money software across several sessions, not one.

There is also a product reason. The things that make BoekBrug worth paying for
appear **monthly or quarterly** — the BTW quarter, the bank statement, the
accountant hand-off. A 14-day trial can end before the user has met the feature
that would have sold it to them. At ~€0.20/month marginal cost, sixteen extra
days costs cents, and it is one line of SQL. There is no cheaper acquisition
lever available.

### 11.4 Archief — the read-only floor

The first version of the paywall redirected every `/dashboard/*` request away
once a trial lapsed. That was wrong three times over, and all three reasons are
recorded above `ARCHIVE_PATHS` in `src/lib/subscription.ts`:

1. **Trust** — a bookkeeping app that takes your bookkeeping hostage is a thing
   people warn each other about. Pressure to subscribe belongs on what you
   cannot *do* next month, never on what you cannot *see* about last month.
2. **The law** — Dutch bewaarplicht makes keeping seven years of records the
   USER's obligation. Standing between them and their own figures the week
   before a BTW deadline is a liability, and §5.2 of the terms now promises in
   writing that it cannot happen.
3. **Acquisition** — a wall ends the relationship; an archive keeps the account
   reachable and in the funnel. It also costs almost nothing: **a reader runs
   zero AI inference**, so this floor cannot be abused into a bill. It is the
   one shape of "free forever" whose cost is bounded by construction.

> ⚠️ **Scope, stated honestly:** the floor gates **pages, not the ~78 API
> routes.** A lapsed account that crafts its own POST can still write. That is
> deliberate for v1 — per-route entitlement checks are a large surface and the
> paywall is commercial pressure, not a security boundary. Do not describe it as
> enforcement.

### 11.5 Why one paid plan, and when to split

A second paid tier before the first paying customer splits a demand signal that
does not exist yet. The natural axis, when the time comes, is **who does the
data entry** — Starter (manual) vs Compleet (AI scanning, mailbox fetch, bank
matching, automatic reminders). That axis is honest, legible to a ZZP'er, and it
aligns price with cost-to-serve, which is the test the CFO review applied.

Revisit at roughly **20 paying customers**, with usage data on which features
people actually pay for. Not before.

### 11.6 The four plan ids in the database

`profiles.subscription_plan` has an inline CHECK allowing
`free | pro | boekhouder | boekhouder_pro`, and the binding terms of service
used to publish a matching four-plan table (Gratis €0 / Pro €25 / Pro+ €45 /
Boekhouder). That was the original design, for a strategy since dropped:
selling to accountants. Accountants have their own software (Exact/Twinfield)
and are now treated as free recipients, never customers.

`boekhouder` and `boekhouder_pro` are therefore **dormant, not used** — zero
references anywhere in `src/`. They are left in the CHECK deliberately: removing
a constraint value gains nothing, and the webhook only ever writes `pro` or
`free`. See §12 for the one hazard that creates.

### 11.7 Caveat on the competitor numbers

Vendor pricing pages could **not** be read: `WebFetch` returned 403 for every
host under this session's egress policy, so only search snippets were available,
and the Dutch bookkeeping-comparison SERP is dominated by affiliate content that
contradicted itself. Figures confirmed against a vendor's own domain are marked
as such above; treat the rest as indicative. **Verify before quoting any of them
publicly.**

---

## 12. Hazards that are guarded, and one that is not

| Hazard | Guard |
|---|---|
| A plan id outside the CHECK rejects the whole row, so `subscription_status` never lands and a **paying** customer is locked out — silently, with no Sentry record | The webhook writes **twice**: access fields first and unconditionally, the plan label second and non-fatally. A rejected label logs loudly and cannot take access down with it. |
| `subscription_plan` is **write-only** today — nothing reads it, and every row in production is `'free'`, the owner's included, with no admin bypass | Entitlements must resolve from `decideAccess()`, never from the column. Gating on `plan === 'pro'` would lock out 100% of accounts. |
| A trialing user's plan column says `'free'` (the webhook never ran — the trial is a database clock, not a Stripe trial) | Same rule: judge the decision, not the column. `decideAccess` rule 3 reads the clock. |
| `role='accountant'` is **self-declared** — the signup page has a role picker | The exemption requires a **consented `accountant_clients` link**. A trigger on the column was written and rejected: it would have broken accountant onboarding, invite acceptance and the signup upsert while closing nothing, because the declaration happens at INSERT. |
| Entitlements evaluated against the **data owner** would block a linked accountant from closing their client's quarter — the app's whole purpose | Always resolve from the **requester's** decision. |
| The price drifting between page, metadata, e-mail and the terms | One source: `src/lib/plan.ts`. Nothing else may retype the number. It had already drifted — €12 on the page, €25 in the binding terms. |
| Stripe's portal allowing plan switches to prices the code does not know | Only one price exists today. **Before adding a second**, pin the portal `configuration` id so the switchable set is version-controlled, and make the price→plan map return `null` loudly rather than guessing. |

**Not guarded:** write APIs for a lapsed (Archief) account — see the scope note
in §11.4.
