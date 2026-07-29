# De poorten van een inkoopfactuur

*Wat er met een inkomende factuur gebeurt tussen "hij komt binnen" en "hij staat in je boekhouding" — en, minstens zo belangrijk, wat er gebeurt met alles wat NIET binnenkomt.*

Dit document beschrijft één samenhangend systeem. Elk stuk is los gebouwd en los te lezen, maar ze delen één houding: **niets verdwijnt in stilte, en niets wordt automatisch geboekt waar geld op het spel staat.** Dat is Pijler ⑤ van deze app — het oog bevestigt, het voert niet in.

---

## De weg van een factuur

```
mailbox / camera / upload / UBL
        │
        ▼
  ┌─────────────────┐
  │ PHASE 0         │  afzenderregels · byte-hash · message-id · skip-registry
  └─────────────────┘
        │  (wat hier stopt, is verantwoord — nooit stil)
        ▼
  ┌─────────────────┐
  │ AI-uitlezen     │  bedragen · nummer · datum · leverancier · IBAN
  └─────────────────┘
        │
        ▼
  ┌─────────────────┐
  │ Poorten         │  dedup (dubbel?) · rekensom · IBAN-wissel · herinnering
  └─────────────────┘
        │
        ▼
  ┌─────────────────┐
  │ Controlewachtrij│  status 'processing' — de mens bevestigt
  └─────────────────┘
        │                       │
   bevestigd                 genegeerd  →  'archived' + reden, altijd terug te zetten
        │
        ▼
   'received' → 'paid'
```

Daarnaast staat één poort die naar de andere kant kijkt: **het ritme** — welke factuur is er níet gekomen?

---

## 1. Dubbel? — de vier dedup-poorten

Deze vier draaien in deze volgorde. Ze kijken **bewust niet naar de status** van de bestaande factuur: een genegeerde factuur is wel degelijk al geïmporteerd en mag niet nog een keer als kosten binnenkomen.

| # | Poort | Vangt | Te forceren? |
|---|-------|-------|--------------|
| 0 | **Byte-hash** (`documents.content_hash`) | exact hetzelfde bestand, via elk pad | **nee, nooit** |
| A | **message-id** (`messageId:filename`) | dezelfde bijlage uit dezelfde mail | nee |
| B | **Semantisch** (nummer/leverancier + totaal + datum) | dezelfde factuur als ánder bestand | ja, "toch toevoegen" |
| C | **Mogelijk dubbel** (zacht) | gelijkende factuur, te onzeker om te blokkeren | blokkeert niet — vlagt |

**Waarom de byte-hash niet te forceren is.** Identieke bytes zijn hetzelfde bestand. Er valt niets te overrulen, dus de 409 draagt bewust geen `canForce`. Poort B kan wél een vals positief zijn (twee echte bonnen, zelfde bedrag, zelfde dag, geen nummer) en heeft daarom een uitweg — met een `invoice.dedup_override` in het auditspoor.

**Waar dit strenger is dan de markt.** Xero vergelijkt contact + referentie + bedrag exact, en verliest daardoor elke match zodra een nummer als `26 / 3958` in plaats van `26/3958` wordt gelezen. Moneybird zegt zelf dat twee foto's van dezelfde factuur niet herkend worden, en controleert factuurnummers helemaal niet. Deze app normaliseert het nummer (`normalizeInvoiceNumber`) én de leveranciersnaam (`vendorCoreKey`, wettelijke achtervoegsels eraf) en heeft daarnaast de byte-hash die geen van beide heeft.

**Genegeerd is geen uitzondering — maar het wordt wel gezegd.** Botst een upload op een factuur die in Genegeerd staat, dan blijft de blokkade, maar de melding noemt dat en biedt "Terugzetten uit Genegeerd" aan (`src/lib/archived-duplicate.ts`). Bij een byte-hash-duplicaat is dat de enige weg vooruit; zonder die knop zat de eigenaar klem met een melding die niet klopte met wat hij zag.

---

## 1b. Geen factuur? — overzichten en de incassoladder

`src/lib/ai.ts` (woordenlijsten) · `src/lib/reminder-original.ts`

Twee soorten post die op een factuur lijken maar er geen zijn. Ze worden **verschillend** behandeld, en dat verschil is het punt.

### Overzichten — nooit importeren

Een `rekeningoverzicht`, `saldo-overzicht`, `debiteurenoverzicht`, `betalingsoverzicht`, `openstaande posten` of `overzicht openstaande facturen` somt **meerdere** facturen op onder één totaal. Dat totaal boeken telt de facturen dubbel die het samenvat, en er zit geen geldige btw-splitsing op. Dus: `is_invoice=false`, skip-registry, klaar.

Drie backstops boven de modellezing, omdat een klein model hier kan wankelen: de **bestandsnaam** (`isStatementFilename`), de **PDF-tekst** (`looksLikeStatementText` — vereist meervoudsvocabulaire *plus* een gesommeerd saldo of meerdere factuurregels) en de **afwijsreden** van het model zelf (`looksLikeStatementReason`).

> Bewust **niet** in de lijst: `maandoverzicht` en `jaaroverzicht`. Dat is vaak juist een **verzamelfactuur** — één factuurnummer over meerdere leverregels — en die *is* boekbaar. Eén factuur met veel regels is geen overzicht van veel facturen.

### De incassoladder — importeren hangt af van één vraag

De Nederlandse keten, nagelopen tegen deurwaarders- en incassobronnen:

```
betalingsherinnering → aanmaning → sommatie → ingebrekestelling
                                   └─ WIK-brief / 14-dagenbrief / aanzegging
```

Alle treden worden nu herkend (`isReminderFilename` + de prompt). Eerder stonden er alleen `herinnering` en `aanmaning` in — een `sommatie.pdf` gleed er dus langs en kon als gewone factuur landen.

Maar herkennen is niet hetzelfde als weggooien, en hier zit de enige echt subtiele beslissing van dit document. Een Nederlandse betalingsherinnering **herhaalt de hele factuur**: nummer, datum, bedragen, btw. Dus:

| Staat de originele factuur al in de boeken? | Wat er gebeurt |
|---|---|
| **Ja** | **Niet importeren.** Geen tweede kost, en de eigenaar heeft er niets aan in zijn wachtrij. Wél een rij in de skip-registry, mét het factuurnummer. |
| **Nee** | **Importeren, gevlagd.** Als de originele mail in de spam belandde, is deze herinnering het *enige* bewijs van een aftrekbare kost. Weggooien = voorbelasting kwijt, stil. |
| **Herinnering zegt niet waarover** | **Importeren, gevlagd.** Nooit overslaan op een vermoeden. |

Het antwoord hangt aan `reminder_of_invoice_number` — dat de uitlezer altijd al teruggaf, maar dat tot nu toe alleen in een melding belandde en nooit ergens tegen werd nagekeken.

De verzameling bekende nummers wordt **lui** geladen (de meeste syncs bevatten geen herinnering, dan draait er geen query) en **groeit tijdens de sync mee**, zodat een origineel en zijn herinnering die in dezelfde batch aankomen elkaar nog vinden. Genegeerde facturen tellen niet mee: heeft de eigenaar het origineel weggezet, dan is de herinnering misschien juist wat hij wil houden.

**Grens, bewust zo:** `normalizeInvoiceNumber` haalt alleen witruimte weg, geen scheidingstekens. `2026-0041` ≡ `2026 - 0041`, maar niet ≡ `20260041`. Ook streepjes strippen zou in het hóófd-dedup-pad `2026-1` en `20261` laten samenvallen en echte, verschillende facturen kunnen blokkeren. Een herinnering herhaalt in de praktijk hetzelfde gedrukte nummer, en de uitkomst bij niet-matchen is de veilige kant: importeren.

---

## 2. IBAN-wissel — de enige as waarop fraude niet groen geeft

`src/lib/iban-change.ts` · `supabase/migrations/supplier_registry.sql`

Een bekende leverancier stuurt een factuur met een **ander rekeningnummer**. Dat is de handtekening van factuurfraude, en het is precies het geval waarin elke andere poort groen geeft: het bedrag is overgenomen van een echte factuur, dus de rekensom klopt. Het nummer klopt. De datum klopt. De leverancier is bekend.

- Gezocht wordt op **KVK of naamsleutel** — nooit op IBAN zelf, want dat veld is juist de verdachte.
- De check draait **vóór** de leveranciersresolutie (die zou anders de vraag met zichzelf beantwoorden) en **vóór** de auto-advance-check (zodat zo'n factuur nooit automatisch boekt).
- Een **eerste** IBAN voor een leverancier die we nog zonder kenden is géén wissel. Dat is de registratie die rijker wordt, en daar een alarm van maken zou het signaal in ruis verdrinken.
- **Geen blokkade.** Een wissel is soms echt (andere bank, andere BV). De wachtrij toont een eigen rode badge *"Ander rekeningnummer"* — niet de amberen "Aandacht nodig", want dit gaat over geld, niet over een leesfout.

De melding noemt **beide nummers naast elkaar** en zegt erbij: bel de leverancier op een nummer dat je **zelf opzoekt**. Wie belt met het nummer op de vervalste factuur, belt de fraudeur.

---

## 3. Negeren — met geheugen en met een weg terug

`src/lib/archive-reason.ts` · `supabase/migrations/invoice_archive_reason.sql`

Negeren is **archiveren, nooit verwijderen** (bewaarplicht art. 52 AWR, zeven jaar). De rij, het bestand en het nummer blijven staan; alleen telt de factuur nergens meer mee.

**Opnieuw inlezen archiveert zelf.** Blijkt een factuur bij *"Opnieuw inlezen"* geen boekbaar stuk (een overzicht, een reclamemail), dan wordt hij nu automatisch weggezet met reden **Geen factuur** — voorheen vertelde een melding de eigenaar dat hij het zelf maar moest negeren, en dat is werk verschuiven terwijl hij net op die knop drukte om dit te laten uitzoeken. Dat mag omdat archiveren omkeerbaar is: één tik zet hem terug, en had de verse lezing het mis, dan kost dat een tik — geen document. Twee hekken blijven: de factuur moet nog in de controlewachtrij staan, en `hasSettledMoney` weigert alles waarop al (deels) betaald is.

**De reden** is een notitie, geen besluit — vier keuzes, bewust kort:

| Reden | Zegt iets over |
|-------|----------------|
| `dubbel` | de **import** |
| `niet_van_mij` | de **mailbox** |
| `geen_factuur` | de **afzender** ← de enige die een blijvende regel rechtvaardigt |
| `anders` | eerlijk niets beweren |

De lijst staat op drie plekken (scherm, API, `CHECK`-constraint). `archive-reason.test.ts` bewaakt dat ze niet uit elkaar lopen: als het scherm een reden aanbiedt die de database weigert, sneuvelt het *negeren zelf* op een notitie.

**Ongedaan maken** zit in dezelfde tik: de toast draagt een knop en blijft 7 seconden in plaats van 3 — drie seconden is genoeg om iets te lézen, niet om te beslissen dat je het toch niet wilde. Hij roept exact het bestaande herstelpad aan (`PATCH`), dus er is geen tweede waarheid.

---

## 4. Afzenderregels — het enige dat post ongezien tegenhoudt

`src/lib/sender-rules.ts` · `supabase/migrations/email_sender_rules.sql`

Eén adres dat elke week een reclamemail met bijlage stuurt, kost elke week een handeling. Eén regel maakt daar een eind aan.

**Bewust maar één soort regel: overslaan.** Geen categorieën, geen btw-standaarden, geen automatisch doorboeken. Zo'n regelsysteem wordt groot, en dan weet je op een dag niet meer waarom een factuur ergens in belandde. Een regel die alleen iets *niet* importeert kan hooguit één fout maken, en die fout is zichtbaar en met één tik weg.

Drie hekken:

1. **Zichtbaar.** Elke overgeslagen bijlage krijgt een rij in de skip-registry, met de regel erin genoemd. Te zien bij *"Overgeslagen bij import"*.
2. **Niets gaat weg.** Alleen de factuur-import wordt overgeslagen; de mail blijft in de mailbox.
3. **Per adres, nooit per domein.** `@kpn.com` zou de reclamemail én de echte telefoonrekening treffen — en dan mist er voorbelasting. Dit is de belangrijkste test in `sender-rules.test.ts`.

De regel wordt alleen *voorgesteld* na negeren met reden `geen_factuur`, in een apart schermpje — een blijvende regel verdient een eigen ja, geen vinkje dat je per ongeluk meeneemt. Beheren gebeurt bij **Genegeerd**, want dat is de plek waar je kijkt als je iets mist. Opheffen werkt niet terugwerkend: dat zou een wachtrij vol oude reclame opleveren.

---

## 5. Het ritme — de factuur die niet kwam

`src/lib/supplier-cadence.ts` · `/api/incoming/missing`

De duurste fout is de factuur die er nooit was: een lege wachtrij ziet er hetzelfde uit als een afgehandelde wachtrij. Pure rekenkunde over de tussenpozen tussen bestaande facturen — geen AI.

Het moeilijkste is niet het detecteren, het is het **zwijgen**:

1. **Vier facturen minimaal** (drie tussenpozen). Twee facturen zijn geen ritme, dat is een toeval.
2. **Een echt ritme**: elke tussenpoos dicht bij de mediaan, en de mediaan in een herkende bucket (wekelijks / maandelijks / per kwartaal / jaarlijks).
3. **Een venster, geen eeuwigheid**: voorbij één extra volledige cyclus is "gestopt" waarschijnlijker dan "zoek".

Plus coulance: een maandelijkse factuur is op dag 31 niet zoek, die is onderweg. Er wordt pas na ~37 dagen stilte iets gezegd.

Genegeerde facturen tellen niet mee in het ritme — die heeft de eigenaar juist weggezet.

**Bewust niet meegenomen:** bedragafwijking ("normaal €50, nu €500"). Dat is een andere vraag met een eigen foutkans; het ritme-oordeel moet eerst zijn waarde bewijzen voordat er een tweede signaal op dezelfde plek gaat staan.

---

## Migraties

**Allebei toegepast en gecontroleerd op 29 juli 2026** — elk `CONTROLE`-blok gaf `true` op elke kolom.

| Bestand | Wat |
|---------|-----|
| `invoice_archive_reason.sql` | `invoices.archive_reason` (+ `CHECK`) en `archived_at`, plus een partiële index |
| `email_sender_rules.sql` | tabel `email_sender_rules` + RLS (vier policies) + unieke index |

**De code draaide vóór de migratie zonder stuk te gaan**, en dat was geen toeval maar ontwerp, omdat migraties in dit project met de hand worden toegepast. Die terugvalpaden blijven staan — ze kosten niets (ze vuren alleen op een fout) en houden een verse dev- of staging-database werkend:

- de negeer-API valt bij een ontbrekende-kolom-fout terug op archiveren *zonder* notitie;
- de Genegeerd-query valt terug op de kale kolomlijst in plaats van een leeg tabblad te tonen;
- het regels-eindpunt antwoordt "geen regels" als de **tabel** niet bestaat;
- de mailsync past geen regels toe en importeert alles gewoon.

De eigenaar mist dan hooguit een label. Nooit een knop die stukgaat.

**Eén ding veranderde toen de tabel er eenmaal was.** Het regels-eindpunt slikte vóórdien élke fout en antwoordde "geen regels". Dat was verdedigbaar zolang "tabel bestaat niet" de enige realistische oorzaak was. Nu de tabel bestaat is het gevaarlijk: bij een RLS- of verbindingsfout zou het beheerscherm "geen regels" tonen terwijl er regels zijn die op dat moment post tegenhouden — en dan kan de eigenaar ze niet opheffen. Precies het scenario waar dit beheerscherm tegen bedoeld is. Het onderscheidt nu `42P01`/`PGRST205` (stille lege lijst) van een echte fout, die hardop gezegd wordt.

---

## Roadmap: Peppol / ViDA

**Niet gebouwd, wel gedateerd.** Nederland maakt B2B e-facturering verplicht: **1 januari 2030** binnenlands, **1 juli 2030** grensoverschrijdend, via Peppol, `EN 16931` / NLCIUS (Peppol BIS 3.0 / SI-UBL 2.0). B2G is al verplicht sinds 2019.

De *formaatkant* is al af: `handleUblInvoice` in `/api/intake` leest UBL/Peppol-XML en zet er een factuur van in de wachtrij, met dezelfde dedup-poorten als de PDF-route. Wat ontbreekt is het **ontvangen** — een Peppol access point zijn.

Eén punt om te volgen: onder ViDA kan de ontvangende lidstaat verlangen dat inkomende grensoverschrijdende facturen **binnen vijf dagen** gerapporteerd worden. Het Nederlandse advies raadt dat vooralsnog af, juist omdat inkoopfacturen in de praktijk niet binnen vijf dagen worden goedgekeurd. Als dat er tóch komt, raakt het precies de controlewachtrij die dit document beschrijft.

---

## Tests

Alles hierboven is puur getest, zonder database. Draai ze los met `npx tsx <bestand>`:

| Bestand | Bewaakt |
|---------|---------|
| `src/lib/archived-duplicate.test.ts` | de melding noemt altijd Genegeerd én terugzetten |
| `src/lib/reminder-original.test.ts` | de volledige incassoladder, en dat overslaan *alleen* mag als het origineel er echt is |
| `src/lib/iban-change.test.ts` | een wissel is nooit "clean", een eerste IBAN is geen wissel |
| `src/lib/archive-reason.test.ts` | scherm ≡ API ≡ `CHECK`-constraint |
| `src/lib/sender-rules.test.ts` | per adres, nooit per domein |
| `src/lib/supplier-cadence.test.ts` | wanneer er gezwégen moet worden |
| `src/lib/email-dedup.test.ts` | de nummer-tier duplicaatcheck |
| `src/lib/import-health.test.ts` | het read-time gezondheidsoordeel |
