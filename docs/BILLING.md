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

**Payment methods.** Both checkout calls currently hardcode
`payment_method_types: ["ideal", "card"]`. Stripe's current guidance is strong on this point:
*never* pass `payment_method_types` (the sole exception is Terminal). Omitting it enables
**dynamic payment methods**: Stripe picks and ranks eligible methods per customer from
Dashboard settings, which adds e.g. Apple Pay / Google Pay and Link for Dutch customers without
a deploy — methods that measurably lift conversion and that we currently lock out. iDEAL keeps
its place for Dutch customers; ranking is by relevance, and method availability moves to
Dashboard → Settings → Payment methods, where it belongs.

Two consequences to handle before flipping it (see §4.2 — the webhook side is already done on
this branch):

1. Delayed-notification methods (SEPA-incasso, bank transfer) complete Checkout *before* the
   money is confirmed. The webhook must not record a Bewaarkluis until `payment_status` is
   `paid` — handled now by `kluisSessionAction()` and the two `async_payment_*` events.
2. If there are methods we genuinely never want, the tool is a payment method configuration or
   `excluded_payment_method_types` — still not `payment_method_types`.

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

**Path A — Stripe Tax (recommended, and what the product request asked for).**

Setup order matters; step 3 without step 2 silently collects nothing (Stripe's single most
common Tax mistake — no error is raised):

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
4. **Enable in code** — `automatic_tax: { enabled: true }` on both `checkout.sessions.create`
   calls in `billing.ts`. In subscription mode this carries through to the subscription and its
   renewal invoices. `tax_id_collection` is already on, which is the other half: with a valid
   EU VAT ID a cross-border B2B sale becomes a reverse charge instead of wrongly-charged btw.
5. **Registrations are per environment** — sandbox registrations do not exist in live mode and
   vice versa. Add the live registration before the first real payment (see §6).

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

### 4.1 · P1 — Stripe invoices carry no btw specification

§3.4 above. The one gap that touches what customers receive today. Decide Path A or B; both
end with a btw line on every invoice and neither changes any charged amount.

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

### 4.3 · P2 — Hardcoded `payment_method_types: ["ideal", "card"]`

§3.1. Stripe's guidance: omit the parameter everywhere except Terminal; manage methods in the
Dashboard. Was a reasonable v1 choice, is now the thing standing between Dutch customers and
Apple Pay. Prerequisite 4.2 is done, so this is a two-line deletion plus a Dashboard review of
enabled methods — do it deliberately, not in passing, since it changes what customers see at
the payment step.

### 4.4 · P2 — Secret key could be a restricted key

The integration calls a fixed, small API surface: Checkout Sessions (write), Billing Portal
sessions (write), Customers (write), Subscriptions (read), plus webhook signature checking
(no key permission at all). A restricted key (`rk_…`) with exactly those permissions turns a
leaked key from "can move money and read everything" into "can do what the app does". Create
in Dashboard → Developers → API keys → Create restricted key; same env var, no code change
(`isBillingConfigured()` checks emptiness, not prefix). While there: store it as a Vercel
*sensitive* environment variable, per Stripe's Vercel guidance — write-only, never echoed in
the UI — which is also exactly the discipline `LIVE_GAAN.md` §"Waar je een geheim MAAKT"
already teaches for the other secrets.

### 4.5 · P3 — SDK three majors behind

Installed: `stripe` 18.5.0, pinning API `2025-08-27.basil`. Current: 22.4.0, API
`2026-07-29.dahlia`. Our pin-by-SDK policy (no `apiVersion` literal — documented in
`getStripe()`) is sound and means an SDK upgrade *is* an API upgrade: do it as its own change,
read the SDK changelogs across 19→22, and lean on `subscriptionPeriodEnd`'s tests — that helper
was built for exactly the kind of shape move these version bumps carry. The upgrade also
unlocks `integration_identifier` on `checkout.sessions.create` (available from API
`2026-03-25.dahlia`; not in 18.5.0's types), which Stripe now recommends for tracking checkout
flows in the Dashboard — add it with a fixed label per flow when the SDK lands, e.g.
`plus-checkout-<8 random letters>` and `kluis-checkout-<8 random letters>`, chosen once and
kept stable so the Dashboard can aggregate per flow.

### 4.6 · P3 — Comment pinned the wrong API version — **fixed on this branch**

`billing.ts` and `billing.test.ts` said the installed SDK ships `2026-06-24.dahlia`; it ships
`2025-08-27.basil` (`node_modules/stripe/cjs/apiVersion.js`). The *substance* was verified
correct — on basil, `current_period_end` exists only on the subscription item (checked in the
SDK's types) — but a comment that pins a fact should pin the right one.

### 4.7 · Dashboard configuration (no code)

Collected from §3: Smart Retries + de-duplicated failure emails; Customer Portal options;
invoice template with KVK + btw-id + footer; branding (logo, colors — the hosted checkout and
portal are the two screens of ours a paying customer sees most); payment methods review when
4.3 lands; webhook endpoint gains the two `async_payment_*` events. And two account-level
practices from Stripe's security guidance: passkey/authenticator-app 2FA for Dashboard access
(not SMS), and rolling any key that ever lands in a log or terminal.

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
- [ ] **Unconfigured degrade** — unset the Stripe vars: checkout and portal answer 503 with
      the Dutch message, `/prijzen` still renders, nothing else in the app cares.

## 6. Go-live checklist (Stripe side)

Complements `LIVE_GAAN.md` (which owns the env-var and platform steps — read its §0 first).

- [ ] Live products + prices created, amounts **identical to the terms**: € 12,99/month Plus,
      € 19/bewaarjaar Kluis, both incl. btw (`LIVE_GAAN.md` §6 already insists).
- [ ] Tax path chosen (§3.4) and configured **in live mode** — head office + NL registration
      *before* the first live payment if Path A; the 21% inclusive rate if Path B. Sandbox tax
      config does not carry over.
- [ ] Live webhook endpoint `https://boekbrug.nl/api/billing/webhook` with events:
      `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `checkout.session.async_payment_failed`, `customer.subscription.created`, `.updated`,
      `.deleted`, `invoice.payment_failed`. Signing secret → `STRIPE_WEBHOOK_SECRET`.
- [ ] Live key is a **restricted key** (§4.4) stored as a sensitive env var.
- [ ] Payment methods reviewed in Dashboard (iDEAL on — `LIVE_GAAN.md` §6: card-only loses
      Dutch customers at the last click).
- [ ] Branding + invoice template carry the legal identity (KVK, btw-id).
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
