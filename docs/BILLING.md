# BoekBrug — Billing (Stripe subscriptions)

*Single source of truth for how BoekBrug takes money. July 2026.*

> **Status: built, tested, and SHIPPED DARK.** Every file below is on `main`'s
> branch and passes CI, but `BILLING_ENFORCED` is unset, so **nobody is gated
> and nothing is charged**. Turning it on is a four-step checklist (§6), not a
> deploy.

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
| `src/lib/subscription.test.ts` | 37 tests, mostly hunting false lockouts. |
| `src/lib/billing.ts` | The **only** place that constructs a Stripe client. |
| `src/lib/billing.test.ts` | 17 tests for the Stripe-shape helpers. |
| `src/app/api/billing/checkout/route.ts` | Starts a hosted Checkout session. |
| `src/app/api/billing/portal/route.ts` | Opens Stripe's hosted portal (card, invoices, cancel). |
| `src/app/api/billing/webhook/route.ts` | **The only writer of subscription state.** |
| `src/middleware.ts` | The gate (inert unless enforced). |
| `src/app/prijzen/*` | Public price page + subscribe button. |
| `src/app/dashboard/settings/facturering/*` | Status + portal door. Stripe's return target. |
| `src/components/billing/TrialBanner.tsx` | "Nog X dagen", shown only in the last 7. |

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
| **Existing users have no `trial_ends_at` → instant lockout for everyone** | The column has a `DEFAULT now() + 14 days`, so Postgres back-fills every existing row in one shot. `now()` is STABLE ⇒ fast path, no table rewrite. |
| **Migration applied by hand, lags behind code → middleware queries a column that does not exist → whole app 500s** | The middleware's extended select falls back to the original narrow select on error; billing simply stays dormant. Every other read is `try`-wrapped. |
| **Adding columns to the middleware's existing query kills the onboarding redirect when they are absent** | Same fallback — the onboarding gate keeps working byte-identically. |
| **Accountants locked out of their own portal** | `decideAccess()` exempts `role === 'accountant'` outright. They are the distribution channel; billing the channel before it has proven itself is backwards. |
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
| Trial-ending / payment-failed emails | The in-app banner covers the nudge, and the first cohort is 10 people you onboard personally. Add when the cohort stops being hand-held. |
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
