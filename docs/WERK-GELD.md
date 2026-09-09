# WERK-GELD — the product thesis, and the principles the code is held to

Written 8 September 2026 after the consultant's reading of `docs/MARKT.md` and the work layer.
This is the sentence the team builds against, and the rules that decide what gets built.

## The thesis

> Niet nóg een boekhoudpakket. Niet nóg een branchepakket.
> De brug tussen wat je doet en wat je eraan verdient.

> BoekBrug verbindt Werk en Geld. Het begrijpt hoe een ondernemer werkt, koppelt elk stuk werk aan
> omzet en kosten, en maakt de administratie automatisch klaar voor de ondernemer én de accountant.

```
                    BOEKBRUG
                       │
        ┌──────────────┴──────────────┐
      WERK                          GELD
  "Wat doe ik?"               "Wat verdien ik?"
  work_item                   facturen · inkoop · bank
  (werkorder, rit, klus,      btw · betalingen
   opdracht, reparatie, les)
        └──────────────┬──────────────┘
                     MARGE
                       ↓
                     ACTIE
                       ↓
                  ACCOUNTANT
```

The market has the left half (garage, transport, schoonmaak tools) and the right half (every
boekhoudpakket). The hand-off between them is a PDF, an export, a re-keyed invoice. BoekBrug is the
bridge; there is no hand-off.

## One primitive

`work_items` is one table with one screen and one API (`src/lib/werk.ts`, `/dashboard/werk`,
`/api/werk`). A werkorder, a rit, a klus, an opdracht, a reparatie and a leerling's opleiding are
the same thing to BoekBrug: *een stuk werk dat geld oplevert en kosten veroorzaakt*. What differs
per trade is data in one file — the noun, the fields, the statuses and their words, the line kinds
and the btw rate each starts on, whether it repeats, whether it opens on a kenteken. A new trade
is a skin, never a second engine; the rijschool (added the same day the thesis was written) proved
it: one skin, one VAKKEN entry, no new table.

## The three primitives that make the layer more than a CRM

1. **Werk → Factuur.** Finished work becomes a draft in one tap, through the one draft door
   (`/api/werk/[id]/factuur`, `/api/werk/factuur` for several pieces of one client's work).
2. **Werk → Kosten.** Hours, purchase invoices and a bon photographed inside the work attach to
   it (`/api/werk/[id]`, actions `attach_*`, `visit`).
3. **Werk → Marge.** Revenue minus the attached costs, with the hours beside it and the agreed
   hours against the hours spent (`workMargin`, `hoursBudget`).

The [WERK] gate in `lifecycle-gates.test.ts` holds all three: the doors, the stamping, the
rollback, the scoping. Losing one of them turns the layer back into a card index.

## The financial context of a piece of work

```
Omzet
- Arbeid
- Materiaal
- Inkoop
- Overige kosten
----------------
Marge
```

Today the engine knows revenue (the invoice, or the lines until there is one), attached
purchases, and hours. The per-trade breakdown (garage: arbeid + onderdelen; bouw: uren +
materiaal + onderaannemer; transport: brandstof + tol + uren; rijschool: instructeur +
brandstof + voertuigkosten) is the next step on the same numbers, not a new engine: the
attached purchase invoices already carry a category, and the lines carry a kind.

## Product principles

- **Time is understood; planning is not built.** A schoonmaak opdracht repeats and its beurten are
  ticked off; a rit has a laadtijd and lostijd; a werkorder waits for a part. None of that is a
  planning board, a crew roster or a dispatch screen. The distinction: the app knows WHEN work
  happens because money follows from it; it never schedules people.
- **The trade decides which financial rules are relevant.** Repair labour 9%, a part 21%;
  personenvervoer 9%, goederen 21%; schoonmaak in a home 9%; bouw verlegd; the examen as a
  doorlopende post. This is a domain guard, not a setting — it is what a generic package cannot
  give.
- **The app learns the owner's way.** "Regels van vorige keer" and the owner's own price list as
  suggestions on a line: the second werkorder for a client is the first one, re-offered.
- **The accountant is in the loop, not at the end of it.** The quarter says what is complete and
  what is missing (`/dashboard/klaar`, `/dashboard/jaar`); the office decides across clients
  (`[KANTOOR-BESLUIT]`). The competitor says "hier is je export"; BoekBrug says "je kwartaal is
  klaar voor je accountant".
- **Every feature must reduce administration, prevent financial leakage, or improve visibility of
  margin.** If it does none of the three, it is not built. The minimum that lets a small owner
  finish the day from one app — never the feature list of the incumbents.

## Core versus vertical — the line the consultant drew after the four visions

| | Core (one engine) | Vertical (experience) |
|---|---|---|
| Customer | klant, adressen, btw, betaalcondities, historie | voertuigen (garage), locaties (schoonmaak), leerlingen (rijschool) |
| Work item | create, status, revenue, hours, costs, documents, invoice, payment, margin, financieel gereed | the noun, the fields, the statuses and their words, the workflow |
| Hours | hour → work item → revenue/cost | how they are written and shown |
| Costs | supplier, amount, btw, date, document, category, work item, matching | what a cost *means*: materiaal, onderdelen, brandstof |
| Invoice, bank, payment | one engine, Work item → Invoice, never re-typed | "Maak factuur" in the trade's words |
| btw | rates, calculation, quarter, corrections, audit | the guard: verlegd, personenvervoer, margeregeling, doorlopende post |
| Financieel gereed | one checklist, one state (`financialReadiness`) | which lines count |
| Margin | revenue − attributable costs, with its trust: werkelijk / geschat / incompleet | what "winstgevend" means in this trade |
| Documents / OCR | bon → structured data | the contextual guess: "waarschijnlijk brandstof voor voertuig 03" |
| AI | Detect → Explain → Recommend → Act | the signals per trade |

Never in Core, even when a vertical wants it: planning engine, routes, payroll, HR, inventory,
warehouse, fleet management, full CRM, project management, scheduling, customer portal, driver
app. Those run the operation; BoekBrug runs the relation between the operation and the money.

**Financial Context.** Some trades do not measure profit on one piece of work: schoonmaak
measures a contract on a location, a garage a car over its visits, a rijschool a leerling over
a pakket. The shape to grow into is `Customer → Context (optional) → Work Item → Financial
Events`. Today the garage has it (history and margin per vehicle); the contract-with-locaties
for schoonmaak is the next context to build, as a parent of work items, not a contract system.

**Build order.** Core first and proven on bouw (klus → marge: hours, materials, costs, revenue,
meerwerk, invoice, margin), then garage tests the context entity (voertuig), schoonmaak tests
the recurring context (contract + locatie), transport tests high-frequency financial events
(rit + brandstof + tol + self-billing). Rijschool stays #5: it is one skin today and proves the
primitive, but its margin only means something once the operational data is there.

**[CONTRACT] — the first Financial Context, built on the row.** Contract + Locatie for
schoonmaak (and the hovenier's onderhoudsabonnement) is not a second table: a recurring opdracht
already carries the locatie, the rhythm, the afgesproken uren and the beurten. What was added: a
fixed `maandbedrag` that makes the row a contract billed per period (one line, the fee, the month
named, once, under a lock; the beurten of that month are covered by it), an `einddatum` with a
sixty-day renewal signal on Vandaag, and the "Contracten" overview: per client its locations, this
month's revenue, purchases, margin (marked geschat — without a kostprijs per hour it is revenue
minus purchases, and the owner prices as he wishes), the hours against the agreed ones, and the
period's invoice offered or marked done. A client with three locations is three rows and one
name; that is the Customer → Context → Work Item shape without a contract system.

**What [WERK-4] added to Core the same day:** `financialReadiness` (the checklist before the
button, the button follows it), the margin's trust label, `begroot` on a klus and a werkorder
measured while the work runs, and the Vandaag signals: meerwerk not invoiced, hours without a
rate, a known supplier's bon on no work, work over its begroting.

## Rijschool: the easy vertical, entered from the money side

The consultant's business case (Rijschooldata 2025: 7.041 active B-praktijk schools, a long tail
of one-car businesses; PlanGo, RijSys, RijscholenApp and DriveFlow selling planning + leerling
apps + facturatie at € 25–50 a month) settles how BoekBrug enters: **not** as rijschoolsoftware.
Planning, the leerling app and the CBR koppeling are the incumbents' half and stay theirs. The
BoekBrug half is *van les naar marge*: what a leerling, a pakket, an instructeur and a lesauto
actually earn. The skin built today is exactly that and nothing more — the leerling is the work,
every les a beurt, the pakket and the examen its lines, the lesauto a vehicle with an APK, the
margin the same arithmetic as a werkorder's. It is vertical #5 by market size and #1 by fit; it
was built first only because it cost one skin, and it proves the primitive.

## What is deliberately not built (yet)

A planning engine or crew screens; a werkbon PDF with a digital signature; termijnfacturen on one
piece of work; a fixed monthly contract beside the beurten; a salon agenda; the WERK / GELD split
of the navigation (the bar holds five destinations, and Vandaag already leads with the work's
count and amount). Each is a size decision to take after the first real customers of a trade.
