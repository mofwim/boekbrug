# Autopilot plan — from "the machine proposes" to "the machine acts, the owner is told"

_Written 3 September 2026 after a full audit of the repo, the gate set (tsc · 3653 unit · 182 render ·
eslint · build · smoke, all green) and the production database. This is an implementation plan, not a
wish list: every phase names the files that change, the migration it needs, the test that proves it,
and the minutes it removes from the owner's month._

> **On language.** English per `AGENTS.md`. Dutch product terms (btw, aangifte, boekhouder, bon)
> and URL segments stay as they are. UI sentences quoted here are examples; the real ones go in
> `src/lib/i18n/messages.ts`, Dutch first.

---

## 0. The one rule that changes

Today the rule written into the code is **"the pipeline proposes, the human confirms"**
(`docs/BoekBrug_AI_Pipeline_Architecture.md`). It is honest and it is safe, and it guarantees a
queue the owner empties by hand. Production shows what that queue is:

| Waiting on the owner today | Rows |
|---|---|
| documents in the verify queue (`status='processing'`) | 13 |
| card payouts categorised but `category_confirmed=false` | 993 |
| bank debits with no category and no invoice | 292 |
| e-mail attachments the sync skipped | 410 |

The new rule: **"the machine books, tells the owner, and the owner can undo."** Book by default,
ask by exception. Everything that makes this safe already exists — every automatic booking is
audited (`src/lib/audit.ts`), reversible (`bulk-undo-pay.ts`, `/api/invoice/[id]/archive`,
`/api/bank/unlink`), confidence-gated (`auto-advance.ts`, `bank-match-confidence.ts`) and
vetoed by 17 named reasons. What is missing is that the product does not yet trust itself
enough to act.

Three things stay human forever: moving money, signing the aangifte (owner or boekhouder under
mandate), and disputes with a customer or supplier.

**The metric for the whole plan: minutes per month inside BoekBrug.** Today: hours. Target after
phase 4: under ten, all of them spent answering the weekly exceptions message.

---

## Phase 0 — Switch on what is built (week 1, almost no product code)

| Step | Where | Notes |
|---|---|---|
| Provision `ENABLEBANKING_APPLICATION_ID` / `_PRIVATE_KEY` | Vercel env | `bank_connections` is 0 rows in prod; the daily cron `/api/cron/bank-sync` runs and finds nothing |
| Provision `SNELSTART_SUBSCRIPTION_KEY`, Mollie, VAPID, Google/Microsoft OAuth | Vercel env | `mollie_connections`, `snelstart_connections`, `push_subscriptions` are all 0 rows |
| Reminders on by default for NEW profiles | migration `supabase/migrations/reminders_default_on.sql`; `OnboardingWizard.tsx` shows the switch once | 1 of 9 owners has `reminders_enabled`; the cron has shipped dark since July |
| Clear the bank backlog once | `src/lib/bulk-confirm.ts` + `/api/bank/confirm`: accept `category_source='auto'` lines in one call; `BankClient.tsx` gets one "Alles bevestigen" button on the auto-categorised filter | 993 + 30 rows |
| Explain the 410 skipped attachments | `src/lib/skipped-import.ts` + the triage rules in `email-integration.ts`; count by reason in prod first | A number that high means the PDF-only rule drops real invoices |
| Start measuring | migration `owner_touches.sql` (user_id, action, source, at); `src/lib/audit.ts` writes one row per human-initiated action | Phase 5 reads it |

Gate: `npm run gates`. Nothing here changes an amount.

---

## Phase 1 — Everything arrives by itself (weeks 2–4)

**Goal: the owner never uploads anything.**

1. **PSD2 live.** `src/lib/enablebanking-sync.ts` is complete. After go-live, raise the cron to
   twice daily (`vercel.json`) and let `/api/cron/reconcile` run right after it (it already does
   per user via `runBankAutoConfirm`).
2. **A forwarding address per owner.** New `src/app/api/email/inbound/route.ts` (Resend inbound
   webhook, signature-verified like `/api/email/webhook`). The owner gets
   `u-<token>@in.boekbrug.nl` (migration `inbound_address.sql` on `profiles`, token as secret, same
   model as `pay_token`). The handler reuses the attachment path of `email-integration.ts` and
   lands in `/api/intake` so every dedup gate applies. Shown once in `settings/page.tsx`.
3. **WhatsApp intake.** New `src/app/api/whatsapp/inbound/route.ts` (Meta Cloud API webhook).
   Media → the same intake; text → phase 3's correction channel. Phone number linked in settings
   with a one-time code (migration `whatsapp_number.sql`).
4. **Z-report without a browser.** Interim: the owner e-mails the till report to the inbound
   address; `src/lib/intake-router.ts` already classifies statements, add `till_report` and route
   to `src/lib/turnover-import.ts`. Later: a vendor API pull per POS.

Tests: `email-inbound.test.ts` and `whatsapp-inbound.test.ts` (pure: envelope → intake call),
signature fixtures; `intake-router.test.ts` gets the till case. Render test unchanged.

Minutes removed: the bank upload, the Z-report upload, the "open the app to photograph" trip.

---

## Phase 2 — Decide, do not ask (weeks 4–8)

**Goal: a known counterpart never generates a question.**

1. **A trust ladder per counterpart.** New pure module `src/lib/counterpart-trust.ts`:
   level 0 (new) → 1 (seen, ask) → 2 (book, flag "controleer") → 3 (book silently). Promotion after
   N consistent bookings without correction, computed from `counterpart-history.ts`,
   `supplier-cadence.ts` and `reading-memory.ts`. Demotion on any owner correction. Hard vetoes
   stay hard: an IBAN change (`iban-change.ts`) always drops to level 1, a possible duplicate
   (`possible-duplicate-collect.ts`) always asks.
2. **Wire it in**, without touching the arithmetic guards:
   - `auto-advance.ts`: for level ≥ 2 the per-field floor may drop from `HIGH_CONF` 0.8 to the
     review line 0.7; grounding (`amount-grounding.ts`) and placement (`document-verify.ts`)
     stay mandatory.
   - `bank-auto-confirm.ts`: the `amount_only` tier books silently at level 3 instead of flagging.
   - `bank-auto-categorize.ts`: a category confirmed twice for a counterpart is written with
     `category_confirmed=true` from then on.
   - `receipt-auto-settle.ts`: unchanged (the paper decides, not the ladder).
3. **Confirm by silence.** Migration `auto_booked_window.sql`: `auto_booked_at` on `invoices` and
   `bank_transactions`. The owner sees "booked, 7 days to undo" instead of "please confirm". Undo
   is the existing path (`bulk-undo-pay.ts`, archive, unlink). After the window the flag clears and
   nothing else happens — no second question.
4. **Vandaag shows exceptions only.** `VandaagClient.tsx` drops the "controleer" list for
   level-3 bookings; `hold-reasons.ts` and `bank-waiting-reason.ts` become the single source of
   what still needs a human.

Tests: `counterpart-trust.test.ts` (promotion, demotion, vetoes), extend `auto-advance.test.ts`
and `bank-auto-confirm` scenarios in `bank-scenarios.test.ts`; a `[TRUST]` gate in
`lifecycle-gates.test.ts` asserting that no engine reads the ladder without the IBAN veto.

Minutes removed: the daily queue. After two months ~90% of lines are level 3.

---

## Phase 3 — One message a week, and a real correction channel (weeks 6–10)

**Goal: the owner's whole interface is a weekly message plus a way to say "that is wrong" in
their own words.**

### 3a. The exceptions message

New pure `src/lib/exceptions.ts`: collects from the engines that already know
(`hold-reasons.ts`, `possible-duplicate-collect.ts`, `open-invoice-proof.ts`, `readiness.ts`,
`offerte-followup.ts`, `overdue.ts`) and ranks; at most five items; a quiet week sends nothing,
exactly like `ochtend-digest.ts`. Delivered by `src/app/api/cron/exceptions/route.ts` (weekly,
`vercel.json`) over e-mail, push (`push.ts`) and WhatsApp. Each item carries **signed one-tap
links** to a new `src/app/api/act/[token]/route.ts`: confirm · ignore as private · send the
reminder · ask the boekhouder (`/api/accountant/invoice-question`). Token model: single-use,
per item, per user, like `offerte-akkoord.ts`.

### 3b. Corrections in natural language — this is not yes/no

**The owner keeps full freedom to change whatever genuinely needs changing.** Autopilot removes
the obligation to look, never the right to correct. Every screen stays as a full editor
(`invoice/[id]/edit`, `klanten/[id]`, `leveranciers`, `bank`), and the weekly message is a
shortcut into them, not a cage around them. The only thing the owner cannot do is silently
rewrite a document a third party already holds — a sent invoice is corrected with a creditnota
and a new invoice, because that is what the law and the customer's own books require. Everything
else (a name, a number, a date, an IBAN, a category, a wrong match, a document that should not
exist) is theirs to change, by tapping or by saying so.

The owner will say things like: _"factuur 2026-041, the client name is wrong, Bakkerij Jansen
not Janssen"_, _"delete that receipt, it is private"_, _"that IBAN for Al Amir is wrong"_,
_"that payment belongs to invoice 38 not 37"_ — in Arabic, Dutch, English or Turkish, by
WhatsApp, e-mail reply or the in-app chat.

New `src/lib/correction-intent.ts` (pure) + `src/app/api/correct/route.ts`:

1. Claude (`ai.ts`, model via `ai-model.ts`, budget via `ai-budget.ts`) is given the message,
   the owner's recent rows and a **closed set of tools** — tool use with `input_schema`, never
   free text. Each tool is an action the app already performs, through the same audited path as
   its button:

   | Intent | Tool → existing path |
   |---|---|
   | rename a client / supplier, fix a spelling | `clients` update · `supplier-alias-write.ts` |
   | fix number, date, amount, line on an **unsent** draft | `invoice-editable.ts` guard → `/api/invoice/[id]` |
   | correct a **sent** invoice | never edited: `invoice-supersede.ts` (creditnota + new) |
   | change a supplier's IBAN | `iban-change.ts` gate — always drops trust, always asks once |
   | delete / archive a document or bon | `/api/invoice/[id]/archive` with `archive-reason.ts` |
   | this payment belongs to another invoice | `payment-move.ts` |
   | this bank line is matched wrong | `bank-rematch.ts` · `/api/bank/unlink` |
   | this is private / not business | `/api/bank/ignore` with `bank-ignore-reason.ts` |
   | mark paid / unpaid | `/api/invoice/pay-toggle` with `pay-toggle-reason.ts` |
   | anything else | ask one clarifying question, or hand to the boekhouder |

2. The proposed action is **validated before execution** against `money-invariants.ts`,
   `invoice-editable.ts` and the DB triggers (a `verwerkt` invoice cannot change; a sent invoice
   cannot be edited). A refused action is explained in the owner's language, not swallowed.
3. Execution goes through the button's route, so the audit row, the undo path and the
   notification are the same as if the owner had tapped.
4. The reply states what was done and carries an undo link. Ambiguity (two invoices match
   "38") produces a question with the candidates, never a guess.

Tests: `correction-intent.test.ts` with fixtures in four languages mapping sentences to tools;
a `[CORRECT]` gate asserting every tool name maps to an existing route; `ai-budget` test for
the per-message ceiling. The AI never receives a tool that writes money directly.

Minutes removed: opening the app to fix something. The fix is a sentence.

---

## Phase 4 — Money out and the quarter close themselves (weeks 10–16)

1. **Recurring invoices send themselves.** `invoice_schedules` gets `auto_send boolean` and a
   `send_after` (migration `schedule_auto_send.sql`). `/api/cron/recurring` still creates the
   draft; a second pass 24 h later calls `/api/invoice/send` if the owner did not cancel from the
   digest link. The art. 35 argument in `recurring.ts` is answered: the schedule the owner set
   is the owner's own act, and the 24-hour preview keeps the cancel in their hand.
2. **Accepted quote → draft invoice** with the same 24-hour window (`offerte-akkoord.ts` stays
   a signal; a new `offerte-to-draft.ts` does the copy, numbering still minted on send).
3. **Reminders** default on (phase 0); the owner picks a tone once in settings.
4. **Quarter close without the owner.** `quarter-close.ts` → `closing-package.ts` → delivered to
   the boekhouder (`package_deliveries`); with an active mandate (`accountant-mandate.ts`,
   `has_active_confirm_mandate`) the boekhouder files and `btw-filing.ts` freezes the snapshot.
   The owner gets one message: the amount, the deadline, and an EPC QR (`epc-qr.ts`) for the
   transfer — the one moment they touch money.
5. **Rubrieken 4a/4b computed** from incoming invoices with a foreign btw number
   (`aangifte.ts` already flags `hasEuPurchase`; `supplier-registry.ts` knows the country).
   A copy button per rubriek (`CopyButton.tsx`) in `AangifteClient.tsx` for the owner without a
   boekhouder.
6. Digipoort stays a later decision (`docs/BoekBrug_Future_Ideas.md`), gated on fifty
   accountants.

Tests: `recurring.test.ts` (cancel window, no double send with `claim-then-send`),
`offerte-to-draft.test.ts`, `aangifte.test.ts` gains the 4a/4b fixtures pinned to a real filing.

Minutes removed: the monthly "send my invoices", the quarterly copy-seven-numbers.

---

## Phase 5 — Prove it (continuous)

- `owner_touches` (phase 0) feeds one number on the dashboard and in the founder's digest:
  **minutes in BoekBrug this month**, and **share of bookings made without a human**.
- The exceptions message reports its own count; a week with more than five items is a bug in
  the ladder, not a busy week.
- Keep every pure engine pure; the gate set stays the release rule (`AGENTS.md`).

---

## Order and dependencies

```
Phase 0 (switch on, backlog, metric)
  └─ Phase 1 (inbound: PSD2, mail, WhatsApp, till)
       └─ Phase 2 (trust ladder, confirm-by-silence)
            ├─ Phase 3 (exceptions message, correction channel)
            └─ Phase 4 (auto-send, quarter close, 4a/4b)
Phase 5 runs from day one.
```

Each phase ships on its own branch, merges `main` first, and passes `npm run gates` on the
merged result. Every new sentence goes into `messages.ts` Dutch-first with ar/en; no component
holds language of its own.
