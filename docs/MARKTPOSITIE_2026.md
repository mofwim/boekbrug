# BoekBrug — market position, written down honestly

_July 2026. Written at the founder's request, with these words attached: "SnelStart offers
something genuinely big; what sets us apart is nothing compared to what they can do. When we
started, the idea was: the small client makes an invoice, receives an invoice, and it reaches
the boekhouder."_

_This is not a pitch and not a consolation._

> **On language.** This document is written in English, per `AGENTS.md`. Quoted material stays
> in the language it was written in — the founder's words above, the code comment in §2, and the
> wording of the published terms — because translating a quote changes what was said. Dutch
> domain terms (btw, KvK, zzp, aangifte, boekhouder), URL segments and plan names are product
> facts, not prose, and stay as they are.

---

> ## ⚠ Re-verified 14 August 2026 — four load-bearing statements are out of date
>
> This document describes the repo as it stood in July 2026. Building continued afterwards, and
> **two of the eight stop points were already resolved before anyone read them** — the document
> was sending the founder at work that no longer existed. What is actually in the repo now,
> checked line by line:
>
> | Statement in this document | Status on 14 Aug 2026 |
> |---|---|
> | "no PSD2" (§1, §2) | **OUT OF DATE.** `src/lib/enablebanking-client.ts` plus `-connection`, `-sync` and `-map`, a `/dashboard/bank` connect screen, and a daily cron in `vercel.json`. It is a full AIS bank connection that *replaces* an earlier GoCardless client. It still waits on `ENABLEBANKING_APPLICATION_ID` and `_PRIVATE_KEY` — so: built, not switched on |
> | "no legal entity: `/voorwaarden` is live with `[JOUW NAAM]`" (§1, stop point 0) | **OUT OF DATE.** `src/content/legal/company.ts` fills the identity at render time from `NEXT_PUBLIC_COMPANY_*`, with deliberately unfinished fallbacks (`(volgt)`) that can never read as a real-but-wrong KvK number. `company.test.ts` scans the *rendered* documents for any surviving `[...]` token and fails the build. The KvK registration itself is still open — the placeholder leak is not |
> | "the terms quote Pro € 25 and Pro+ € 45 incl. PSD2" (stop point 0b) | **OUT OF DATE.** §5.1 of the terms now reads Boekhouder € 0 (≤ 10 linked clients) · Ondernemer Gratis € 0 · Ondernemer Plus € 12,99 incl. btw. No legal document promises PSD2 anywhere any more |
> | "the database knows a different four-tier model" (stop point 0b) | **OUT OF DATE.** `database.sql:436` is `free/plus/boekhouder`; `supabase/migrations/subscription_plans_fair_use.sql` migrates the old rows across and forbids `boekhouder_pro`. No non-test code reads the old values |
>
> **What survived re-verification**, confirmed against the code again: no XAF audit file, no RGS,
> no filing to the Belastingdienst (the `aangifte` screen prepares, it does not submit), the UBL
> export is still deliberately *not* SI-UBL/Peppol BIS (`src/lib/ubl-export.ts:7`), the SnelStart
> connection still waits on a subscription key (`docs/SNELSTART_INTEGRATION.md:3`), and the
> triple card reconciliation is real.
>
> **One claim in §6 needs splitting in two.** "English exists only for the public tools and the
> blog" is now **out of date**: `src/lib/i18n/` carries a full translation layer (`messages.ts`,
> `locale.ts`, `server.ts`, `t.ts`, `use-locale.ts`) reaching the dashboard, in nl/en/ar/tr. But
> the two details cited alongside it still **hold**: `lang="nl"` is still hard-coded in
> `layout.tsx:90`, and `preferred_language` on `profiles` is still read by no line of code —
> the latter now by explicit design, because the locale lives in a cookie and deliberately not
> in a profiles column (`use-locale.ts:6`).
>
> **One claim could not be tested here:** the commit split "80 mofwim alongside 131 AI" in §7.
> This working copy is a shallow clone (125 commits, one author visible), so that number cannot
> be checked from here — not refuted, but unverified.
>
> **The lesson that is bigger than the corrections.** §0 warned that the market figures were
> untested, but presented the statements about our own repo as the *hard* part ("checked line by
> line"). That was true on the day it was written, and that is exactly what made it the most
> dangerous part: untested market figures stay untested, but a verified statement about your own
> code **decays** — and goes on reading as fact afterwards. Re-check the repo statements before
> any decision that leans on them.

---

## 0. How reliable is this document

Six parallel research tracks (competitors, the pre-processing category, market size,
distribution, legal forces, language segment), then a counter-read, then a check of every
statement about the product against the code itself.

**Two warnings to read before basing a decision on any of this:**

1. **The adversarial verification failed.** Five load-bearing claims went out for independent
   verification; **five out of five came back UNVERIFIABLE** — not because they are untrue, but
   because the session's search budget ran out and outbound connections were refused. Zero
   claims were confirmed. More than eighty load-bearing claims were never tested at all.
   **The entire pricing picture in chapter 3 is therefore unverified**, including the figures
   most of the conclusions lean on.
2. **Nobody in this whole stack actually opened a competitor's pricing page.** Every price comes
   from comparison and affiliate sites. Three affiliate sites saying the same thing are one
   source, not three.

What *is* solid: everything about BoekBrug itself. That was checked line by line in the repo and
is cited with the file name. (See the re-verification block above: that solidity has a shelf
life, and part of it has now expired.)

> **One afternoon of work replaces a hundred pages of desk research:** open the pricing pages of
> Moneybird, e-Boekhouden, SnelStart, Reeleezee, Basecone, TriFact365 and Yuki yourself. Note the
> date you consulted them and whether the amount is inclusive or exclusive of btw. Do that before
> a single pricing decision.

---

## 1. The honest answer in five sentences

As an **accounting package**, BoekBrug loses every comparison on row one of the feature table —
no filing to the Belastingdienst, no XAF audit file, no RGS, and per `src/lib/ubl-export.ts:7`
the UBL export is deliberately not SI-UBL/Peppol BIS — and that is not a gap you can close but
a wrong category. _(The original sentence opened with "no PSD2"; a full bank connection has
since been built — see the re-verification block.)_ At the same time, that same repo holds
something no Dutch party in the € 0–25 segment has: a **triple reconciliation of card revenue**
(till Z-report versus terminal settlement versus net bank payout) that books the difference as
acquirer commission instead of letting it vanish into a tolerance. So the founder is right about
the surface of his product and wrong about its depth: what he lists as differentiators
(invoicing, scanning, letting the boekhouder look along) really is commodity, and what does
differentiate appears on no feature list — including his own. But that differentiator is proven
on **one shop, one acquirer format, two days**, the SnelStart connection is **not live** (it is
waiting on a subscription key the counterparty still has to issue), and there is **no legal
entity yet** — the KvK registration is still open, though the placeholder leak this sentence
originally cited has been fixed. The position is therefore neither "hopeless next to SnelStart"
nor "we have a moat" — it is: **one unusually good piece of engineering with no company around
it, and without a single conversation with a buyer.**

---

## 2. What you see correctly, and where you are wrong

### Where you are right — more right than you think

**Making invoices is dead as a differentiator.** Not only because at least six NL packages have
a free or long-free entry tier (Moneybird, Jortt, Tellow, Rompslomp, Fiskr, MoneyMonk)
[untested], but because the search term itself is lost: the top of "factuur maken" is Canva,
Adobe Express and invoice-generator.com — not Dutch accounting software. The growth plan in the
repo still bets on it. That bet has to go.

**AI receipt scanning is a checkbox.** Your own `SNELSTART_CAPABILITY_MAP.md` says so: at
SnelStart it is in "every package". What you do *around* it — arithmetic checking
(excl+btw=incl), byte-hash *and* semantic duplicate detection, refusing instead of filling in —
is genuinely different, and you sell that nowhere. You sell the scan. You should be selling the
**refusal**.

**"Your boekhouder looks along for free" is table stakes.** Everything your accountant module is
worth sits in what comes on top of that: the work board across *all* clients, deadline tracking,
readiness score, write locks. That is practice management, not read access — and that is not
what it is called today.

**No PSD2 is fatal — in the generic category.** Moneybird prices its subscriptions on the number
of automatically processed bank transactions [untested]. In that pricing model your file import
is the free variant. _(A bank connection has since been built; see the re-verification block.
The argument stands for the period before it is switched on.)_

**The knowledge base as an acquisition engine is carrying too much weight.** The head terms are
held by ~20 affiliate comparison sites paid per lead [untested]. A team without capital cannot,
by definition, outbid that.

### Where you are wrong

**"What sets us apart is nothing."** That is a comparison of feature lists, and there you are
right. But the thing you built is on no feature list. From `card-reconcile.ts`, as a comment on
your own code (quoted in the original Dutch):

> _"de oude reconcileDay vergeleek bruto-kassa direct met netto-bank en slikte, om een
> dagelijkse valse breuk te vermijden, het verschil in een tolerantie — waarmee de
> acquirer-commissie stilzwijgend verdween (winst overschat)."_

That is not a cash book. That is Leg A (`till PIN gross == EFT gross` — a break here is a *real*
discrepancy: a missing receipt, a terminal error, theft) and Leg B (`EFT gross − bank net =
commission` — a cost line that today sits nowhere in many shops' books), with a T+0..T+5
settlement window two engines have to share because otherwise they fight over which day a payout
belongs to. Six pure modules, ~135 tests, checked against real files from a real shop.

**You underestimate what that is, and simultaneously overestimate how far along it is.** It is
one shop, one acquirer format (Equens CTAP), two days. That is a strong signal, not proof.

**You think SnelStart's breadth is an advantage.** For a card- and cash-driven micro business
most of that breadth is dead weight — your own §6 has that right. The problem is not that
SnelStart can do more. The problem is that SnelStart is already **there**, at the office. That is
a distribution problem, not a product problem, and those two require completely different
solutions.

**And one dangerous one:** your own entry-tier analysis says SnelStart's inStap tier (± € 14.50)
is "exactly our target group and exactly our promise" — with PSD2 and scan & recognise included.
As long as BoekBrug positions itself as a cheap complete package, that is not a partner but the
direct competitor, and then you lose on price *and* on features at once.

---

## 3. The landscape

Reliability: **[V]** confirmed multiple times · **[O]** untested, secondary source ·
**[T–]** went through verification and came back *unconfirmed*.

| Player | Target group | Price/mo | What BoekBrug runs into |
|---|---|---|---|
| **SnelStart** | Small traders + their office | inStap ± € 14.50 [O] | Their entry tier *is* your proposition, with PSD2 and scan & recognise. And the office already runs on it |
| **Moneybird** | zzp service providers | € 0 / 15 / 28 / 39 [T–] | Price differentiation sits *on* automatic bank transactions. NL/EN/DE interface [O] — the "English flank" is not undefended |
| **e-Boekhouden** | zzp + SME, price fighter | € 7.95 / 13.90 / 24 [T–] | Since 2003, phone support; reportedly has a daily-revenue screen that books cash *and* PIN [T–] |
| **Jortt / Tellow / Rompslomp / Fiskr / MoneyMonk** | zzp, free entry | € 0 → 20–33 [O] | Six free tiers. A paid generic entry product is dead on arrival |
| **Reeleezee** | Retail/hospitality *with* a till | € 29–89, sources contradict each other [O] | The closest positioning that exists — expensive, and with till and inventory |
| **Exact Online** | Via the office | from € 49 [O] | Most-used package in NL accountancy [O]. Every serious pre-processing party integrates with it. You do not |
| **Basecone** (Wolters Kluwer) | Offices, pre-processing | ± € 7.50/administratie [O, partly 2017–2021] | No visible wave of dissatisfaction to ride |
| **TriFact365** | Offices, pre-processing | € 2.50 → 0.99/administratie [O]; 11 integrations | Proof that entering *is* possible — and the reason that wedge is already driven |
| **Zenvoices** | Offices, conversion | ± € 0.09/invoice [O] | Document recognition is settled in cents per item |
| **Winkelboekhouding.nl / Mplus / Lightspeed connectors** | Retail/hospitality | ± € 15/mo per connection [O] | **The real opponent of route A.** They push daily statements through *with* payment-method splits |
| **A2X / Link My Books / Synder** (international) | E-commerce | from ± $ 25–29 per channel/mo, up to $ 1,039 [V, July 2026] | The same shape — settlement → ledger, fee as a separate cost line — but for webshops, not physical terminals |

**What this table does not contain, and that is the most important thing about it:** no market
shares, no paying-customer counts, no churn, no CAC. Those do not exist publicly for this market.
Any plan resting on market share rests on nothing.

---

## 4. The category question

BoekBrug sits in **three** categories at once today, and in two of them it accidentally loses to
parties with a hundred times the money.

**Category 1 — accounting package for zzp (€ 0–25).** Fifteen to thirty active players, six free
tiers, PSD2 as table stakes, and a search page owned by affiliates. You do not lose on product;
you lose on row one of the table and on ad budget.

**Category 2 — public calculators and "factuur maken".** Here your opponent is Adobe and Canva.
That is not a hard fight, it is the wrong fight.

**Category 3 — pre-processing towards the office's ledger.** The price floor is € 2–3 per
administratie [O] and the entry criterion is the **number of integrations**, not recognition
quality: TriFact365 has eleven. You have one, and it is not switched on yet.

**The smallest category BoekBrug can *win* rather than merely compete in:**

> **The daily close of a card- and cash-driven shop or hospitality business, delivered as a
> correct booking in the package its boekhouder already works in.**

Not "accounting". Not "scanning receipts". Closing a day where three sources — the till, the
terminal, the bank — name different amounts, and pointing at which of the three is lying.

**Two sobering notes.** The international players (A2X, Link My Books, Synder) do exactly this
shape for webshops, verified, from ± $ 29 per channel per month. That is good news at the same
time — **willingness to pay for settlement reconciliation is proven, and ten times higher than a
€ 2–5 per administratie price** — and bad news: your moat is localisation to Dutch physical
terminals, not invention. And the market's standard answer already exists: book the payment
method to a **suspense account** and review it periodically (that is how Jortt explains it
themselves) [V]. The difference between "a suspense account nobody reconciles" and "a day that
is correct" is precisely your product — and precisely what you have to test with ten offices
before building anything on it.

---

## 5. The original idea, weighed again

> _"De kleine klant maakt een factuur, ontvangt een factuur, en die bereikt de boekhouder."_

All three links are, in 2026, a free part of somebody else's product. As a business in its own
right this chain is **no longer a business** — it is a feature in someone else's product, and
that someone gives it away to sell something else with it.

But one word in it has changed meaning: **"reaches"**.

Back then it meant: the boekhouder gets the file. That puts you in competition with a shared
folder and an e-mail, and you lose that. Now it means: **it sits as a correct booking in the
package he works in.** That is a different promise, and it is exactly the promise
`snelstart-mapping.ts` delivers — provided the key arrives.

So: the idea survives, but with a different verb, and then it is no longer a chain but a
**proof**. What the shopkeeper cannot do and what costs his boekhouder hours is not *making* the
invoice. It is demonstrating that a period is correct while till, terminal and bank shout three
different numbers.

**And one figure you are probably reading wrong.** Cash was still 17% of point-of-sale payments
in 2025; 83% went by card [V, DNB/Betaalvereniging]. That looks like the end of a "cash"
positioning. It is the opposite: your triangle is a **card** triangle. Leg B — the commission —
exists only *because* people pay by card. Every euro that shifts from cash to card makes that
problem **bigger**.

**But with a hard precondition the first version of this document missed:** this only holds under
**net settlement**, where the acquirer deducts the commission from the payout. If the acquirer
settles gross and invoices the costs separately (your own code anticipates this with
`netCommissionToBook` and `ACQUIRER_VENDOR_RE`), then Leg B is zero and there is nothing to find.
So your market is not "card-heavy shops" but "card-heavy shops **on a net settlement contract**"
— an unknown subset of an already unknown set.

**And on the btw over that commission: the argument is weaker than the repo claims.** Two places
in your own code say "a real cost + reclaimable BTW" (`eft-parser.ts:12`,
`RECONCILIATION_TRIANGLE.md:12`), while line 55 of that same note says "commission has no BTW".
The tax picture: payment services are in principle btw-**exempt** (art. 11(1)(j) Wet OB) — no btw
to reclaim — but terminal rental is not, and a 2023 ruling held that purely technical and
administrative processing services fall outside the exemption [V]. So the answer depends on what
exactly appears on the acquirer invoice. **Lead your sales conversation with "your profit is
overstated", not with "you are leaving btw on the table"** — and work it out on one real acquirer
invoice before it goes into a pitch.

---

## 6. The routes — four, not three

### Route A — The daily close, sold to the office _(direction: good)_

**Customer.** The administratiekantoor with 10–40 retail and hospitality clients. The office
pays, not the shopkeeper.

**Promise.** "You get the daily statement delivered correct. Till, terminal settlement and bank
payout are set against each other, the commission is booked instead of tolerated away, and
whatever does not add up is on one exceptions list."

**What it actually demands** (the first version of this document was too rosy here):
- Breadth in the import: the EFT parser knows one acquirer format. Mplus, Lightspeed, CCV,
  Worldline and unTill have to be added.
- **You do need a bank file per client per month.** The first version wrote "no PSD2 needed";
  that is half true. `card-reconcile.ts` says itself that the net bank payout is optional — but
  without that line Leg B does not exist, and Leg B *is* the sales argument. At 40 clients that
  is 40 manual uploads a month. First find out whether SnelStart's own API returns bank
  transactions; then that witness is free. One afternoon in their documentation settles this.
  _(Since this was written, the Enable Banking connection makes this a live-data question rather
  than an upload question — re-decide it before building.)_
- Multi-tenant onboarding is **not a bullet point but a data-model change**:
  `accountant-access.ts` links per `zzper_id`, every shopkeeper needs their own account, and the
  maatwerk key applies per administratie. The payer is not the account holder.
- Two unanswered questions: may an administratie managed by an office issue a maatwerk key, and
  is Maatwerk/B2B in the inStap tier at all? If the answer is "from inKaart upwards", your
  solution first costs the shopkeeper a more expensive SnelStart subscription.

**Defensibility.** Reasonable — but not through intellectual property. Through dirty details
(settlement delay, DAT date from the bank description, commission attribution to the right day,
splitting per card scheme) and through something you sell nowhere: **the system would rather do
nothing than something untrue** (blocking on an unknown btw rate, `detect-file.ts`,
`import-health.ts`, write locks, a two-cent boundary). The office carries the liability. *That*
is the reason to buy. The real moat beyond that is disinterest: this segment is too small for a
large player's attention — a real moat and a poor compliment at once.

### Route B — Broad pre-processing for offices (the TriFact365 route) _(advise against)_

Requires Exact Online, then Twinfield and AFAS, plus an XAF 3.2 audit file and RGS mapping —
`grep` for `xaf`, `auditfile` and `rgs` returns **zero** hits in `src/`. _(Re-checked 14 Aug
2026: still zero.)_ Months of work before you are allowed to compete, against a price floor of
€ 2–3 [O], with no wave of dissatisfaction to ride.

### Route C — Cheap complete zzp package (the current course) _(advise against)_

Requires PSD2 (an AISP party, recurring costs), btw filing (Digipoort or fiscal service provider
status), a Peppol access point (ISO 27001 required in NL [O], entry price findable nowhere) and
English in the application itself. You are competing against six free tiers. Defensibility: zero.

_On the language part, re-checked 14 Aug 2026: `src/lib/i18n/` now carries a full translation
layer in nl/en/ar/tr reaching the dashboard, so "English exists only for the public tools and the
blog" no longer holds. The two specifics still do: `lang="nl"` is hard-coded in `layout.tsx:90`,
and `preferred_language` on `profiles` is read by no line of code — now by design, since the
locale lives in a cookie and deliberately not in a profiles column (`use-locale.ts:6`)._

### Route D — Route A, but as a service first _(the executable form — this was missing entirely)_

Sell the daily close as a **paid service** to 3–5 offices, with the code as your internal tooling.
Self-service only after that.

- No subscription billing needed: KvK, an invoice, an iban. Your product can already invoice.
- No multi-tenant onboarding needed.
- **No subscription key needed to start** — an export file is enough. That removes your single
  largest dependency from the critical path, and turns the SnelStart connection into a margin
  improvement instead of a blocker.
- The "every shop is bespoke" risk flips from cost to revenue: every new till/terminal you handle
  by hand is a client paying while you write the parser.
- It produces the one missing number: what a daily close actually costs, and what an office is
  willing to pay for it.

Yes, this is consultancy and it scales badly. That is not the failure mode — **it is the cheapest
way to find out whether the product exists.**

### Route E — License the engine _(worth at least one phone call)_

TriFact365, Zenvoices, a till vendor, an acquirer, or SnelStart itself. They have distribution
and no understanding of cash/PIN; you have the reverse. If the segment is small enough not to
attract their attention, it is also small enough to license rather than rebuild. It is the only
route whose outcome does not depend on your sales ability as a one-person business.

---

## 7. Recommendation

**Direction A, form D, with E as a parallel phone call.**

Not because the market is large — it is small and nobody knows how small — but because it is the
only direction where what is built is a *lead* instead of a deficit.

Rename the product in your own head from "accounting for small entrepreneurs" to **"daily close
for card-driven businesses, delivered to their office"**. Do not sell to shopkeepers, sell to
offices. And do **not** price per administratie: € 2–5 per administratie is a conversation you do
not win. Test € 150 per office per month, or per location like the international players — that
is the same amount and a far easier conversation.

**The objections, and I cannot remove them:**

1. I am recommending the one route whose market **cannot be measured**. The number of card-heavy
   micro businesses *with* an external boekhouder, *without* an integrable till, *on* a net
   settlement contract has been established nowhere. Route C has a measurable market of 1.2–1.8
   million — and in it you demonstrably lose. I am choosing an unmeasurable market over a
   measurable loss. Anyone who says that is not a gamble is lying.
2. The file contradicts itself about who chooses the software: 16% via the boekhouder versus
   49.3% via the entrepreneur's own Google research [O], while another track claims exactly the
   reverse. The entire channel strategy hangs on this. My hunch — service zzp'ers google,
   shopkeepers with a shoebox follow their office — is reasoning, not a finding.
3. **The biggest missing assumption is you.** The git history shows one human author (`mofwim`,
   80 commits) alongside AI assistance (131 commits). _(Unverifiable in the current working copy
   — see the re-verification block.)_ Nowhere in this entire study is it written how much time
   you have, whether you have an income, and how long you can go without revenue. "First paying
   office in 3–6 months" (more realistically 6–9: offices do not decide during aangifte season)
   is undecidable without those two numbers. And run the outcome bare: 10 offices × 25
   administraties × € 4 = **€ 1,000 per month, after 12–18 months**.

---

## 8. Stop points — measurable, in order

| # | Within | Observation | If this happens |
|---|---|---|---|
| **0** ✅ | — | ~~**No legal entity.** `/voorwaarden` and `/privacy` are live with `[JOUW NAAM]` and `KVK-nummer [INVULLEN]`~~ **RESOLVED in code, 14 Aug 2026.** The legal identity renders from `NEXT_PUBLIC_COMPANY_*` with unfinished-by-design fallbacks, guarded by `company.test.ts`. **What remains is not code:** register with the KvK and set the five env vars in Vercel. No office signs a verwerkersovereenkomst without a real entity; Stripe/Mollie KYC asks for a KvK number; art. 3:15d BW requires identification | Still blocks **all** routes until the KvK registration exists. Costs an afternoon. Do this first |
| **0b** ✅ | — | ~~**The published price list contradicts the strategy.** Terms §5.1 quotes Pro € 25 and Pro+ € 45 "including bank connection (PSD2 — coming soon)"; the database knows a different four-tier model~~ **RESOLVED, 14 Aug 2026.** Terms §5.1 now reads Gratis € 0 / Plus € 12,99 / Boekhouder € 0, no PSD2 promise in any legal document, and `database.sql:436` matches at `free/plus/boekhouder` | Nothing to do. Re-check if the pricing changes again |
| **1** | 30 days | **One euro invoiced and received by hand.** Not: a working Stripe integration. Stripe comes after client 3 | Without this everything is theory — but do not build billing before client 1 |
| **2** | 30 days | **Is the problem felt?** Speak to 10 offices with retail/hospitality clients: how many hours per quarter does such a daily close cost, and who pays those hours? Fewer than 3 out of 10 call it a recurring cost | Route A lapses. The gap exists technically, not economically |
| **3** | 30 days | **Subscription key requested *and* granted** for this use | If not: route A runs on export, integration goes back to being a nice-to-have |
| **4** | 60 days | **Net or gross?** Of 10 shops: how many are on a net settlement contract? | Under 5: Leg B is not a product |
| **5** | 60 days | **Is there money in it?** Work out across 10 administraties how much commission went unbooked. Median under ± € 250/year. Separately: *is* that commission btw-taxed? | Without an amount it is a technical nicety, not a reason to buy |
| **6** | 60 days | **Bespoke-import hell.** Collect 10 real Z-reports and 10 terminal settlements from 10 businesses. Fewer than 6 parse without new code — and count the OCR failures separately | Then this is a service (route D), not a product. That is a choice, not a disaster |
| **7** | 90 days | **Is it already solved?** 3 or more of the 10 offices say "our till integration already does that". Also call Lightspeed/Mplus/unTill: do they include the **acquirer settlement**? | The differentiator does not exist. Back to the drawing board, not to more building |
| **8** | 90 days | **Price test.** No office at all will commit to ≥ € 150/month (or ≥ € 5/administratie) | At € 2–3 with a manual sales motion the arithmetic does not close |

---

## 9. Channels nobody mentioned

- **NOAB / SRA / Fiscount.** Umbrella bodies for administration and tax advisory offices, with
  newsletters, meetings and software preferences. **One meeting is more office contact than a
  year of SEO** — and it is the cheapest way to execute stop point 2.
- **The acquirer and the till vendor.** CCV, Worldline, Rabo SmartPin, SumUp and the till builders
  have the list of "card-heavy, no integrable till" and already sell to your target group, without
  an accounting product. You call this a distribution problem yourself and then named not a single
  distribution partner.
- **The long tail of the *buyer*, not the user.** Your knowledge base aims at "boekhoudpakket zzp"
  — held by affiliates. Your buyer's search terms are "pinomzet klopt niet met kassa",
  "afrekening Worldline boeken", "acquirerkosten boeken btw", "dagstaat horeca boeken",
  "kasverschil verklaren Belastingdienst". That is long tail nobody monetises, searched *by* a
  boekhouder *with* the problem. That is a real channel, and the only cheap one you have.

---

## 10. Costs that appeared in no scenario

Claude API per document (`ai.ts` runs on Haiku 4.5; EFT receipts go through transcription) — at
€ 2–5 per administratie that eats the margin as soon as a shop delivers 200+ documents a month.
Seven years of retention as your privacy statement promises — storage that keeps running after
cancellation, per client, *and* legally debatable because the fiscal retention duty rests on the
entrepreneur, not on you. Supabase, Vercel, Resend, Sentry, the domain. Liability insurance: you
write bookings into a third party's administratie and your terms cap liability at € 1,000 — an
office will not accept that without a conversation. Plus the paperwork you have even without
AISP/Digipoort/ISO: a verwerkersovereenkomst as the office's sub-processor, the question "do our
client records go to an American AI model?" (you will get that in *every* conversation), and a
security questionnaire at larger offices.

---

## 11. What we do not know

**Errors that were in the first version of this study and are corrected here:** that the SnelStart
connection is live (no — it waits on a key), that no billing code or price list exists (there *is*
a published price list and a `subscription_stripe_id` in the data model), that the commission
carries reclaimable btw (probably not, and the repo contradicts itself), that route A needs no
bank line (it does, for Leg B), and that "no party does this" (internationally the category does
exist).

**What the research explicitly did not find:** market shares, paying-customer counts, churn, ARPU
or CAC for NL accounting software (these do not exist publicly). The price of reseller or
white-label access to a Peppol access point. The size of the card/cash-heavy micro segment.
Whether offices pass software costs on and at what margin. A current official Basecone price. The
decision lead time for software at a small office. Any willingness to pay for language as such —
no research, no data, no price premium.

**Internal contradictions nobody resolved:** the number of zzp'ers (1.167m CBS main job Q4-2025 /
"nearly 1.5m" CBS Q1-2026 / 1.805m KVK 30-6-2026 — three counts, three definitions); whether the
entrepreneur or the boekhouder chooses; and whether e-Boekhouden's daily-revenue screen exists
(the claim that would kill your niche came back unconfirmed — open a trial account yourself).

**One thing you must never put in a pitch:** there is **no** Dutch e-invoicing mandate date.
Several high-ranking blogs present 1-1-2027 and 1-1-2028 as Dutch law; those are German dates.
(There is a free opportunity in that: one accurate, dated, sourced page in a market where the
existing content is demonstrably wrong.)

### The three questions only a conversation answers

1. **To an office with retail clients:** how many hours per quarter go into such a client's daily
   close, and does the office absorb those hours or bill them on? This is the single number that
   sets your price and it is in no source.
2. **To that same office:** what do you do today when the PIN payout does not match the till? If
   the answer is "we put it on a suspense account and never look back", then the problem exists
   but there is no buyer.
3. **To ten shopkeepers:** who chose your software — you or your boekhouder?

---

**Bottom line.** You asked where BoekBrug stands. Answer: as a generic accounting package you
stand nowhere, and there is no way back in that direction. As the supplier of one demonstrably
correct daily close you stand on something no Dutch competitor has — proven on one shop, not yet
sold to a single client, built by one person, with no legal entity underneath it. That is not a
big company and it is not a failure either. It is a hypothesis that is ten phone calls and one
afternoon of registration away from "true" or "false" — and there is no reason at all to keep
postponing those ten conversations for more code.
