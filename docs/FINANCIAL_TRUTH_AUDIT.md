# BoekBrug — Financial Truth Audit

> Where is BoekBrug from being the "automatic financial truth" it promises, and can a busy
> shop owner trust it? This document maps every real-world scenario a Dutch cash-intensive
> retailer throws at the app against what the **production** code actually does today.

| | |
|---|---|
| **Code audited** | `origin/main` @ `50c78ff` (production / Vercel build source) |
| **Method** | Multi-agent audit of intake, bank, invoice-lifecycle, VAT/aangifte, cash, closing — each verdict tied to `file:line`. Scenario catalog cross-checked against Belastingdienst/KVK guidance. |
| **Verification** | The six load-bearing *absence* claims below were re-confirmed by direct `grep` on the audited tree (see Appendix A). |
| **Audience** | Developers. Purpose: decide the roadmap that turns "trusted draft" into "trusted filing". |

---

## TL;DR verdict

BoekBrug is a **genuinely well-engineered, discipline-first** app. It delivers "automatic
financial truth" **within one lane**: a domestic shop on the **accrual basis (factuurstelsel)**
with **21 / 9 / 0 %** sales. Inside that lane the reconciliation is rigorous — losslessness, no
double-count, confidence-gated intake, reversible auto-confirm, honest readiness gaps.

The problem is that the **target user (a snackbar / horeca, cash-intensive) sits partly outside
that lane**, and a handful of gaps are **silently wrong** (no flag). The redeeming property:
the app **rarely lies** — it flags or refuses. The risk is concentrated in the few places where
it is wrong *without* saying so.

**Bottom line:** trustworthy as an excellent **first-pass truth engine a bookkeeper reviews**;
**not yet** a standalone self-file truth for a cash-basis business or any special VAT regime.

---

## 1. What works — the core lane (trust it)

These are `HANDLED` with `file:line` evidence and are the app's real strength.

| Area | Evidence |
|---|---|
| Receipt photo → AI read → verify queue → VAT-bearing booking; never auto-paid | `api/intake/route.ts:531-702`, `email/confirm/[id]/route.ts:159-236` |
| Mixed formats (PDF, image, .xls/.xlsx/.csv, UBL/Peppol XML); unreadable → filed safe, never lost | `api/intake/route.ts:100-200`, `detect-file.ts`, `ubl-invoice.ts` |
| Duplicate detection: byte-hash + semantic, cross-channel (email/upload/bestanden) | `api/intake/route.ts:202-441`, `email-integration.ts:2180-2308` |
| Confidence gating — nothing books silently; low-confidence → review/skip, visible | `ai.ts:262-267,1653-1695`, `auto-advance.ts` |
| Bank import MT940 / CAMT.053 / CSV (multi-bank), Excel deliberately excluded | `bank-parser.ts:150-712`, `bank-csv.ts` |
| Auto-match bank↔invoice = **settlement, not new revenue** (ref/IBAN/amount/name/date), reversible | `bank-matching.ts:343-552`, `bank-auto-confirm.ts` |
| **Partial payments / installments** — tracks `amount_paid`, flips `paid` only when fully covered | `confirm/route.ts:139-209`, `invoice_partial_payments.sql` |
| **Cross-period** — cost/omzet on invoice-date accrual; payment settles later; no double-count | `compute-result-range.ts:58-78`, `financial-result.ts:305` |
| Creditnota / refunds / chargebacks — sign preserved, nets the right rubriek | `financial-result.ts:288-364`, `bank-matching.ts:202-213` |
| One payment → many invoices (atomic batch) | `bank-batch-reconcile.ts:152-209` |
| Cash book: opening balance + running balance (till cash + entries) + cash-paid-invoice settlement | `api/cash/route.ts:39-59`, `cash.ts:72-141`, `kasboek.ts:86-160` |
| VAT rubrieken **1a / 1b / 1e / 5b** for domestic 21/9/0 | `aangifte.ts:66-92`, `financial-result.ts:294-404` |
| Card-settlement triangle (till gross = EFT = bank net → acquirer commission as cost), cross-quarter de-dup | `financial-result.ts:142-347`, `card-reconcile.ts` |
| **Suppletie** — filed-quarter snapshot, >€1.000 delta ⇒ needsSuppletie | `btw-filing.ts:32-66`, `truth/route.ts:103-157` |
| Retention / audit trail (every plausible document stored) | intake losslessness, `documents` store |

---

## 2. Critical findings — silently wrong (fix first)

These are the places the app can be wrong **without flagging it**. All re-verified by grep (Appendix A).

### 2.1 🚨 Accrual-only VAT timing — no `kasstelsel` (cash basis)
The whole engine keys VAT to **`invoice_date` (factuurstelsel)** (`compute-result-range.ts:62-63`).
But a **snackbar / horeca is legally required to use the kasstelsel** (cash basis), and a retailer
selling ≥80 % to consumers may opt in — under which VAT (owed *and* voorbelasting) follows the
**payment date**. For the app's own target user this mis-periods nearly every installment and
every invoice paid in a later quarter.
**Impact: High. The timing model may be wrong for the exact business the app targets.**
_Grep: every VAT-timing comment says "accrual / factuurstelsel"; no `kasstelsel` anywhere._

### 2.2 🚨 Negative cash balance passes the readiness gate
A negative kassaldo is the single biggest red flag the Belastingdienst uses to reject a cash
administration (implies hidden turnover). The app shows it in red (`KasClient.tsx:272-273`) but
**does not block it** and it is **not a readiness gap** (`readiness.ts`, `api/readiness/route.ts`).
A legally-impossible drawer can ship as "klaar".
**Impact: High.**

### 2.3 Missing VAT regimes (each under-declares, some without a flag)
- **BTW verlegd / reverse charge (2a)** — not computed at all (`aangifte.ts:34-39`). A domestic
  verlegde purchase books cost with €0 voorbelasting and declares no 2a → net under-declaration.
- **Intracommunautaire verwerving (4b) + ICP-opgaaf** — heuristic **note only**, no computation
  (`aangifte.ts:119-124`, `closing-package.ts:856-859`).
- **KOR (kleineondernemersregeling)** — no flag, no field, no computation. A KOR-registered owner's
  aangifte is fully wrong (still computes verschuldigd/voorbelasting). _Grep: 0 hits in lib/api._
- **Import art. 23 (4a)** — absent.
**Impact: High for any owner who hits one; some are noted, KOR/verlegd are silent.**

### 2.4 No wages / salaris model
No `salaris` category in `CASH_CATEGORIES` (`cash.ts:13`) or `SELECTABLE_CATEGORIES`
(`bank-categories.ts:34-42`). Wages get shoehorned into generic `kosten` (or, if left as
`transfer`/`prive`, vanish from P&L). No loonheffing / net-wage liability.
**Impact: High — wages are error-prone and invisible to any payroll logic.**

### 2.5 `bankkosten` (fee) excluded from cost → overstates profit
`bank-categories.ts:60` maps `fee → "excluded"`. Dutch bank charges are a **deductible** business
cost (VAT-exempt). Excluding them systematically overstates profit.
**Impact: Medium, systematic.** _Grep confirmed._

### 2.6 No bank-balance reconciliation (statement completeness)
MT940/CAMT `:62F:` closing balance is parsed only as a comment, never verified against
`open + movements` (`bank-parser.ts`). A skipped statement page or truncated CSV under-counts money
with **no detector** — the one place the otherwise-strong "no silent loss" discipline has no witness.
**Impact: Medium–High.**

### 2.7 Bad-debt VAT recovery (oninbare vordering) — missing
No mechanism to recover output VAT on an uncollectible debt (deadline: 1 year after due date).
Money is silently lost.
**Impact: High when it occurs.**

---

## 3. Full scenario matrix (36)

Legend: ✅ handled · ⚠️ partial / silent-risk · ❌ missing · *(risk if mishandled)*

### Intake / Documents
| Scenario | Verdict | Note |
|---|---|---|
| Bon photographed, paper binned | ✅ | AI → verify queue → booking; never auto-paid |
| Supplier invoice only via bank (no doc) | ✅ | refuses to invent VAT; flags "missing inkoopfactuur" |
| Mixed formats PDF/img/Excel/UBL | ✅ | unreadable filed safe |
| Duplicates (byte-hash + semantic, cross-channel) | ✅ | |
| Non-invoice noise (quotes, reminders, statements) | ✅ | deterministic statement/reminder guards |
| Foreign-currency invoice | ⚠️ | currency conversion not verified — **needs a look** |

### Bank
| Scenario | Verdict | Note |
|---|---|---|
| Card settlement batches (T+1, PSP) | ✅ | triangle + budget-bounded de-dup |
| Chargeback / terugboeking | ✅ | |
| Private money in/out | ✅ | `prive` |
| Bank reconciliation / aansluiting | ❌ | `:62F:` never verified — completeness gap (§2.6) |
| Storting / opname + kruispost pairing | ⚠️ | business "Storting" not auto-classified; no two-leg pairing |
| Bank costs / interest | ⚠️ | `fee` excluded from cost (§2.5) |

### Invoice lifecycle & payments
| Scenario | Verdict | Note |
|---|---|---|
| Create outgoing sales invoices | ✅ | full legal lifecycle (Art. 35) |
| Supplier invoice paid in installments | ✅ | accrual-correct |
| Your invoice received in installments | ✅ | |
| Cross-period (prior Q/yr paid later) | ✅ | invoice-date accrual |
| One payment → many invoices | ✅ | atomic batch |
| One invoice → many methods (cash+bank) | ⚠️ | split across methods not jointly reconciled |
| Creditnota / refund (sales & purchase) | ✅ | |
| Prepayment / vooruitbetaling | ❌ | likely missing — VAT-point on advance not modeled |
| Bad debt (oninbaar, 1-yr) | ❌ | no VAT recovery (§2.7) |
| Recurring invoices (water/energy) | ⚠️ | email intake yes; no recurring *detection* / no inbound address |
| Wages / salaris | ❌ | no model (§2.4) |
| Tips / fooien | ⚠️ | risk of being taxed as omzet |

### Cash / kasboek
| Scenario | Verdict | Note |
|---|---|---|
| Daily cash split 9 % / 21 % | ✅ | per-rate turnover |
| Cash book core (opening/running/settlement) | ✅ | |
| Negative-till guard | ⚠️ | display-only, passes readiness (§2.2) |
| Statiegeld outside VAT | ⚠️ | blended-rate snap only |
| Owner private withdrawal of goods | ❌ | privégebruik (§ below) |
| **Cash-book expenses import** (Uitgaven spreadsheet) | ⚠️ | ingested as `ledger_daily` **witness only** — never a deductible cost / voorbelasting |

### VAT / aangifte — special regimes
| Scenario | Verdict | Note |
|---|---|---|
| 1a / 1b / 1e / 5b domestic | ✅ | |
| Suppletie (€1.000 threshold) | ✅ | |
| 1c (other rates) | ⚠️ | rates snapped to {0,9,21}; genuine "other" not representable |
| BTW verlegd (2a, in/out) | ❌ | §2.3 |
| EU acquisition (4b) + ICP | ❌ | note only |
| Import art. 23 (4a) | ❌ | |
| KOR | ❌ | §2.3 — would make the whole aangifte wrong |
| Privégebruik year-end (1d) | ❌ | no correction workflow |
| Margeregeling / assets+KIA / herziening | ❌ | |

### Period / closing
| Scenario | Verdict | Note |
|---|---|---|
| Suppletie at year-end | ✅ | |
| Retention / bewaarplicht | ✅ | |
| Balance continuity (opening = prior close) | ⚠️ | cash carries; no balance sheet / equity roll-forward |
| Jaarrekening (annual) | ❌ | per-quarter only |
| Regime / rate transitions (kasstelsel/KOR/rate) | ❌ | single global regime flag |

---

## 4. Data-model gap vs professional standards

Professional entrepreneur tools (Moneybird, e-Boekhouden, SnelStart) converge on **7 user-entered
primitives** per transaction and **derive** the rest (double entry, VAT posting, balances). BoekBrug
already captures most; the gaps line up with §2.

| # | Primitive | BoekBrug today |
|---|---|---|
| 1 | Amount | ✅ |
| 2 | Date | ✅ `entry_date` |
| 3 | Direction | ✅ |
| 4 | Counterparty / supplier | ⚠️ free-text only (no structured payee on cash) |
| 5 | Category (grootboek hidden) | ⚠️ present; missing `salaris` |
| 6 | VAT rate | ⚠️ allowed for `omzet` only — **blocked on a cash cost** even with a bon |
| 7 | Receipt attachment (required for voorbelasting) | ⚠️ `cash_entries.document_id` column **exists but is never set** by the create path |

**Universal rule all three enforce and BoekBrug already shares:** *no voorbelasting without a
document.* **Target model is Moneybird, not Exact** — hide grootboek numbers behind categories;
derive the ledger. **RGS** (Referentie Grootboekschema) is the right **export/coupling** target for
the accountant — a mapping layer at export time, **not** user-entered fields. Minimal RGS core for a
cash shop: Kas `BLimKasKas`, Bank `BLimBanRba`, Kruisposten `BLimKruSto`, Debiteuren `BVorDebHad`,
Crediteuren `BSchCreHac`, Voorbelasting `BVorVbkTvo`, Af te dragen BTW `BSchBepBtw`, Omzet
`WOmzNopOlh/Oll`, Inkoopwaarde `WKprInhInh`, Lonen `WPerLes`, Privé `BEivKapPro`.

---

## 5. Prioritized roadmap

1. **`kasstelsel` (cash-basis) option** — payment-date VAT timing. Highest value for the target user. (§2.1)
2. **Negative-cash readiness gate** — block the legal red flag from shipping. (§2.2)
3. **KOR flag** — when active, switch the VAT engine off entirely. (§2.3)
4. **Explicit "your accountant must handle X" flags** for every missing regime (verlegd, EU/ICP,
   privégebruik, wages) — converts *silent* wrong into a *surfaced* limit. Cheap, high trust-value.
5. **`bankkosten` → deductible cost** (un-exclude `fee`). (§2.5)
6. **Cash-cost fields**: wire `cash_entries.document_id`, allow a VAT rate on a cash cost **when a
   document is linked**, add a `salaris` category, add a structured counterparty. (§4)
7. **Bank statement-completeness check** — parse `:62F:` and reconcile open+movements=close. (§2.6)
8. **Storting ↔ kasboek kruispost pairing**; **bad-debt VAT recovery**; **annual jaarrekening/balance
   sheet**; **prepayments**.

### On the original trigger (cash-book / "Kiwi" spreadsheet import)
Do **not** build a blind importer. Build a **reconciliation + settlement** layer: the income column
is *reconciled* against `daily_turnover` (never re-booked → no double-count); expense lines are
*classified* (prive/storting safe now; supplier lines require a linked bon to keep voorbelasting;
salaris needs the new category). This is the same discipline as the existing `ledger_daily` witness.

---

## Appendix A — Verification (grep on `origin/main` @ `50c78ff`)

All six load-bearing *absence* claims confirmed:

1. `kasstelsel` — 0 hits; every VAT-timing comment reads "accrual / factuurstelsel". → **accrual-only confirmed**
2. `kor|kleineondernemers` — 0 hits in `src/lib`, `src/app/api`. → **KOR absent confirmed**
3. `verlegd|reverse charge|2a` — 0 hits in `aangifte.ts`, `financial-result.ts`. → **reverse-charge absent confirmed**
4. `salaris|loon|payroll|wage` — 0 hits in the category vocab. → **no wages model confirmed**
5. negative-cash — no negative/kassaldo check in `readiness.ts` / `api/readiness/route.ts`. → **not gated confirmed**
6. `fee` P&L role — `bank-categories.ts:60` `fee: "excluded"`. → **bankkosten excluded confirmed**

`HANDLED` verdicts are `file:line`-grounded (§1, §3) and were not re-audited — lower risk than absence claims.

## Appendix B — Sources (tax rules)
Belastingdienst: kasstelsel; btw aftrekken (voorbelasting); vereenvoudigde factuur; KOR-voorwaarden;
margeregeling; privégebruik auto; art. 23 import; btw-tarief dranken; fooien; aangifte corrigeren
(suppletie); btw terugvragen (oninbaar). KVK: KOR. Ondernemersplein: diensten binnen de EU;
margeregeling. Boekhoudplaza / referentiegrootboekschema.nl: RGS codes & ICP. Practitioner refs:
BDO (privégebruik), Moore-DRV (oninbare vorderingen), Fiscaal-online (suppletie €1.000 drempel).

---
*Generated from a multi-agent audit of `origin/main` @ `50c78ff`. Verdicts marked ✅/⚠️/❌ with
`file:line` evidence; absence claims grep-verified (Appendix A). This is an engineering assessment,
not tax advice — the tax-rule citations should be confirmed with the accountant before implementation.*
