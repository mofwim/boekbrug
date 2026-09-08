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
