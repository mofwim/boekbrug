# BLUEPRINT — the owner's Product Blueprint v1, checked against the code

Written 8 September 2026, the day the owner sent the four-vertical blueprint (Core → Bouw →
Garage → Schoonmaak → Transport, phases 0–5). This is not a second blueprint. It is the same one
with one column added: what of it already exists in this repository, with the file that proves
it. Read with `docs/BRUG.md` (the loop) and `docs/ZIEL.md` (the equation).

## Phase 1 "Core MVP, 8–12 weeks" — already built

Every item on the blueprint's Core list exists and is in production:

| Blueprint item | In the code |
|---|---|
| Auth, Company, Users | `src/app/register`, `src/app/dashboard/settings`, `company_members_sales_role.sql` (role `verkoop`) |
| Customers, Contacts | `clients` (`database.sql`); contact fields live on the client row, there is no separate contacts table |
| Documents | `documents`, `/dashboard/bestanden`, byte-hash and semantic duplicate guards |
| Invoices | draft/send/PDF/UBL/numbering lock/creditnota/reminders/offerte with akkoord token (`offerte_akkoord.sql`) |
| Expenses | incoming invoices and receipts through three doors (`/api/intake`, e-mail sync, upload) |
| Bank import, Payments | MT940/CAMT/CSV, matching, multi-invoice, partial, unlink with redo guard |
| BTW | `src/lib/aangifte.ts` (rubrieken, verlegd, ICP, kasstelsel), `/dashboard/aangifte` |
| Accountant access | mandate, amount guard, office board, closing package, share link |
| AI document extraction | `src/lib/ai.ts` with grounding, statement/reminder/tax-letter guards |
| Notifications | `notifications` + push + digest mail |
| Universal search | `/dashboard/zoeken` over invoices, documents, clients, bank, kas |
| Activity timeline | `audit_logs` (113 actions) and `/dashboard/logboek` |

What Core lacks is not on the blueprint's list: the conversation state and the period state
(`docs/BRUG.md`, batches [VRAAG] and [PERIODE]). That is the Core work still open.

## The verticals — what each already has

| Vertical entity in the blueprint | Exists | Missing |
|---|---|---|
| Bouw · Uren | `time_entries` per client and day, hourly rate, marked invoiced (`invoice_id`) | no project on an hour |
| Bouw · Offerte → Factuur | offerte, akkoord, conversion to the same invoice | — |
| Bouw · Materiaal | receipts and supplier invoices read and settled | no link from a bon to a project |
| Bouw · Project, profitability, photos per project | — | the whole project entity |
| Garage · Voertuig | `vehicles`: kenteken, customer, APK expiry, APK urgency | kilometerstand, history |
| Garage · Werkorder, onderdelen, status, klantakkoord | — | the whole werkorder entity (akkoord exists only on an offerte) |
| Schoonmaak · Terugkerende factuur | `invoice_schedules` repeats a sent invoice as a concept | — |
| Schoonmaak · Contract, locaties, medewerkers, gepland vs gewerkt | — | the whole contract entity; hours have no planned figure |
| Transport · Voertuig, factuur per rit | `vehicles`; price list rows per km/rit/wachttijd/laden | — |
| Transport · Opdracht, rit, chauffeur, stops, POD, marge per rit | — | the whole order/trip entity |

The sector layer as it stands today is thin and honest: `profiles.vak` from the front door,
`src/lib/vak-profile.ts` deciding the price-list proposal, the vehicles tile and whether the
Kassa leads the bar. It is a trade, not a workflow. The blueprint is right that a sector layer
that is only a theme is not worth having; it is also right that none of the four workflows should
be built before Phase 0 produces a number.

## One primitive under all four verticals

Read the four entity models side by side: Project, Werkorder, Contract, Opdracht are the same
thing with a different noun. Each is a piece of work for one client that hours, purchases,
documents and photos attach to, that has a status, and that becomes one invoice. Build it ONCE —
one table `work_items` with a sector label and sector fields in JSON, one screen with the
sector's own word on it (Projecten, Werkplaats, Planning, Ritten) — and the "Werk" tab in the
blueprint's navigation is that screen. Four tables would be four products; the blueprint's own
warning.

What hangs off it later, per sector and only after validation: planned hours on a contract
(schoonmaak), a vehicle on a werkorder (garage), a per-trip margin from attached costs
(transport), profitability per project (bouw). The margin arithmetic is the same in all four.

## Navigation and Vandaag

The blueprint's bar — Home, Werk, Klanten, Geld, Documenten, Meer — does not exist. Today's bar
(`src/lib/nav-destinations.ts`) is shaped by money surfaces: Vandaag, Facturen or Kassa, Inkomend,
Bestanden, with home tiles for bank, kas, dagomzet, artikelen, uren. "Werk" is the work-item
screen above; the rest of the bar can stay until it exists.

Vandaag today (`vandaag.*` keys): attention list, unpaid, partial payments, offertes, reminders,
"N dingen wachten op jou", and what BoekBrug did itself this week. The blueprint's three blocks
(actie nodig / goed / inzicht) are a re-grouping of what is there plus two numbers Vandaag does
not yet show: the period's readiness percentage and the month's omzet/kosten/marge. Both are
computed elsewhere already (`readiness.ts`, `financial-result.ts`).

## Pricing

The blueprint's tiers (Solo, Business, Pro, sector modules) do not exist in code. What exists:
one owner subscription with a free first month (`[PROEFMAAND]`) and accountant practice pricing
(`src/lib/accountant-pricing.ts`). Willingness to pay is a Phase 0 question; nothing here should
move before it is answered.

## What to apply, and what not

Apply now:
1. Phase 0 exactly as written. All five doors are live (`/voor-bouw`, `/voor-garage`,
   `/voor-schoonmaak`, `/voor-transport`, plus `/voor-winkel` for the measured profile); signups
   per trade are in `profiles.vak`; visits per door are in Vercel analytics. Today: 9 accounts,
   none from a door.
2. The Core loop, while Phase 0 runs: [VRAAG] and [PERIODE] from `docs/BRUG.md`. They serve every
   vertical and wait on no interview.
3. After Phase 0: the single work-item primitive, with the winning sector's noun on it.

Do not apply, agreeing with the blueprint's own forbidden list: RDW, grossier, TMS, route
optimisation, planning, payroll, stock, a mobile app per sector, live integrations with
Exact/AFAS/Twinfield before the loop closes.
