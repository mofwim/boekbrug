# MARKT — what the trade-specific software market looks like, and what BoekBrug offers in it

Researched online on 8 September 2026 for the four chosen trades (bouw/installatie, garage,
schoonmaak, transport/koeriers) and for the generic "between owner and boekhouder" layers. Five
independent searches; every vendor site was fetched through a proxy that blocked most of them, so
prices come from search snippets and comparison sites and should be re-verified before they go on
a slide. "Not found" means not published in what was reachable.

## The pattern that repeats in all four trades

1. **The trade tools are sales-side only.** Werkorder, werkbon, planning, rit, contract — every
   package ends at the outgoing invoice, which it pushes to a boekhoudpakket. Purchase invoices
   (grossier, tankpas, schoonmaakmiddelen, materiaal) still arrive by e-mail and are scanned
   separately, often for an extra fee (e-Boekhouden scan & herken, Rompslomp €5,75).
2. **The hand-off to the accountant is still manual.** CleanPlanner and GlazenwasserApp SELL
   "all invoices in one PDF to your boekhouder" as a feature. Motira and GarageOS offer an export.
   Nobody closes a quarter.
3. **Two-rate btw is the trap of every trade** and only Informer (bouw, verlegd) markets a guard:
   bouw verlegd on subcontracting; schoonmaak 9% inside a home vs 21% offices/outside;
   transport 21% goods vs 9% persons vs 0% intra-EU; garage margeregeling on used cars.
4. **Hours and materials leak before the invoice.** OutSmart's own figure: service firms miss
   5–10% of billable revenue through unregistered hours and parts; paper werkbonnen take 3–14
   days to reach the office.
5. **Pricing anger is about per-document and per-user models.** Basecone "€250+/month",
   TriFact365/DizzyData/Kleisteen all sell "vaste prijs" against it; NOAB offices feel "gegijzeld";
   Track-POD prices per driver in USD. The evidence points to one flat price per administratie.
6. **The generic collaboration layers are tied to the office's engine** (Basecone → Twinfield/
   Exact, Yuki portal €405/month, Exact Mijn[Kantoor]). Yuki is the only one that attaches a
   question to the document; its owners still describe it as "a system that swallows documents".

## Per trade

### Bouw & installatie (zzp–10 fte)

| Product | Target | Price | Accounting side |
|---|---|---|---|
| Exact voor Bouw (Bouw7) | 10–250 fte | €129 / €229 / €359 | native Exact |
| Bouwportaal | zzp–klein | €45 + €5/user | Moneybird, SnelStart |
| OutSmart (werkbon) | 1–50 | ~€12,50/user + €5–10 per koppeling | Exact, AFAS, SnelStart, Moneybird, e-Boekhouden, Jortt |
| Simple-Simon | buitendienst | €24/user | Rompslomp, iMUIS |
| Informer | zzp/mkb, bouw page | €15 / €23 | automatic btw verlegd on outgoing |
| Moneybird / e-Boekhouden / Jortt / WeFact | generic | €3–41 / €9,95–24 / €0–34,95 / €6,50+ | boekhouder access |

Complaints found: hours app separate from the books and bridged by koppelingen that break on
master data ("klant onbekend, btw-tarief ontbreekt"); btw verlegd charged by mistake (naheffing,
boete up to €6.709); accountants asking for "een vaste aanleverdag"; ERP from €129 aimed at
10+ fte. Boekhouders for zzp bouw: €50–80/month.

BoekBrug offers: bonnen and inkoopfacturen read at no extra fee; hours on the invoice from one
place; verlegd guard on BOTH sides (a subcontractor invoice with btw, a sales invoice to a
hoofdaannemer without "btw verlegd" + btw-id); the quarter's missing list before the accountant
asks; the accountant's own login. Not: planning, werkbon UX for crews, calculatie/2BA, G-rekening,
payroll, the grootboek. Price band: zzp €15–25, 2–10 fte €39–79 flat with a free accountant seat.

### Garage & automotive (1–10 people)

| Product | Target | Price | Accounting side |
|---|---|---|---|
| Autoflex 10 | market leader, 2.000+ | not published; ~€100–200 + contract per competitor claims | Exact, SnelStart, Twinfield, AccountView, Unit4, Visma |
| Motira | small garages | €59/location, unlimited users | export only; live links roadmap Q4 2026 |
| GarageOS | small/medium | €59,99 | monthly export to Exact/Twinfield/SnelStart/Moneybird/e-Boekhouden |
| GarageManager | zzp/mobile | from €39 | live sync of SALES invoices to 7 packages |
| CSW MotoMate/AutomaaT GO | small | €49,50–53,55 | own automotive ledger or 9 links |
| Kivii, EsGarage, CarSys, WinCar, Autotaal | small–dealer | €15,95–modular | links or own module |

Complaints found: Autoflex cost, contracts and complexity; "te veel schermen"; every tool pushes
only sales invoices out while grossier invoices (Fource, PartsPoint, Brezan) arrive by mail;
margeregeling on used cars misunderstood even by veterans; kasboek for cash trade.

BoekBrug offers: grossier invoices read from the mailbox and matched to bank debits; both sides of
the bank matched (customer pin/iDEAL in, parts out); a quarter's missing list incl. cash sale
without kasboek entry; a clean hand-off with margeregeling flags; monthly cancellable, no modules.
Not: RDW/APK reminders, grossier ordering, werkplaats planning. Price band €19–39.

### Schoonmaak (1–30 medewerkers)

| Product | Target | Price | Accounting side |
|---|---|---|---|
| Appreo | workforce, cleaners app | €12,95–16,95 per medewerker | not found |
| Plan&Was | glazenwassers, 1–50 | per user, not published; SnelStart link €8,50 | e-Boekhouden, Exact, SnelStart, Twinfield |
| GlazenwasserApp | glas/schoonmaak | packages; API link €40/month | export / forward-mail to boekhouder |
| Schoonsoft, FacilityApps | ERP, mid/large | not published | links |
| Bouwportaal (schoonmakers) | small | €45 + €5/user | linked packages |
| Shiftbase / Werktijden | roosters | €4–5,50 per medewerker | payroll only |

Facts found: schoonmaken BINNEN woningen is 9% (also since 1 July 2025 only the woongedeelte of
mixed buildings), outside/offices/specialist work 21% — the app's trade table already says this
in its let_op. Complaints: contract hours vs worked hours re-typed, extra hours never billed,
cash from particulieren, cao urenregistratie burden, the hand-off still "one PDF to the boekhouder".

BoekBrug offers: a sent invoice repeated as a concept each period with last period's extra hours
attached; purchase side read itself; 9%/21% per line by location type; bank matching incl.
tikkie/cash from particulieren and unpaid abonnementen; a missing list the accountant sees too.
Not: roosters, ziekte, cao toeslagen, digital werkbon with signature, the grootboek. Price band
€25–45 flat per administratie, not per medewerker.

### Transport & koeriers (1–10 voertuigen)

| Product | Target | Price | Accounting side |
|---|---|---|---|
| EasyTrans | small koerier → distributor | fixed monthly, not published | Moneybird API, Exact |
| Transplan TMS | mid-size; advertises marge per rit | quote only | Exact Online |
| Track-POD | last mile, per driver | $49–89 per driver | API/Zapier, no NL ledger |
| RittenPlan | planners | €9,95/user | not found |
| RouteVision | GPS/rittenregistratie | from €3,75 (3 months) then quote | not found |
| Navitrans, NextUp, LogisticManager, Dashdoc | mid/large | quote only | Dynamics / not found |
| Boekhouden in Excel | eigen rijders | one-off templates | it IS what the accountant gets |

Facts found: small carriers pay €50–300/month for cloud TMS; many zzp koeriers still run Excel;
self-billing statements from PostNL/DHL/Uber/Deliveroo are revenue, "nooit een creditnota", and
the common error is booking them as a purchase; tankbon btw only reclaimable with a traceable
business card; 21% goods / 9% persons / 0% intra-EU; German Maut from 3,5 t since July 2024.

BoekBrug offers: self-billing statements read as omzet with btw in 1a (no TMS or ledger does
this); tankbon → kenteken → vehicle → btw, with private/cash bons refused; margin per trip from
the seeded tariff plus fuel, tol and lease matched from the bank, without a TMS; the 21/9/0 guard
on the price list per client; a closed quarter instead of a shoebox. Not: route planning,
dispatch, chauffeurs-app/POD, telematics/tacho. Price band €25–60 flat, optionally stepped per
vehicle count.

## The generic layers (between owner and boekhouder)

| Tool | Buyer | Price | Questions on the item? |
|---|---|---|---|
| Basecone (Wolters Kluwer) | office, min. 10 adm | €1/adm + €0,29/transaction, or €7,50/adm | not found |
| DizzyData | office or company | €2,50–7,50/adm (+ €149 portal, + €0,10/invoice) | no |
| Yuki (Visma) | office | portal €405/month | yes, attached to the document; Dutch only |
| Exact Mijn[Kantoor] | office | €0,35–0,50 per boekingsvoorstel out of bundle | no |
| SnelStart SamenOp | office | €47,50 + client €8,50–14,50 | notes |
| Kleisteen | office | €2,35–2,45/adm | portal |
| TriFact365 / Klippa / Dext / Hubdoc | office/company | €0,06–0,28 per document; Dext $17,70/client | no |
| Moneybird / e-Boekhouden / Jortt / Tellow / Rompslomp / Informer | owner | €0–66 flat | no |

None is sold per trade; Informer has a bouw page. What they do better today and BoekBrug must
match: intake breadth (one e-mail address per administratie, UBL, scanner), posting into the
office's ledger, and an office-wide portal of open questions and deadlines.

## What this means for BoekBrug

- The position is real and empty: a trade-aware preparation layer that reads BOTH sides, guards
  the trade's btw trap, and closes a quarter. No trade tool does the purchase side; no generic
  layer knows the trade.
- The thing to say per trade is the money leak, in the trade's own number: 5–10% unbilled hours
  (bouw), grossier invoices re-keyed (garage), 13 extra hours never invoiced (schoonmaak),
  self-billing booked as a cost (transport).
- One flat price per administratie, monthly cancellable, accountant seat free. The bands above
  overlap at €25–45 for a solo/small firm; that is the range to test in Phase 0.
- The loop batches in `docs/BRUG.md` ([VRAAG], [PERIODE]) are exactly the two things the
  incumbents lack or lock to their engine; they are the product, not a feature.

## Sources

Collected by the five searches; the full lists with URLs are in the session's research notes
and the main ones are: motira.nl, garageos.nl, garagemanager.nl, autoflex.nl, csw.nl, kivii.nl,
esgarage.nl, bouwportaal.nl, out-smart.com, informer.nl, exact.com/nl/producten/bouw, appwiki.nl,
appreo.nl, planwas.nl, glazenwasserapp.nl, schoonmakendnederland.nl, belastingdienst.nl
(schoonmaken in woningen, personenvervoer, verleggingsregeling), easytrans.nl, transplan.nl,
track-pod.com, fleetgo.nl, dashdoc.com, boekhoudeninexcel.nl, jortt.nl (self-billing),
wolterskluwer.com (Basecone), dizzydata.nl, yukisoftware.com, kleisteen.nl, trifact365.com,
accountancyvanmorgen.nl (Autoboeker 14-7-2026, Lyanthe 6-8-2026, NOAB monitor), accountant.nl
("gegijzeld"), higherlevel.nl topics on kasboek autobedrijf, self-billing, boekhoudprogramma advies.
