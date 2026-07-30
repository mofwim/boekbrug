# Herstelplan — juli 2026

*Eén plan. Drie paginarapporten (bank · facturen · incoming/manage) plus de presentatie-audit,
samengevoegd en opnieuw geverifieerd tegen de code voordat er één regel veranderde.*

## Wat er geverifieerd is, en hoe

Elke claim uit de drie rapporten is hier opnieuw nagelopen — niet overgenomen. De pure functies
zijn **uitgevoerd**, niet gelezen:

```
#1 creditnota   matcher(total=-250) → eligible: true ; confirm(total=null) → false ; CONTROL: ok
#2 vrije tekst  "Huur juli, Kerkstraat 12" → ["huurjuli","kerkstraat12"]  (2 "facturen")
#3 SEPA incasso MT940 → null ; CAMT → "0001, 994872215, 1260405"  (dedupsleutel wijkt af)
#5 MT940        YYMMDD "999999" → "2099-99-99" ; 320-cijferig bedrag → Infinity
```

Alles bevestigd. Drie claims uit de rapporten zijn door de indieners zelf al gecorrigeerd
(CAMT `<Pty>` = toekomstig risico, geen bestaande fout; #12 en #14 smaller dan gesteld) — die
staan hieronder op hun gecorrigeerde plaats, niet op de oorspronkelijke.

## Volgorde — waarom deze en geen andere

De volgorde is niet naar ernst maar naar **onherstelbaarheid**: eerst wat geld verkeerd zet of
data stil verliest, dan wat liegt tegen de gebruiker, dan wat onnauwkeurig is.

### Spoor A — geldcorrectheid

| # | Wat | Waar |
|---|---|---|
| A1 | `isEligible` krijgt het echte `total_inc_btw` — creditnota-terugbetaling was volledig geblokkeerd bij de bevestiging | `api/bank/confirm/route.ts:136` |
| A2 | MT940 krijgt de finite-bedrag- en ISO-datumwacht die CAMT al heeft (`[H3]`/`[M4]`) | `lib/bank-parser.ts:275-281` |
| A3 | CAMT roept `extractInvoiceReference` aan i.p.v. een eigen kopie zonder de incassoregel | `lib/bank-parser.ts:726-740` |
| A4 | Rollback herstelt ook `amount_paid` — anders blijft een `sent` factuur met openstaand 0 achter | `api/bank/confirm/route.ts:431` |
| A5 | `executePay` krijgt `try/catch/finally` — netwerkfout liet "Betaald" staan zonder schrijving | `facturen` + `incoming/manage` |
| A6 | Undo zet `amount_paid` lokaal terug op 0 — anders een verzonnen deelbetaling | beide pagina's |
| A7 | Offerte verwijderen loopt via de gecontroleerde serverroute i.p.v. een ongecontroleerde clientdelete | `FacturenClient.tsx:652` |
| A8 | `clientKey` één keer per dialoog — idempotentie deed niets | beide pagina's |

### Spoor B — stille dataverlies

| # | Wat | Waar |
|---|---|---|
| B1 | Kandidaatfacturen + betaalde nummers pagineren (PostgREST kapt stil op ~1000) | `api/bank/match`, `api/bank/confirm` |
| B2 | `parseReferenceNumbers` eist een cijfer — vrije tekst met een komma was een "meervoudige betaling" | `lib/bank-matching.ts:725` |
| B3 | `applyMap` overslaan als de `map`-fase faalde, en die fase benoemen in het verslag | `incoming/manage` |

### Spoor C — eerlijkheid tegenover de gebruiker

| # | Wat | Waar |
|---|---|---|
| C1 | `email_failed` niet meer als "verzonden ✓" | `FacturenClient.tsx:735` |
| C2 | Verlopen-chip berekend met `getDisplayStatus` (bestond al, werd niet gebruikt) | `FacturenClient.tsx:1007` |
| C3 | `calcBtw` verzint geen 21% meer bij ontbrekende grondslag | beide pagina's |
| C4 | Openstaand bedrag 0 → expliciete zin i.p.v. twee grijze knoppen zonder uitleg | `incoming/manage` |
| C5 | `?action=pay` opent de dialoog één keer | `incoming/manage` |
| C6 | `amsterdamToday()` voor "vandaag" i.p.v. de klok van het toestel | beide pagina's |

### Spoor D — nauwkeurigheid

| # | Wat |
|---|---|
| D1 | `nameSimilarity`: `amount_only` eist ≥2 gedeelde tokens (`Jansen B.V.` ↔ `Jansen Holding` scoorde 1.000) |
| D2 | `bank-identity`: `\bopname\b` en `\brente\b` versmald — echte kosten vielen uit de W&V, ontvangen rente werd als kosten geboekt |
| D3 | `BankClient`: vier eigen kopieën van het nummertellen vervangen door de gedeelde functie |
| D4 | Kapotte melding-link `/dashboard/btw` (bestaat niet) → `/dashboard/aangifte` |

## Wat bewust NIET gebeurt

- **`src/lib/invoice-pdf.tsx`** wordt niet aangeraakt. Die module rendert de factuur die de klant
  per e-mail krijgt; hij deelt geen tokens met de web-UI en een zoek-en-vervang eroverheen is de
  enige verandering in dit plan die het apparaat verlaat.
- **Geen migratie.** Alles hier is code. Raakt een punt het schema, dan stopt het en wordt het
  gemeld — een migratie is het enige wat een `git revert` niet ongedaan maakt.
- **Routes worden niet verwijderd**, alleen doorverwezen: meldinglinks staan als tekst in de
  database en in de PWA-snelkoppelingen die het besturingssysteem cachet.
- **Verzendpad van een factuur** blijft ongemoeid in een cosmetische pas: dat mint een wettelijk
  nummer (Art. 35) en kent geen rollback.

## Controle per stap

`npx tsc --noEmit` · `npx tsx --test src/lib/*.test.ts` · `node scripts/nav-audit.mjs`
Eén commit per punt, zodat elk punt afzonderlijk terug te draaien is.
