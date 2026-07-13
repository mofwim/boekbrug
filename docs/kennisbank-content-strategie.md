# BoekBrug Kennisbank — Content & Conversie Strategie

_The blueprint for the `/blog` information portal: how it attracts visitors from search,
earns their trust, and turns them into BoekBrug users. Every claim in this plan is grounded
in features that ship **today** — nothing on the roadmap._

> Status: v1 (2026-07). Owner: content/marketing. Companion to the shipped `/blog` system
> (`src/lib/blog.ts`, `src/components/blog/*`, `content/blog/{nl,en}/`).

---

## 1. The conversion thesis

The visitor is an **anxious ZZP'er** (or a bookkeeper's client) typing a worried question into
Google at 22:00: _"hoeveel belasting betaal ik?"_, _"factuur maken zonder btw?"_, _"moet ik
mijn bonnetjes bewaren?"_. They are not looking for software. They are looking for **an answer
and reassurance**.

The portal wins by giving the best answer on the page — and, in the act of answering,
demonstrating that **BoekBrug already does this for them**. We never interrupt the answer to
sell; the product shows up as the obvious next step _because_ the article made the problem
concrete.

```
Search  →  Read (best answer wins)  →  Trust (we're credible & Dutch-correct)  →
Tool (do it now, free, no account)  →  Account (keep it all in one place)
```

Two levers do the convincing, and every article must pull on both:

1. **Capability** — "BoekBrug can do exactly this." Shown, not asserted (a concrete
   mini-walkthrough, a screenshot-worthy step, a linked free tool that _is_ the product).
2. **Reliability** — "BoekBrug is safe to trust with my money and my data." Dutch rules,
   AVG, works _with_ your bookkeeper, honest disclaimers, verified numbers.

---

## 2. What we may honestly promise (capability inventory — ground truth)

This is the **only** list of product claims allowed in articles. Sourced from the shipped
codebase (routes in `src/app/dashboard/*` and `src/app/api/*`). If it isn't here, we don't
promise it.

| Capability (shipped) | Where it lives | Proof point we may cite in content |
| --- | --- | --- |
| **Facturen maken** — Dutch-compliant invoices, PDF | `dashboard/facturen`, `factuur-maken` tool, `api/invoice/*` | "Maak een factuur die aan de Nederlandse eisen voldoet en download hem als PDF." |
| **Factuur versturen** per e-mail | `api/invoice/send` (Resend) | "Verstuur de factuur direct vanuit BoekBrug." |
| **Creditnota & nummering** | `api/invoice/creditnota`, `api/invoice/numbering` | "Automatische, doorlopende factuurnummers; creditnota's in één klik." |
| **UBL / e-factuur export** | `api/export/ubl` | "Exporteer als UBL (e-factuur) voor je boekhouder of overheidsopdrachten." |
| **Factuur scannen met AI** — foto/PDF → leverancier, bedrag, BTW | `factuur-scannen` tool, `api/classify`, `lib/ai.ts` (Claude) | "Upload een bonnetje; de AI leest leverancier, bedrag en BTW uit." |
| **Inkomende facturen** beheren | `dashboard/incoming`, `api/incoming/check-paid` | "Hou je inkomende facturen en wat je nog moet betalen bij." |
| **BTW per kwartaal** — omzet/BTW opgeteld | `dashboard/quarterly`, `dashboard/resultaat` | "Je omzet en BTW worden per kwartaal opgeteld — je aangifte is zo klaar." |
| **Jaarafsluiting (closing package)** | `api/closing-package` | "Een compleet pakket voor je boekhouder aan het eind van het jaar." |
| **Bankimport + automatische matching** | `dashboard/bank`, `api/bank/upload`, `api/bank/match` | "Upload je bankafschrift; BoekBrug matcht betalingen aan je facturen." |
| **Kas** (cash) | `dashboard/kas`, `api/cash` | "Registreer contante ontvangsten en uitgaven." |
| **Bestanden + AI-classificatie** | `dashboard/bestanden`, `api/bestanden/classify` | "Al je documenten op één plek, automatisch geordend." |
| **E-mail intake (Gmail/Outlook)** | `api/email/connect`, `.../sync` | "Koppel je mailbox; facturen uit je inbox komen automatisch binnen." |
| **De Brug — samenwerken met je boekhouder** | `dashboard/brug`, `dashboard/accountant`, `api/accountant/*`, `dashboard/messages` | "Deel facturen en documenten met je boekhouder; geen mappen vol PDF's mailen." |
| **Jouw data is van jou (AVG)** | `api/account/export`, `api/account/delete` | "Exporteer of verwijder al je data wanneer je wilt. AVG-proof." |

**7 free, no-account tools** (top-of-funnel magnets, each an article's natural CTA):
`factuur-maken` · `factuur-scannen` · `btw-berekenen` · `btw-aangifte-berekenen` ·
`netto-inkomen-zzp` · `uurtarief-berekenen` · `kilometervergoeding`.

---

## 3. The reliability framework (the trust layer)

Trust is not a paragraph; it's a pattern repeated across every article. Four recurring
signals, each tied to something real:

1. **Dutch-correct.** We reference actual rules (factuureisen, urencriterium, BTW-tarieven)
   and keep numbers current. Invoices from the tool genuinely meet Dutch requirements.
2. **Honest by default.** Calculators say _"het is een schatting, geen belastingadvies."_
   Admitting limits is the strongest trust signal a finance brand has — we lean into it.
3. **With your bookkeeper, not instead of.** "De brug tussen jou en je boekhouder" is the
   positioning. Content never tells people to fire their accountant; it makes the
   hand-off smoother (UBL, closing package, De Brug, shared documents).
4. **Your data is yours.** AVG-proof, cookieless analytics, one-click export & delete.
   Say it wherever data/privacy is remotely relevant.

**Editorial guardrail (accuracy discipline):** every tax/legal figure in an article must be
verified against an authoritative source (Belastingdienst / KVK) before `draft: false`, and
must reconcile with the live tool it links to. The reference article already models this
(the `# VERIFIED` note in its frontmatter). No invented numbers, ever.

---

## 4. The SEO architecture — topic clusters

We build **pillar + cluster** hubs, not scattered posts. One broad "pillar" page targets the
head term and links down to focused "supporting" articles targeting long-tail questions; each
supporting article links back up. This concentrates topical authority and internal-link
equity where the search volume is.

Each article is scored on: **target keyword · search intent · funnel stage
(TOFU/MOFU/BOFU) · mapped free tool · capability it showcases · trust angle.**

### Cluster A — Belasting & inkomen (highest anxiety, highest volume)
Pillar: **"ZZP belasting 2026: welke belasting betaal je en hoeveel?"** → `netto-inkomen-zzp`

| Article | Keyword | Intent · Stage | Tool | Capability shown | Trust angle |
| --- | --- | --- | --- | --- | --- |
| Netto inkomen ZZP 2026 _(SHIPPED)_ | netto inkomen zzp | informational · MOFU | netto-inkomen-zzp | resultaat/kwartaal overzicht | "schatting, geen advies" |
| Zelfstandigenaftrek 2026 uitgelegd | zelfstandigenaftrek 2026 | informational · TOFU | netto-inkomen-zzp | winst & aftrek in overzicht | urencriterium correct |
| Hoeveel reserveren voor de belasting? | belasting reserveren zzp | how-to · MOFU | netto-inkomen-zzp | resultaat/kwartaal | realistische vuistregels |
| Voorlopige aanslag ZZP: hoe werkt het? | voorlopige aanslag zzp | informational · TOFU | netto-inkomen-zzp | kwartaaloverzicht | Belastingdienst-correct |

### Cluster B — Facturen (highest commercial intent → strongest product tie)
Pillar: **"Factuur maken als ZZP'er: de complete gids (met eisen 2026)"** → `factuur-maken`

| Article | Keyword | Intent · Stage | Tool | Capability shown | Trust angle |
| --- | --- | --- | --- | --- | --- |
| Waar moet een factuur aan voldoen? | factuureisen | informational · MOFU | factuur-maken | Dutch-compliant invoice | wettelijke eisen |
| Factuur zonder btw (KOR / vrijgesteld) | factuur zonder btw | how-to · MOFU | factuur-maken | BTW-instellingen | correcte KOR-uitleg |
| Bonnetjes en inkoopfacturen bijhouden | bonnetjes bewaren zzp | how-to · BOFU | factuur-scannen | AI-scan + bestanden | 7-jaar bewaarplicht |
| Creditnota maken: wanneer en hoe | creditnota maken | how-to · BOFU | factuur-maken | creditnota in 1 klik | juiste nummering |
| E-factureren (UBL): wat betekent het? | e-factuur ubl | informational · BOFU | — | UBL-export | overheids-/EU-standaard |

### Cluster C — BTW
Pillar: **"BTW voor ZZP'ers: aangifte, tarieven en teruggave"** → `btw-aangifte-berekenen`

| Article | Keyword | Intent · Stage | Tool | Capability shown | Trust angle |
| --- | --- | --- | --- | --- | --- |
| BTW-aangifte doen: stap voor stap | btw aangifte doen | how-to · MOFU | btw-aangifte-berekenen | kwartaal BTW opgeteld | Belastingdienst-flow |
| Voorbelasting: welke btw krijg je terug? | voorbelasting terugvragen | informational · MOFU | btw-aangifte-berekenen | bank-match + inkoop | juiste aftrekregels |
| KOR: kleineondernemersregeling uitgelegd | kleineondernemersregeling | informational · TOFU | btw-berekenen | BTW-instellingen | drempels correct |
| 21% of 9%? Welk btw-tarief geldt? | btw tarief 9 of 21 | informational · TOFU | btw-berekenen | factuur BTW-keuze | tarieven correct |

### Cluster D — Administratie & je boekhouder (the differentiator)
Pillar: **"Boekhouding bijhouden als ZZP'er (zonder gedoe)"** → account signup

| Article | Keyword | Intent · Stage | Tool | Capability shown | Trust angle |
| --- | --- | --- | --- | --- | --- |
| Boekhouding zelf doen of uitbesteden? | boekhouding zzp | commercial · BOFU | — | De Brug (samenwerken) | "mét je boekhouder" |
| Bankafschrift koppelen aan je administratie | bankafschrift boekhouding | how-to · BOFU | — | bankimport + matching | jouw data blijft van jou |
| Wat heeft je boekhouder van je nodig? | boekhouder aanleveren | how-to · BOFU | — | closing package + UBL | soepele hand-off |
| Administratie bewaarplicht: 7 jaar | administratie bewaren | informational · MOFU | factuur-scannen | bestanden + AI-order | wettelijke bewaarplicht |

### Cluster E — Starten als ZZP'er (broad TOFU, feeds all clusters)
Pillar: **"ZZP starten in Nederland: de startersgids"** → account signup

| Article | Keyword | Intent · Stage | Tool | Capability shown | Trust angle |
| --- | --- | --- | --- | --- | --- |
| Wat kost een ZZP'er? / uurtarief bepalen | zzp uurtarief berekenen | how-to · MOFU | uurtarief-berekenen | tarief → factuur | realistische opslagen |
| Kilometervergoeding & reiskosten 2026 | kilometervergoeding 2026 | informational · TOFU | kilometervergoeding | kosten in resultaat | tarief 2026 correct |
| Eerste factuur als starter: checklist | eerste factuur zzp | how-to · BOFU | factuur-maken | maken + versturen | factuureisen |

### Cluster F — Expats (EN mirror, high-value niche)
Pillar: **"Freelancing in the Netherlands: tax, invoices & admin"** → tools + signup
- Net income (SHIPPED, EN) · How Dutch VAT works for freelancers · Sending a compliant
  Dutch invoice in English · Working with a Dutch bookkeeper as an expat.
- Only mirror the highest-intent NL articles; do **not** translate everything.

---

## 5. Article anatomy (every post follows this)

1. **Answer-first opening** — resolve the search query in the first 2–3 sentences. No throat-clearing.
2. **Genuinely useful body** — steps, tables, a worked example, real numbers. Earn the read.
3. **One natural capability moment** — a short, honest "in BoekBrug gaat dit zo…" beat where
   the article's problem meets the product. One, not five. Never a hard sell.
4. **ToolCTA** (already built) — the mapped free tool (primary) + free account (secondary).
5. **Trust footer** — the relevant reliability signal (disclaimer / AVG / works-with-bookkeeper).
6. **Internal links** — up to the pillar, sideways to 1–2 sibling articles, out to the tool.

Structural SEO (already handled by the shipped system): SSG, full metadata, JSON-LD `Article`,
canonical, hreflang, sitemap, `rehype-slug` anchors, reading time. Writers only supply
frontmatter + Markdown.

---

## 6. Editorial roadmap (prioritized by demand × product-fit)

**Phase 1 — prove the model (next 6 articles).** Highest search volume with the tightest tool
tie-in, so we can measure Search → Tool → Account fast:
1. Zelfstandigenaftrek 2026 (Cluster A) — rides 2026 anxiety, links netto tool.
2. Waar moet een factuur aan voldoen? (Cluster B) — commercial intent, factuur-maken.
3. BTW-aangifte doen: stap voor stap (Cluster C) — evergreen, high volume.
4. Boekhouding zelf doen of uitbesteden? (Cluster D) — BOFU, showcases De Brug.
5. ZZP uurtarief berekenen (Cluster E) — feeds tool + factuur cross-link.
6. Bonnetjes bewaren / factuur scannen (Cluster B/D) — showcases the AI scan differentiator.

**Phase 2 — build the pillars.** Write the 5 NL pillar pages and wire the Phase-1 posts into
them as clusters. Add the 2 highest-value EN mirrors.

**Phase 3 — fill the long tail.** Remaining cluster articles, quarterly refresh of any
year-stamped numbers (2026 → 2027), and a light "updatedAt" review cadence.

**Cadence:** 1–2 articles/week is enough; consistency and correctness beat volume. NL first;
EN only where expat search intent is real.

---

## 7. Measurement & guardrails

**Funnel metrics (the only ones that matter):**
`organic sessions → tool interactions → account signups`. Each article links exactly one tool,
so attribution stays clean. Track per-cluster which topics actually convert and double down.

**Non-negotiable guardrails:**
- **Only shipped features** (Section 2). No roadmap, no "coming soon."
- **Verified numbers** before `draft: false`; reconcile with the linked tool.
- **Disclaimers** on all tax/finance content ("schatting, geen belastingadvies").
- **NL is primary**; EN is a deliberate subset.
- **One CTA, one tool** per article — clarity converts better than a menu.
- **Never overpromise reliability** — if a capability has limits, say so; the honesty _is_ the
  conversion strategy.

---

_This document is the portal's architecture. Approve/adjust the Phase-1 list and I'll write
those articles next, each following Section 5 and passing the Section 3 accuracy discipline._
