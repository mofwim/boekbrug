# BILLING — the Stripe integration: plan, review and checklists

*Written 11 August 2026 on `claude/boekbrug-stripe-setup-pew096`. `src/lib/billing.test.ts` has
referred to "the manual test-mode checklist in docs/BILLING.md" since the billing-branch port —
this file is that document, finally in the repo. See `docs/PORT_VAN_BILLING_TAK.md` for how the
integration got here.*

**Sources.** The recommendations below were checked against Stripe's own current guidance: the
official Stripe plugin for Claude (`stripe@claude-plugins-official` v0.5.1, whose bundled
`stripe-best-practices` skill documents API version `2026-07-29.dahlia` and Node SDK 22.4.0),
and against the code as it stands on this branch. Every claim about our own code was verified
against the source, and every claim about the installed SDK against `node_modules/stripe`
(v18.5.0, pinned API `2025-08-27.basil`).

---

## 1. The integration as built

BoekBrug sells exactly two things, both through Stripe hosted Checkout:

| Product | Mode | Price env var | Amount (incl. btw) |
|---|---|---|---|
| **BoekBrug Plus** | `subscription`, monthly | `STRIPE_PRICE_ID_PLUS` | € 12,99 / month (`PLUS_PRICE_EUR` in `fair-use.ts`) |
| **Bewaarkluis** | `payment`, one-time, `quantity` = years | `STRIPE_PRICE_ID_KLUIS_YEAR` | € 19 / bewaarjaar (`bewaarkluis.ts`) |

The moving parts, and the rules that bind them:

- **`src/lib/billing.ts`** — the only module that constructs a Stripe client. One place for the
  key, the prices, the API version. Client is lazy so importing never throws.
- **`src/app/api/billing/checkout/route.ts`** — starts a Plus Checkout Session. Grants nothing:
  a success redirect is a forgeable browser navigation, so the plan is only ever granted by the
  webhook.
- **`src/app/api/kluis/offerte/route.ts`** — quotes and sells the Bewaarkluis. The POST accepts
  no amount and no year count from the body; both are recomputed server-side from the user's own
  administration.
- **`src/app/api/billing/webhook/route.ts`** — the ONLY writer of subscription state. Verifies
  the HMAC signature over the raw body before reading a single field; re-reads the subscription
  from Stripe on every event so out-of-order and re-delivered events converge on current truth;
  writes access and the plan label separately so a rejected label can never lock out a paying
  customer. The `prevent_billing_self_grant` database trigger enforces at the database that no
  other path can write these columns.
- **`src/app/api/billing/portal/route.ts`** — Stripe's hosted portal: change card, download
  invoices, cancel. Cancelling is deliberately this easy.
- **`src/lib/subscription.ts`** — pure plan decision (`free` / `plus` / `boekhouder`). Fails
  toward `free`, which in this product removes no access — it only pauses the two actions that
  cost us money. `past_due` and `paused` keep Plus (grace period); so does a cancelled
  subscription whose paid period still runs.
- **`src/lib/plan.ts`** — display facts, every amount derived from `fair-use.ts` /
  `bewaarkluis.ts`, never typed here, so the checkout, the terms and the pricing page cannot
  disagree.

The standing rule, from the header of `billing.ts`: **Stripe is the source of truth for money.
Our database is a cache of what Stripe told us, written by the webhook and by nothing else.**

## 2. Where the integration already matches Stripe's current guidance

Verified against the `stripe-best-practices` skill — these are the things a reviewer should
*not* "fix":

- **Hosted Checkout Sessions** for both products, `mode: 'subscription'` for recurring — exactly
  the recommended pairing (Billing APIs + Checkout). No card data ever touches BoekBrug; PCI
  scope stays at zero; SCA/3-D Secure and the iDEAL bank redirect are Stripe's problem.
- **Customer Portal** for self-service management — the recommended surface, and under EU
  consumer law the easy cancel is not optional anyway.
- **Webhook signature verification** over the exact raw bytes (`req.text()`, never
  `req.json()`), unverified payloads rejected *and never logged*. This is the single most common
  way Stripe integrations break, and ours has it right, with the reasoning written at the top of
  the route.
- **No manual renewal loops** — Stripe Billing owns renewal, retries and dunning; we only mirror
  status.
- **Prices, not the deprecated Plan object**; one Product per thing we sell, price IDs
  env-configured per account and per mode with no code fallback.
- **Idempotent webhook by design** — re-read-then-write makes replays converge; the Bewaarkluis
  insert is idempotent through the unique index on `stripe_session_id` (a 23505 is success).
- **Attribution in metadata, three ways** — `profile_id` on the customer, the subscription and
  the session, plus the database link, so a money event can always find its account.
- **`subscriptionPeriodEnd()` reads the subscription item** — on the installed SDK (API
  `2025-08-27.basil`) `current_period_end` no longer exists on the subscription object, only on
  its items. Every pre-2026 tutorial reads the old path and silently gets `undefined`. Ours is
  pinned by a test.
- **`consent_collection.terms_of_service: 'required'`**, billing address collection, and
  **`tax_id_collection`** so business customers get their btw number on the invoice.
- **Keys server-only** (`STRIPE_SECRET_KEY`, never `NEXT_PUBLIC_`), missing keys degrade to a
  polite 503 on the one button that needs them, and `deploy-health.ts` reports a missing webhook
  secret only when checkout is actually on.

## 3. The plan, per Stripe product

The four products requested — Payments, Billing, Invoicing, Tax — and what each means for
BoekBrug specifically.

### 3.1 Payments

Already carried by hosted Checkout. Two decisions remain:

**Payment methods — done on this branch.** Both checkout calls used to hardcode
`payment_method_types: ["ideal", "card"]`. Stripe's guidance is strong on this point: *never*
pass `payment_method_types` (the sole exception is Terminal). Omitting it enables **dynamic
payment methods**: Stripe picks and ranks eligible methods per customer from Dashboard
settings, so Apple Pay, Google Pay and Link can be offered without a deploy. iDEAL keeps its
place for Dutch customers — enabled in Dashboard → Settings → Payment methods, where that
choice belongs.

Two consequences, both handled:

1. Delayed-notification methods (SEPA-incasso, bank transfer) complete Checkout *before* the
   money is confirmed. The webhook does not record a Bewaarkluis until `payment_status` is
   `paid` — `kluisSessionAction()` plus the two `async_payment_*` events (§4.2). This guard is
   now load-bearing: it is the only thing standing between a Dashboard toggle and a recorded
   seven-year obligation for money that never arrived.
2. To exclude a method, use a payment method configuration or
   `excluded_payment_method_types` — still never `payment_method_types`.

**Recurring collection for Plus.** First payment by iDEAL in subscription mode sets up SEPA
direct debit for renewals automatically — that is Stripe's mechanism, not something we build.
The "SEPA follows later, needs a mandate flow" note in `billing.ts` overstates what is left to
do: the mandate rides along with the first iDEAL payment.

### 3.2 Billing

The architecture (Checkout → webhook → status cache → pure plan decision) is the recommended
one and stays. What remains is Dashboard configuration, not code:

- **Smart Retries** (Dashboard → Billing → Revenue recovery): let Stripe pick retry moments for
  failed renewals. Our `invoice.payment_failed` mail is deliberately calm ("you keep access, we
  will retry") and matches `past_due` keeping Plus — keep our mail, and if Stripe's own reminder
  emails are enabled too, make sure the customer is not mailed twice for the same failure.
- **Customer Portal configuration** (Dashboard → Settings → Billing → Customer portal): allowed
  operations, cancellation reason survey off or on, invoice history on. The code passes only
  `customer` + `return_url`, so everything else is Dashboard-owned.
- **No trial, no proration complexity** — one plan, monthly, cancel-anytime. Nothing to
  configure beyond the above; `decidePlan()` already treats a Stripe-side `trialing` as active
  in case a trial is ever added on the price.

### 3.3 Invoicing

Two different things carry the name "invoice" here; keeping them apart is the plan:

- **BoekBrug's invoices to its own customers** (the € 12,99 subscription and the Bewaarkluis):
  these are Stripe's. Subscriptions invoice automatically; the Bewaarkluis session sets
  `invoice_creation: { enabled: true }` because for a business customer reclaiming btw, the
  invoice is half the product. What is missing is on the invoice itself — see Tax below — plus
  Dashboard cosmetics: Settings → Branding, and Settings → Invoice template (business name,
  KVK number, btw-id, a footer). The values are the same `NEXT_PUBLIC_COMPANY_*` facts
  `LIVE_GAAN.md` §6 already requires.
- **The invoices BoekBrug's users send to *their* customers** (the app's core feature): those
  are the product, generated by our own PDF pipeline, and they stay ours. Stripe Invoicing is
  not a replacement for `src/lib` invoice generation — a zzp'er's invoice to their customer has
  nothing to do with our Stripe account and must keep working with zero Stripe configuration.

### 3.4 Tax — the one real product gap

**The finding:** the portal route promises "download every BTW invoice", and the Bewaarkluis
comment calls the invoice "half the product" — but nothing in the integration tells Stripe
anything about btw. No `automatic_tax`, no `tax_rates`, no product tax codes. The subscription
invoice therefore shows "€ 12,99" with **no btw specification at all**. For the exact audience
this app serves — Dutch entrepreneurs who book their costs and reclaim voorbelasting — an
invoice without a btw breakdown is not a valid btw-factuur. A bookkeeping app whose own invoice
cannot be booked is the kind of detail our users are professionally equipped to notice.

Prices are btw-inclusive by policy (`PLUS.btwNote: "incl. btw"`), so fixing this changes what
the invoice *says*, never what the customer *pays*. Two ways to do it:

**Path A — Stripe Tax (recommended, and what the product request asked for). Chosen by the
owner on 12 Aug 2026; the code side is implemented on this branch.**

The code enables tax on both checkout flows behind one switch: set
`STRIPE_AUTOMATIC_TAX=true` (exactly that word) and `automaticTaxParams()` in `billing.ts`
spreads `automatic_tax: { enabled: true }` into both sessions; any other value spreads
nothing and today's behavior is unchanged. It is a switch and not unconditional because
enabling automatic tax while the account's Tax settings are still `pending` makes Stripe
reject *every* checkout session — the button would be broken for every customer, and missing
configuration must read as "feature off", never as a broken button.

Setup order matters; the switch comes LAST, and steps 1–3 are per environment (sandbox and
live each have their own Tax settings and registrations). Step 4 without step 2 silently
collects nothing (Stripe's single most common Tax mistake — no error is raised):

1. **Head office address** — Dashboard → Tax → Settings. Tax settings `status` must be
   `active`, not `pending`, before anything calculates.
2. **Add the NL registration** — Dashboard → Tax → Locations (or the Tax Registrations API).
   This *records* the existing Dutch btw registration in Stripe; it does not register anything
   with the Belastingdienst. Until this exists, `automatic_tax` calculates zero, silently.
3. **Product tax codes + tax behavior** — on both Products set a tax code (candidate:
   `txcd_10103001`, "Software as a service (SaaS) – personal/business use" — confirm the exact
   code from Stripe's canonical tax-code list, and confirm suitability for the Bewaarkluis,
   which is closer to a data-archiving service). On both Prices set
   `tax_behavior: 'inclusive'` so € 12,99 and € 19 stay the amounts charged.
4. **Flip the switch** — `STRIPE_AUTOMATIC_TAX=true` in that environment. In subscription
   mode the session setting carries through to the subscription and its renewal invoices.
   `tax_id_collection` is already on, which is the other half: with a valid EU VAT ID a
   cross-border B2B sale becomes a reverse charge instead of wrongly-charged btw.

Two footnotes to the implementation. The Bewaarkluis session now also passes
`customer_update: { address: 'auto', name: 'auto' }` (the Plus session always did): with
automatic tax on, `auto` makes Stripe tax the address entered at *this* checkout instead of a
stale saved one, and the saved address is what later renewal invoices are taxed against. And
subscriptions that already existed before the switch keep invoicing without a btw line —
automatic tax is per subscription, not per account. Update those few by hand in the Dashboard
(subscription → automatic tax) or accept it for the early subscribers.

What this buys beyond the btw line: correct handling of the occasional non-NL customer (EU B2C
charges their local rate where registered, EU B2B reverse-charges against a validated VAT ID),
and threshold monitoring if cross-border volume ever appears. What it costs: Stripe Tax is
billed per transaction that it calculates.

**Path B — a manual 21% tax rate (minimal, NL-only).** Create one Tax Rate object (21%,
`inclusive: true`, display name "btw") and pass it on both checkout calls
(`subscription_data.default_tax_rates` for Plus; line-item `tax_rates` for the Bewaarkluis).
Free, static, and correct for as long as every customer is Dutch and the rate stays 21%. No
monitoring, no reverse-charge handling, and `automatic_tax` can never be enabled while manual
rates remain (Stripe rejects the combination — they are mutually exclusive by design).

Given that the product brief for this integration names Tax as a requirement and the customer
base is businesses (tax IDs already collected), **Path A is the recommendation**; Path B is the
honest minimum. Either path closes the invalid-invoice gap. Which btw treatment is legally
right for BoekBrug's own sales is, as always, the accountant's call, not this document's.

## 4. Review findings — ranked

What the audit against Stripe's current guidance found, most important first.

### 4.1 · P1 — Stripe invoices carry no btw specification — **code side fixed on this branch**

§3.4 above. The one gap that touches what customers receive today. The owner chose Path A
(Stripe Tax); both checkout flows now request automatic tax behind
`STRIPE_AUTOMATIC_TAX=true`. What remains is Dashboard work in §3.4's order — head office
address, NL registration, tax codes and inclusive tax behavior on the products and prices —
and then the switch, per environment. No charged amount changes; only the invoice gains its
btw line.

### 4.2 · P1 — Bewaarkluis recording trusted `checkout.session.completed` unconditionally — **fixed on this branch**

`recordBewaarkluis()` ran on every completed session. With today's hardcoded synchronous
methods (iDEAL, card) that is safe, but the moment a delayed-notification method appears —
which §3.1's recommended Dashboard-managed methods can do *without a deploy* — a session
completes with `payment_status: "unpaid"` and we would have recorded seven years of storage
obligation for money that never arrives. The exact mirror of the bug the KLUIS block exists to
prevent ("geld aangenomen, verplichting nergens vastgelegd").

Fixed: the webhook now records only when the session is actually paid, waits on unpaid
completions, handles `checkout.session.async_payment_succeeded` (records — idempotently, via
the existing unique index) and `checkout.session.async_payment_failed` (records nothing,
loudly). The decision is a pure function, `kluisSessionAction()` in `billing.ts`, with its
truth table pinned in `billing.test.ts`. The two async events are added to the endpoint lists
in `.env.example` and `LIVE_GAAN.md` — **add them to the webhook endpoint in the Stripe
Dashboard** when touching it next; until then they simply do not arrive, and today's methods
never emit them.

### 4.3 · P2 — Hardcoded `payment_method_types: ["ideal", "card"]` — **fixed on this branch**

§3.1. Both sessions now omit the parameter, which is what turns on dynamic payment methods:
Stripe picks and ranks the eligible methods per customer from Dashboard → Settings → Payment
methods. iDEAL was the right instinct and keeps its place for Dutch customers — it is now
enabled there rather than compiled in, and Apple Pay, Google Pay and Link can join without a
deploy.

Two things travel with this change:

- **The Dashboard now decides what customers see.** Review the enabled methods there before
  the next real payment; that screen is the one that used to be these two lines of code. To
  exclude a method, use `excluded_payment_method_types` or a payment method configuration —
  never `payment_method_types` again.
- **The FAQ copy was a promise about the list.** All four pricing pages said "iDEAL or credit
  card" exhaustively, which goes stale the moment the Dashboard adds a method. They now name
  iDEAL and point at the payment page for the rest.

The delayed-notification hazard this unlocks (a Dashboard-enabled SEPA-incasso completing a
session before the money confirms) is already handled by 4.2's guard. That guard is now
load-bearing rather than precautionary — the comment in `billing.ts` says so.

### 4.4 · P2 — Secret key could be a restricted key — **ready; Dashboard action**

No code change is needed or wanted here: `isBillingConfigured()` checks that the key is
non-empty, never its prefix, so an `rk_…` key drops into `STRIPE_SECRET_KEY` and works. What
was missing was knowing exactly which permissions to tick, so here is the whole API surface
the app calls — verified by enumerating every Stripe method in `src/`:

| Call site | Stripe method | Permission needed |
|---|---|---|
| `resolveCustomerId` | `customers.create`, `customers.retrieve` | **Customers — write** |
| `createCheckoutSession`, `createKluisCheckoutSession` | `checkout.sessions.create` | **Checkout Sessions — write** |
| `createPortalSession` | `billingPortal.sessions.create` | **Billing Portal sessions — write** |
| webhook | `subscriptions.retrieve` | **Subscriptions — read** |
| webhook | `webhooks.constructEvent` | *none* — local HMAC, never calls Stripe |

Five methods, four permissions. Everything else stays "None", including Charges, Payouts,
Balance and Refunds — which is the point: a leaked key that can create a checkout session but
cannot move money or read your balance is a far smaller incident. Create it in Dashboard →
Developers → API keys → Create restricted key.

Two notes before switching. Stripe Tax runs *inside* the Checkout Session rather than through
a call we make, so no Tax permission should be required — but verify rather than assume: after
switching the key, run a checkout and a portal open in the sandbox and watch for a `403`,
which is exactly how a missing permission announces itself. And store the key as a Vercel
**sensitive** environment variable (write-only, never echoed back in the UI or logs) — the
same discipline `LIVE_GAAN.md` § "Waar je een geheim MAAKT" already teaches for the other
secrets.

### 4.5 · P3 — SDK three majors behind — **done on this branch**

`stripe` 18.5.0 → **22.5.0**, which moves the pinned API version from `2025-08-27.basil` to
**`2026-07-29.dahlia`**. Our pin-by-SDK policy (no `apiVersion` literal) means the SDK bump
*is* the API bump, so it was done as its own change with its own gate run.

What was checked, and why the upgrade turned out to be clean:

- **The four majors' breaking changes were read, not assumed.** v22 requires `new Stripe()`
  (we already did), drops callbacks and per-request host overrides (we use neither). v21 turns
  `decimal_string` fields into `Stripe.Decimal` — none of the affected fields are ones we read
  — and drops Node 16 (Vercel is on 20+). v20 and v19 touch only V2/Connect surfaces we do not
  use. The one v21 change worth naming: it now *throws* when you use the wrong webhook parsing
  method, and ours (`constructEvent`, synchronous, over a raw string body) is the right one.
- **`current_period_end` is still only on the subscription ITEM** on dahlia — verified in the
  new type definitions, not remembered. `subscriptionPeriodEnd()` is unchanged and its tests
  still pin the failure mode.
- **The types moved** from a top-level `types/` folder to declarations co-located in
  `cjs/`+`esm/` (v22's TypeScript overhaul). That changes nothing for importers, but it is why
  the package looks different on disk.
- **Signature verification was proven end-to-end offline**, since HMAC signing is local: a
  correctly signed payload verifies on the new SDK, and a tampered payload, a wrong signing
  secret and a missing header are each rejected. That is the one path where "compiles" is not
  good enough — it is the only thing standing between a public endpoint and anyone on the
  internet granting themselves a paid plan.

The upgrade also unlocks `integration_identifier` (API `2026-03-25.dahlia`+, absent from
18.5.0), now set on both flows — `plus-checkout-qmxvhtbd` and `kluis-checkout-rfnwzkpj` — so
the Dashboard can compare a monthly subscription flow against a one-off archive purchase
instead of averaging them together. **Those two strings must never be edited:** changing one
does not rename anything, it starts a third series and orphans the history under the old
label.

### 4.6 · P3 — Comment pinned the wrong API version — **fixed on this branch**

`billing.ts` and `billing.test.ts` said the installed SDK ships `2026-06-24.dahlia`; it ships
`2025-08-27.basil` (`node_modules/stripe/cjs/apiVersion.js`). The *substance* was verified
correct — on basil, `current_period_end` exists only on the subscription item (checked in the
SDK's types) — but a comment that pins a fact should pin the right one.

### 4.7 · P3 — The terms enumerate payment methods, and the list is already wrong

`algemene-voorwaarden.ts` §5.3 says: *"Betaling van Plus verloopt via een betaaldienstverlener
(iDEAL of SEPA-incasso)"*. Card payments have been accepted since v1 and are not in that list,
so the terms were already narrower than the integration **before** the dynamic-methods change;
that change widens the gap rather than creating it. Nobody is harmed by paying with a method
the terms forgot to name, but this is exactly the shape of discrepancy `plan.ts` warns about in
its own header — ambiguity in your own standard terms is construed against you.

Deliberately **not** fixed here: those terms are binding text with a version number and a
30-day change-notification clause (§2.3), and rewriting them is the owner's call, not a
side effect of a payments change. The minimal fix is to stop enumerating — e.g. *"via onze
betaaldienstverlener Stripe; welke betaalmethoden beschikbaar zijn zie je op de betaalpagina"*
— which also stops the clause from going stale every time the Dashboard changes. Whether that
counts as a significant change requiring notice is a legal judgement, not a technical one.

### 4.8 · P2 — Invoices carry no legal identity — **Dashboard action, values below**

A btw line (§3.4) makes the invoice arithmetically complete; the identity of who issued it is
what makes it a factuur. Stripe currently prints whatever the account's business profile
holds, which on a fresh account is a name and an email address.

This is deliberately **not** done in code. Stripe's account-level invoice template applies to
*every* invoice — the one-off Bewaarkluis payment and every monthly Plus renewal alike — while
`invoice_creation.invoice_data` on a Checkout Session reaches only the Bewaarkluis one.
Setting both is how the two invoice types drift apart, and only the Dashboard covers both.
Worse, code would print `company.ts`'s deliberate `"(volgt)"` placeholder onto a real invoice
whenever a variable is unset — the exact real-but-false outcome that module exists to prevent.

The values are the ones the app already publishes on its own legal pages, and they must match
exactly: a KVK number that differs between the Terms and the invoice is worse than one that
appears only in the Terms. All of them come from `src/content/legal/company.ts`, which reads
the `NEXT_PUBLIC_COMPANY_*` variables:

| Dashboard field | Value | Source |
|---|---|---|
| Settings → Business → Public business information: legal name | `NEXT_PUBLIC_COMPANY_LEGAL_NAME` | `company.legalName` |
| … address | `NEXT_PUBLIC_COMPANY_ADDRESS` + `NEXT_PUBLIC_COMPANY_CITY` | `company.address`, `company.city` |
| Settings → Tax → btw-id shown on invoices | `NEXT_PUBLIC_COMPANY_BTW` | `company.btw` |
| Settings → Invoice template → custom field | `KVK` = `NEXT_PUBLIC_COMPANY_KVK` | `company.kvk` |
| Settings → Invoice template → footer | support address, and that amounts are incl. btw | — |
| Settings → Branding | logo and the app's own colours | — |

If one of those variables is still unset in Vercel, its value reads `(volgt)` in the Terms as
well, and the honest fix is to set the variable — not to type a different value into Stripe.
Branding sits on this list for an unglamorous reason: hosted Checkout and the Customer Portal
are the two screens of "ours" that a paying customer looks at most closely.

### 4.9 · Dashboard configuration (no code)

Collected from §3 and the findings above: Smart Retries + de-duplicated failure emails;
Customer Portal options; the invoice template and branding of §4.8; the restricted key of
§4.4; the Tax setup of §3.4; a payment-methods review now that §4.3 has landed; and the two
`async_payment_*` events on the webhook endpoint. Plus two account-level practices from
Stripe's security guidance: passkey or authenticator-app 2FA for Dashboard access (not SMS),
and rolling any key that ever lands in a log or a terminal.

## 5. Test-mode checklist (manual)

The checklist `billing.test.ts` refers to. Everything here runs against a sandbox/test key —
nothing in it can touch real money.

Setup: test-mode `STRIPE_SECRET_KEY` + the two price IDs in `.env.local`, and a forwarded
webhook — `stripe listen --forward-to localhost:3000/api/billing/webhook`, with the `whsec_…`
it prints as `STRIPE_WEBHOOK_SECRET`. Cards: `4242 4242 4242 4242` (succeeds),
`4000 0025 0000 3155` (requires 3-D Secure), `4000 0000 0000 9995` (declines,
insufficient funds) — any future expiry, any CVC. iDEAL in test mode simulates any bank.
Trigger extra events with `stripe trigger invoice.payment_failed`.

- [ ] **Plus, happy path** — `/prijzen` → checkout (iDEAL and card both) → webhook fires →
      `profiles` shows `subscription_status='active'`, `subscription_plan='plus'`,
      `current_period_end` ≈ one month out → `/dashboard/settings/facturering` shows Plus.
- [ ] **Webhook is the only granter** — pay, but kill `stripe listen` first: the success
      redirect alone must NOT flip the plan. Restart listening, resend the event from the
      Stripe Dashboard, watch it land.
- [ ] **Replay is a no-op** — resend `checkout.session.completed` and
      `customer.subscription.updated` from the Dashboard: same row values, no duplicates, log
      shows the re-read.
- [ ] **Forged webhook dies** — `curl -X POST …/api/billing/webhook -d '{}'` → 400
      `invalid_signature`, and nothing about the body in the logs.
- [ ] **Failed renewal** — `stripe trigger invoice.payment_failed` → payment-failed mail sent
      (Resend test inbox), status becomes `past_due` via the subscription event, **access
      stays Plus** (grace period).
- [ ] **Cancel** — portal → cancel: status `canceled`, but Plus limits hold until
      `current_period_end` passes (`decidePlan` rule 4).
- [ ] **Bewaarkluis** — `/dashboard/kluis` → quote matches the administration's youngest
      fiscal year → pay → `kluis_subscriptions` row with the right `keep_through_year` →
      buying again is refused with a 409 *before* checkout.
- [ ] **Bewaarkluis replay** — resend the completed event: log shows "al vastgelegd", still
      one row (unique index on `stripe_session_id`).
- [ ] **Async guard** — from the Dashboard, resend a completed session event; then use
      `stripe trigger checkout.session.async_payment_succeeded` /
      `…async_payment_failed` (add `product=bewaarkluis` metadata via a fixture) and check:
      unpaid completion logs "waiting", succeeded records once, failed records nothing and
      logs the error line.
- [ ] **Tax, off** — with `STRIPE_AUTOMATIC_TAX` unset, both checkouts behave exactly as
      before this branch: session created, no tax lines. (The switch must never be able to
      break a checkout by merely existing unset.)
- [ ] **Tax, on** — sandbox: head office address + NL registration + tax codes +
      `tax_behavior: inclusive` per §3.4, then `STRIPE_AUTOMATIC_TAX=true`: Checkout shows
      "inclusief btw", the total stays € 12,99 / € 19 × years, and the invoice afterwards
      carries the 21% btw breakdown. Then check the diagnosis path once: with the
      registration *removed* (sandbox only!), the same purchase completes at the same price
      but with zero tax — the silent failure §3.4 warns about, worth having seen once.
- [ ] **Unconfigured degrade** — unset the Stripe vars: checkout and portal answer 503 with
      the Dutch message, `/prijzen` still renders, nothing else in the app cares.

## 6. Go-live checklist (Stripe side)

Complements `LIVE_GAAN.md` (which owns the env-var and platform steps — read its §0 first).

- [ ] Live products + prices created, amounts **identical to the terms**: € 12,99/month Plus,
      € 19/bewaarjaar Kluis, both incl. btw (`LIVE_GAAN.md` §6 already insists).
- [ ] Stripe Tax configured **in live mode**, in §3.4's order: head office address, NL
      registration, tax codes, `tax_behavior: inclusive` — and only then
      `STRIPE_AUTOMATIC_TAX=true` in the production environment. Sandbox tax config does not
      carry over, and the switch before the registration means silent € 0 btw on real
      invoices.
- [ ] Live webhook endpoint `https://boekbrug.nl/api/billing/webhook` with events:
      `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `checkout.session.async_payment_failed`, `customer.subscription.created`, `.updated`,
      `.deleted`, `invoice.payment_failed`. Signing secret → `STRIPE_WEBHOOK_SECRET`.
- [ ] Live key is a **restricted key** with exactly the four permissions in §4.4, stored as a
      Vercel *sensitive* env var. Sandbox-test it first and watch for `403`.
- [ ] **Payment methods reviewed in Dashboard → Settings → Payment methods.** Since the
      dynamic-methods change, that screen — not the code — decides what customers see, so
      confirm **iDEAL is on** before the first real payment (`LIVE_GAAN.md` §6: card-only
      loses Dutch customers at the last click). If a delayed-notification method
      (SEPA-incasso, bank transfer) is enabled, know that a Bewaarkluis then records only
      after the async verdict arrives, which can be days later.
- [ ] Branding + invoice template carry the legal identity, filled from the table in §4.8 and
      matching the Terms exactly. No `(volgt)` may survive anywhere.
- [ ] Dashboard 2FA is passkey or authenticator app, not SMS.
- [ ] First live € 12,99 subscription made by the owner, then: invoice PDF shows the btw line,
      webhook delivered 200, profile flipped, portal opens, cancel works. Refund the test via
      the Dashboard afterwards if desired — refunds don't undo the plan until the
      subscription event says so, which is itself worth watching once.
- [ ] Monitoring per `LIVE_GAAN.md` §4: Stripe → Webhooks for non-200 deliveries;
      `[BILLING]`/`[KLUIS]` `UNATTRIBUTED` lines in the logs are a human-now signal.

## 7. Tooling note — Stripe MCP and the plugin in this repo's sessions

For future Claude sessions on this repo: the official Stripe plugin
(`claude plugin install stripe@claude-plugins-official`, after
`claude plugin marketplace add anthropics/claude-plugins-official`) bundles the
best-practices/tax/security skills used for this review, plus `/stripe:test-cards` and
`/stripe:explain-error`, and registers the `https://mcp.stripe.com` MCP server. Two caveats
observed on 11 Aug 2026 in the remote (cloud) environment:

- The environment's network policy blocked `*.stripe.com` outright (CONNECT 403 from the
  proxy), so the MCP server, `docs.stripe.com` fetches and `npx skills add
  https://docs.stripe.com` were all unreachable. To use the Stripe MCP tools
  (`stripe_implementation_planner` and friends) from a cloud session, allowlist
  `mcp.stripe.com` in the environment's network policy at
  https://claude.ai/settings/environments — or run the session locally.
- The MCP server additionally needs OAuth (`claude mcp list` → "Needs authentication"; run
  `/mcp` in an interactive session to sign in), or a bearer token. If a token is ever used,
  make it a sandbox restricted key, never the live secret key.

The plugin's bundled skills work offline either way — they are what §2–§4 were checked
against.
