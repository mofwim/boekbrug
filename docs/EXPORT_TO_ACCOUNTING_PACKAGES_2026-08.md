# Export to the big accounting packages — what actually pays off

_20 August 2026. Research, decision, and a build order. This answers one question: does a direct
export or integration with an existing accounting package (SnelStart, Exact) add value now?_

> **Reliability marks, same legend as `MARKTPOSITIE_2026.md:174-175`:**
> **[V]** confirmed against a primary source · **[O]** untested or secondary source ·
> **[T–]** checked and came back unconfirmed.
>
> **What this document could not do.** `snelstart.nl` and `b2bapi-developer.snelstart.nl` return
> 403 to this environment, as they did in `SNELSTART_CAPABILITY_MAP.md`. Every SnelStart
> commercial term below is **[O]** from search indexes and reseller pages. Four of them decide
> whether the built koppeling is shippable at all — §8 step 0 is how you settle them in an
> afternoon. Do not quote an **[O]** number to an administratiekantoor.

---

## 1. The answer in five sentences

**Yes — but not through a second ledger API, and the door that pays is one BoekBrug is already
standing in front of.** The Dutch office's real intake pipe for a small client is not an API at
all: it is a per-administratie e-mail address at a scan-and-recognise layer (Basecone,
TriFact365, Zenvoices), where a **PDF and a UBL file with the same basename** become a booking
proposal in seconds and then flow onward into whichever ledger that office runs — Exact Online,
Twinfield, AFAS, Yuki, SnelStart **[O]**. BoekBrug already builds that UBL (`src/lib/ubl-export.ts`,
covered by 8 conformance tests) but ships it nowhere useful: `buildInvoiceUbl` has exactly one
non-test caller, the XML is absent from the quarterly ZIP and from the invoice e-mail, and — the
sharpest finding in this document — **the same invoice gets three different filenames across the
three surfaces**, so the obvious "just forward it to your boekhouder's Basecone address" path
fails today at the filename, as a hard reject that swallows the PDF with it. A direct API
connector to Exact, Twinfield or AFAS buys the *owner* a convenience and the *office* almost
nothing, at six to ten weeks each behind review gates the counterparty controls. And the sentence
this whole area rests on — "the SnelStart koppeling is built and only waits on a subscription
key" (`docs/SNELSTART_INTEGRATION.md:3`) — **is not established**: the koppeling has never touched
a real SnelStart administratie, a free test key has been available the whole time, and its
commercial licensing model is an open question (§8 step 0).

This does not reverse `MARKTPOSITIE_2026.md`. Route D already said the integration is "a margin
improvement instead of a blocker" (`:335-337`). What this document adds is that there was a
**cheaper door nobody costed** — and that it reaches every package at once instead of one.

---

## 2. What is true today

**The UBL.** `src/lib/ubl-export.ts` produces UBL 2.1 (`UBLVersionID` at `:587`) with one
`TaxSubtotal` per **(rate, category) pair** — not per rate; per-rate grouping is the bug it was
deliberately moved off, because BR-S-08 / BR-Z-08 / BR-E-08 / BR-AE-08 each require their own
category's taxable amount (`:396-422`). Arithmetic is pinned by `src/lib/ubl-conformance.test.ts`
(8 tests, reads the XML the builder actually emits). It is explicitly **not** SI-UBL / NLCIUS
(`:7`). The exact gap list to become valid — verified field by field, not guessed:

| Missing | Note |
| --- | --- |
| `cbc:CustomizationID` (BT-24) | absent outside the comment on line 7 |
| `cbc:ProfileID` (BT-23) | absent |
| `cbc:EndpointID` on both parties (BT-34/BT-49) | absent |
| `cbc:BuyerReference` (BT-10) or an `OrderReference` | absent; NLCIUS requires one of the two |
| buyer `cac:PartyLegalEntity` | **supplier has it** (`:610-612`); the customer party does not (`:614-654`) |
| `schemeID` on the supplier's KvK `CompanyID` | present without the `0106` scheme attribute |

Everything else NLCIUS wants is already there: ID, IssueDate, DueDate, type codes, currency,
supplier `PartyTaxScheme`, `PaymentMeans` code 30 with IBAN, `AllowanceCharge` with `TaxCategory`,
`TaxExemptionReason`, `LegalMonetaryTotal`, per-line UN/ECE Rec 20 unit codes. **This is a
two-to-four-day gap, not a rebuild.**

**The three filenames.** Same invoice, three surfaces, three names:

- `boekbrug-factuur-{nr}-ubl.xml` — `src/app/api/export/ubl/route.ts:301`
- `{nr}.pdf` — `src/lib/email.ts:336`
- `{date}_{client}_{nr}.{ext}` — `src/lib/closing-package.ts:605,651`

Basecone and Zenvoices require the XML and the PDF **in one e-mail with identical basenames**,
treated as a single document; if the XML cannot be read, **the PDF is not processed either — there
is no OCR fallback, the whole delivery fails** **[O]**. TriFact365 also accepts a UBL without a
PDF **[O]**.

**The CSVs.** Two exports, and the accountant one is wrong. `invoicesToCsv`
(`src/lib/export.ts:176`) puts the invoice counterparty in the `Klant` column;
`invoicesToCsvAccountant` (`:231`) puts the *BoekBrug client* in that same column and drops the
counterparty name entirely — the office gets e-mail, address and city per row with no name against
them. Same header, two meanings.

**The ZIP.** `closing-package.ts` already assembles per quarter: original PDFs under
`facturen-en-bonnen/`, the bankafschrift, `Kasboek-Q{n}-{year}.xlsx` (`:703`), `dagomzet.csv`
(`:708`), `kaart-reconciliatie.csv` (`:722`), `overzicht.csv` + `overzicht.json` (`:734`, with a
full `dagomzet` block at `:811-821`), a concept-aangifte and an ICP CSV. No `.xml` anywhere.

**The SnelStart push.** Built, ~3,000 lines, gated on `SNELSTART_SUBSCRIPTION_KEY`
(`src/app/api/snelstart/status/route.ts:25`). It really does claim before it posts
(`push/route.ts:209-215`, `postBoeking` at `:224`) with a deliberate no-retry `unknown` state —
the most careful code in the repo. Its btw handling is genuinely good: `resolveBtwSoort`
(`snelstart-mapping.ts:220-234`) reads `/v2/btwtarieven` per administratie and matches on
**percentage**, preferring the non-verlegd variant and hard-blocking rather than guessing.
`isPushable` (`:120-192`) refuses on **seven distinct codes** across ten sites. But:

- **every line lands on one grootboek per direction** (`push/route.ts:186-189` →
  `snelstart-mapping.ts:337,346`), because `snelstart_connections` stores exactly two account ids
  and `suppliers` has no ledger column;
- **`unknown` has no way out** — `SnelStartCard.tsx:331-335` renders a count with no button, and
  §8 of `SNELSTART_INTEGRATION.md` says the koppeling is one-way, so BoekBrug **cannot even read
  back** whether such an invoice booked;
- **relations match on exact name** (`snelstart-client.ts:311-315`), so one OCR spelling variant
  writes a second, address-less supplier into the customer's relatiebestand — an irreversible
  write with no reconciliation trail;
- **the office is architecturally excluded**: `snelstart_connections` is `UNIQUE (user_id)` with an
  owner-only SELECT policy and *no write policy at all* (`supabase/migrations/snelstart_connection.sql:46,49,55-57`),
  and every route is scoped to `auth.getUser()` with none of the accountant dual-path that
  `/api/export/ubl` has. An administratiekantoor cannot connect, configure or push for a client;
- **SnelStart appears in no legal text** — not in the algemene voorwaarden, not in the privacy
  statement's subprocessor list.

**No ledger of our own.** No accounts table, no journals, no mutations. The whole account-like
vocabulary is seven bank categories (`src/lib/bank-categories.ts:34-42`), of which only two are
costs (`PNL_ROLE`, `:70-86`). BoekBrug owns no chart of accounts; it borrows two lines from the
customer's. That is what puts XAF and RGS out of reach outright, and why a memoriaal export would
today book everything onto two accounts.

**The differentiator has no export path.** `triangle.ts:78-152` reconciles till **PIN** (not cash —
that is `turnover-closing.ts:121-129`) against the terminal settlement and the net bank payout, and
**measures** the acquirer commission (`card-reconcile.ts:102`); `compute-result-range.ts:427-431`
**books** it, netted against acquirer-fee invoices, and **only under factuurstelsel — under
kasstelsel deliberately not at all**. None of it reaches any accounting package: `snelstart-queue.ts`
reads `invoices`, `invoice_lines` and `snelstart_exports`, and nothing till-, terminal- or
payout-shaped is in any of the three.

---

## 3. The four doors — ranked by packages reached per week of work

| # | Door | Packages reached | Work | Recurring cost | Gate |
| --- | --- | --- | --- | --- | --- |
| 1 | **E-mail intake: PDF + UBL, matching basenames** | every package the office's pre-processing layer feeds — Exact, Twinfield, AFAS, Yuki, SnelStart, e-Boekhouden **[O]** | days | € 0 | none |
| 2 | **Make the UBL SI-UBL/NLCIUS valid** | adds the strict importers and the Peppol lane later | 2–4 days | € 0 | none |
| 3 | **SnelStart push (already built)** | 1, owner-side | ~1 week of safety work | € 250 one-off **[O]** + certification | certification + an unanswered licensing question |
| 4 | **Exact / Twinfield / AFAS connectors** | 1 each | 6–10 weeks each | see below | vendor review |

**Why door 1 wins and it is not close.** It needs no OAuth, no app review, no subscription key and
no partner agreement, it reaches every package at once because it lands *upstream* of the ledger
rather than inside it, and it lands **before** the office's own review step instead of bypassing
it — which is the step the office is paid and liable for. An API writes into the ledger; the
mailbox hands the office a proposal. Only one of those is a thing an office can say yes to without
a conversation about liability.

**On door 4, the gates, corrected:**

- **Exact Online.** A *pilot* is not blocked: a single customer can register an OAuth app inside
  their own division, no Exact review **[O]**. The review gate governs *scaling* to other tenants,
  and Exact publishes no timeline for it. The real hazard is operational: access tokens live 10
  minutes and refresh tokens rotate single-use, so two concurrent lambdas refreshing one connection
  kill it — serialization BoekBrug has no pattern for, where SnelStart's clientkey model needs
  none. Limits are 60 calls/company/minute and 5,000/company/day **[O]**.
- **Twinfield.** A mandatory paid API-certification subscription (amount not published) plus a
  biennial re-audit **[O]**. _(The "€ 53/month" figure in circulation is **[T–]** — do not use it;
  the € 12,00/administratie on Twinfield's price list is a **customer-side** charge, not a partner
  fee.)_
- **AFAS.** Certification requires five or more employees, **five or more customers already using
  the integration**, a periodic pentest, standard functionality, and a licence from € 155/month
  **[O]**. Note the bootstrap trap: you need customers on the integration before it can be
  certified.
- **Ease of entry among the smaller packages [O]:** Moneybird (self-service OAuth, no approval, no
  fee) → e-Boekhouden.nl (no registration, but customer-pasted token and unconfirmed pricing) →
  Jortt (e-mail registration, and API only from MKB/Plus upward — not the tiers our users are on)
  → Yuki (write access needs a written request to support). Never write "they all have open APIs".

---

## 4. The idea — **De Sluis**: one delivery, every package

A lock, not a bridge. A bridge carries you across regardless; a lock opens only when both water
levels are equal. **BoekBrug hands the office a delivery it has already proved, addressed to the
intake the office already uses, and refuses to hand over what it cannot prove.**

Per client, per period, to the office's own intake address:

1. every invoice as **PDF + UBL with the same basename**, in one message, so the office's software
   reads it as structured data instead of scanning it;
2. a **delivery note** saying what went, what did not, and why — in the same sentence the owner
   sees on their readiness screen and the office sees on the werkbord;
3. the **dagstaat** per day: till turnover, terminal settlement and bank payout tied out against
   each other, with the acquirer commission on the day it was actually deducted.

Item 3 is the cargo no scan-and-recognise tool can produce, because none of them stands on the
till, the terminal and the bank at once. Items 1 and 2 are the container that gets it accepted.

**What it is not:** not a ledger API, not a pre-processing product competing on integration count,
not a bulk migration of administraties. And note the positioning correction: **integration count is
not the entry criterion** for that category — Basecone is the incumbent with a visibly shorter list
than TriFact365. The gate is covering the two or three packages *the office in front of you* runs.

**Monday's work, in order:**

1. One shared `invoiceBaseName()` used by `export/ubl/route.ts:301`, `email.ts:336` and
   `closing-package.ts:605` — three names become one.
2. `buildInvoiceUbl` gets a bulk caller: write `.xml` siblings next to every PDF at
   `closing-package.ts:651`.
3. A per-client `boekhouder_intake_email`, set by the office on the werkbord, and a mailer that
   sends the pairs. `email.ts` already sends attachments; `cron/quarter-close/route.ts:189` already
   mails the office per client with a package link.
4. Generalise `isPushable` (`snelstart-mapping.ts:120-192`) from "may this go to SnelStart" to "may
   this leave the building", and print the refusal reason identically on both screens.

---

## 5. The dagstaat — and the endpoint that would have been wrong

If the dagstaat is ever posted to SnelStart rather than delivered as a file, **it does not go
through `/v2/memoriaalboekingen`.** A memoriaalboekingsregel has five fields (Omschrijving,
Grootboek, Kostenplaats, Debet, Credit) and the memoriaalboeking model contains **zero** btw
fields **[V]**. Posting btw as ordinary debet/credit lines lands the amounts on the ledger *without
registering them as btw* — and the owner's aangifte then comes out silently wrong, which is exactly
the class of failure `snelstart-mapping.ts` exists to prevent.

The right endpoint is **`/v2/kasboekingen`**: relation-less, with `GrootboekBoekingsRegels` each
carrying an optional `BtwSoort` and separate `BtwBoekingsregels` of `{Debet, Credit, Type, Tarief}`
**[V, re-check against the developer portal]**. Neither endpoint exists in
`src/lib/snelstart-client.ts` today, which implements `/btwtarieven`, `/grootboeken`, `/relaties`,
`/inkoopboekingen` and `/verkoopboekingen` and nothing else. Note also that the `Hoog|Laag|Overig`
enum problem applies **only** on this path — the built inkoop/verkoop path already resolves btw by
percentage against the customer's own tarieven.

Build the dagstaat as a **pure builder first**, emitted as `memoriaal-Q{n}.csv` in the ZIP. An API
destination is a second emitter over the same builder, and only if an office asks.

---

## 6. What not to build, and why

| Not this | Reason |
| --- | --- |
| **An Exact Online connector** | 6–10 weeks before a review gate Exact controls, and a token model that breaks a quarterly-use app; door 1 already reaches Exact through the office's own intake |
| **Twinfield / AFAS** | A paid certification subscription plus biennial audit; AFAS's five-employees / five-customers-already-on-it condition is a permanent no under the current company shape **[O]** |
| **XAF 4.0 / RGS** | Not because it is upstream — because **BoekBrug keeps no general ledger**. An auditfile is a ledger dump. Cite 4.0.3 (10 April 2025); 1 Jan 2027 is the date the Belastingdienst/ODB stops accepting 3.2, not a statutory deadline — no Dutch law names XAF **[V]**. Exact exports XAF and does **not** import it (it does import its own XML and an RGS-brugstaat) **[V]** |
| **Becoming a Peppol access point** | The Nederlandse Peppolautoriteit **already requires ISO 27001 today** (a TPM assurance report is the accepted alternative); the 1 July 2027 EU-wide date is not an 18-month runway for a Dutch entrant **[V]**. OpenPeppol membership alone runs to the low thousands per year for a small organisation, with the audit as the dominant cost. _(Sending through someone else's access point remains a 1–2 week option later.)_ |
| **Automatic / scheduled push** | Deletes the safety model the module exists for |
| **Multi-administratie SnelStart** | Rewrites the claim index — the most delicate code in the repo — for demand nobody has measured |

**Peppol/ViDA is not a reason to act now.** What is **binding**: Council Directive (EU) 2025/516
(ViDA), in force 14 April 2025, requires structured e-invoicing and digital reporting for
**intra-EU cross-border B2B from 1 July 2030**, replacing the opgaaf ICP **[V]**. What is **advice
only**: the EY report, dated 26 January 2026 and sent to the Tweede Kamer on 10 March 2026,
recommends a *domestic* obligation from 1 January 2030; internetconsultatie is planned for Q4 2026
and adoption targeted mid-2028 **[V]**. There is no Dutch domestic B2B mandate in force or in a
bill. Say *advies*, never *wet*. The only thing Peppol justifies today is door 2 — which serves De
Sluis now and buys the 2030 option for free.

---

## 7. Build order

Each step: cost, what it proves, and the observation that stops it.

| # | Step | Cost | Proves | Stop if |
| --- | --- | --- | --- | --- |
| 0 | **The afternoon that settles everything** (§8) | ~3 h | whether the built koppeling is legally shippable, and whether the UBL is read as data | — unconditional |
| 1 | One `invoiceBaseName()`; `.xml` siblings in the ZIP | 2–3 d | the delivery is mailable at all | — |
| 2 | Intake address on the werkbord + PDF/XML mailer + delivery note | 1 wk | whether an office accepts mail from a BoekBrug relay rather than the client's own mailbox | offices insist the client forwards from their own address → ship it as "forward this ZIP", still a product |
| 3 | NLCIUS fields + rewrite `/voor-boekhouders:181-185` + update `office-front-door.test.tsx` — **one commit** | 2–4 d | strict importers and the Peppol lane | — must be one commit: the page currently publishes "zonder CustomizationID" as the answer |
| 4 | Counterparty name back in `invoicesToCsvAccountant` | 1 h | — | — a defect, not a bet |
| 5 | Safety work before any SnelStart key: `unknown`-resolve route + button; relation-name normalisation + cache; SnelStart named as subprocessor in the privacy statement | 1 wk | — | — unconditional if step 0 says the koppeling is shippable |
| 6 | Pure `buildDagstaat()` → `memoriaal-Q{n}.csv` in the ZIP | 2–3 wk | whether a certified day is worth re-keying eight lines for | the first office says it books the day from the bank statement anyway |
| 7 | SnelStart certification | € 250 **[O]** + ~12 days **[O]** | the distribution hypothesis | SnelStart cannot say the Koppelingen screen sends anyone anywhere |

Note on step 7: the Koppelingen listing and Software Partner naming apply to a **certified
productiekoppeling** only — a maatwerkkoppeling puts you in front of nobody **[O]**. And step 5's
relation defect is a certification risk, not a UX bug: the ~12-day window exists precisely to watch
how a koppeling behaves inside a customer administratie, and one that pollutes relatiebestanden is
a plausible way to fail the gate.

---

## 8. Step 0 — the afternoon that settles it

The single most load-bearing sentence in this whole area is `SNELSTART_INTEGRATION.md:3`:
*"geïmplementeerd, wacht op een subscription key om live te gaan."* Three findings say it is wrong.
The koppeling's auth model is **the end user's own maatwerksleutel** (§1–2 of that document), and a
maatwerkkoppeling is documented as *eigen gebruik* — your own administratie, not a customer's
**[O]**. Serving other parties' administraties is what a **certified productiesleutel** is for. If
that reading holds, certification is not phase two for the accountant channel: it is a prerequisite
for the **first paying user**, plus possibly an auth rewrite. Separately, §10 confirms every test
runs with an injected `fetch` — **nothing in this koppeling has ever run against a real SnelStart**,
and a free Test & Development key has been available the entire time **[O]**, so the key was never
what blocked validation.

1. Register at `b2bapi-developer.snelstart.nl`, take the free **Test & Development** product,
   request a testadministratie. _(~30 min)_
2. Push one real invoice end to end and find it under Inkoop-/Verkoopboekingen. This validates the
   payload shape, the `/btwtarieven` percentage match, the OData relation filter and the
   400-on-revoked-key path in one go — four things currently proven only against our own mock.
   _(~2 h)_
3. Open `snelstart.nl/api/certificeren` **in a browser** and pin three numbers verbatim: the € 250
   basis, the ~12 days, and the maatwerk-vs-productie scope. _(~20 min)_
4. Send SnelStart partner support **one written question** and keep the reply: *"May a commercial
   SaaS product let each of its customers supply their own maatwerksleutel, or does serving
   multiple customers' administraties require a certified productiesleutel?"* _(~10 min)_
5. Mail one real PDF+UBL pair with identical basenames to a TriFact365 and a Basecone trial intake.
   *Proves whether our lenient UBL is read as structured data.* _(~30 min)_
6. Run `docs/WELKE_MIGRATIES_STAAN_ER.sql` and settle whether `snelstart_claim_before_push.sql` is
   applied. It matters which world we are in: **applied** means `unknown` rows can strand an invoice
   with no way out; **not applied** means the double-booking guard is off and the push silently
   falls back to claim-after-POST on error 23514 (`push/route.ts:386-397`). The document cannot
   claim both. _(~10 min)_

Until (4) comes back in writing, say **"the koppeling is built against a test key and its
commercial licensing model is unconfirmed"** — never "it waits on a subscription key".

---

## 9. Corrections this research forces on existing documents

| Where | What is wrong | Replace with |
| --- | --- | --- |
| `MARKTPOSITIE_2026.md:316-317` | "XAF 3.2" (superseded Feb 2025) **and** "grep returns **zero** hits in `src/`" — now false since `voor-boekhouders/page.tsx` shipped on 19 Aug | XAF **4.0**; and "the only hits for `xaf`/`rgs` in `src/` are the three lines telling an office we do not have it (`:22,175,177`); `auditfile` is still zero" |
| `MARKTPOSITIE_2026.md:464-466` | "there is **no** Dutch e-invoicing mandate date" — since 10 March 2026 there is a recommended one | "no **enacted** date. An advisory report … recommends 1-1-2030 domestic and 1-7-2030 cross-border … say *advies*, never *wet*." |
| `BoekBrug_Inkoopfactuur_Poorten.md:223`, `BoekBrug_Future_Ideas.md:41-47` | state the mandate as settled law | mark 1-1-2030 as **advice**, 1-7-2030 as **binding, cross-border only** |
| `SNELSTART_INTEGRATION.md:3` and §9 | "waits on a subscription key"; runbook omits certification, the € 250 and the 12-day window | rewrite per §8 above |
| `SNELSTART_INTEGRATION.md` §6 | describes the old partial index `WHERE status = 'pushed'` | the shipped index covers `('pushed','unknown')` — `snelstart_claim_before_push.sql:63-65` |
| `SNELSTART_INTEGRATION.md:5-6` | "het boekhoudpakket dat onze doelgroep het meest gebruikt" — uncited, and `MARKTPOSITIE:192-193` says any plan resting on market share rests on nothing | state it as an assumption, or count it |

---

## 10. What we do not know, ranked by how much depends on it

1. **Whether a commercial product may run on its customers' maatwerksleutels.** Decides whether the
   built koppeling is shippable at all. One e-mail (§8 step 4).
2. **Whether an administratiekantoor wants a posted booking or a checked delivery.** Stop point 2 of
   `MARKTPOSITIE_2026.md`, open by decision (`PRICING_DECISION_2026-08.md:17-18`). Everything above
   turns on it.
3. **Whether our UBL is accepted by Basecone / TriFact365 / Exact.** Published as fact on
   `/voor-boekhouders:181-185` on the strength of one uncited code comment (`ubl-export.ts:6`), on
   the page whose own rule is ONLY WHAT EXISTS (`:19-26`). Settled in an afternoon; highest
   risk-per-euro in the repo.
4. **How many of our users run SnelStart, or Exact.** Nothing counts it.
5. **Whether `/v2/kasboekingen` accepts the dagstaat shape we would build.** The endpoint is
   confirmed; the payload contract has not been read first-hand.
6. **Whether the Koppelingen listing sends real traffic.** The entire distribution argument for
   step 7. Ask it in the same mail as the key application.
7. **Minutes and euros an office actually saves.** No independent measurement exists — every
   multiplier in circulation is vendor self-reporting and must be attributed by name. If a number is
   needed, do the arithmetic in the open: invoices per client per quarter × minutes per invoice ×
   hourly rate.

---

## 11. How this document was made

Nine parallel research agents across five lenses (the code surface, the counterparty APIs, the
office's working day, this repo's own strategy documents, and cost/risk), then three independent
positions written against a shared dossier — a skeptic, an advocate and a reframe — and finally ten
adversarial verifiers who re-checked every load-bearing claim against the code or a primary source,
plus a completeness critic. **Four claims were refuted outright and did not survive into this
document**, among them "isPushable refuses on 11 codes" (it is seven), "the dagstaat goes through
memoriaalboekingen" (it cannot carry btw), and two savings figures with no traceable source. The
filename mismatch in §2 was found by the critic, by combining two findings neither verifier had put
together. Where a number could not be reached from this environment it carries **[O]** or was
deleted.
