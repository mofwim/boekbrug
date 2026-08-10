# XAF auditfile — status en wat er nog nodig is

Het XML Auditfile Financieel (XAF) is het bestand waarmee een administratie in
één keer aan een boekhouder, de Belastingdienst of een curator wordt overgedragen.
Voor een app die zich "de brug naar je boekhouder" noemt is dat het ontbrekende
sluitstuk: we exporteren nu CSV en UBL, maar een boekhouder op Twinfield, AFAS of
Exact kan onze administratie niet in één standaardbestand inlezen.

## Wat er af is

`src/lib/xaf-ledger.ts` — de **formaat-onafhankelijke helft**: het afleiden van een
sluitende dubbele boekhouding uit wat de app opslaat.

De app bewaart eenzijdige feiten (een factuur, een bankregel, een kasboeking).
Elke auditfile-standaard wil het omgekeerde: een grootboekschema plus transacties
waarvan de regels tot op de cent in evenwicht zijn. Die vertaling is het lastige,
app-specifieke deel — en die verandert **niet** met de XAF-versie, dus hij staat
los en volledig getest.

- Grootboekschema (elf rekeningen) en dagboeken (V/I/B/K) staan op één plek en
  zijn met één regel aan te passen aan het schema van een boekhouder.
- Rekenen gebeurt in **hele centen**; floats kunnen 0,10 niet exact weergeven en
  "debet is gelijk aan credit" is precies de eigenschap die nooit mag wankelen.
- Regels overgenomen uit `src/lib/snelstart-mapping.ts`, zodat er één boekhoudkundige
  waarheid is en geen tweede: alleen échte boekingen (geen offerte/concept), de
  btw van een factuur wordt **geboekt zoals opgeslagen** en nooit herrekend, een
  centje afrondingsruis gaat naar de grootste regel maar een écht verschil blokkeert
  de boeking, en een creditnota is dezelfde boeking met alle kanten omgedraaid.
- Niets wordt geraden. Een bankregel zonder categorie, een factuur zonder richting
  of een boeking waarvan de bedragen niet optellen wordt **geweigerd met een reden**
  die de ondernemer kan oplossen — nooit stilzwijgend weggelaten.
- Een bankregel die aan een factuur gekoppeld is boekt tegen Debiteuren/Crediteuren,
  niet nog een keer tegen omzet/kosten: dezelfde euro twee keer tellen is precies
  hoe een aangifte onwaar wordt.

`src/lib/xaf-ledger.test.ts` — 75 controles, waaronder een sweep van 8.000
willekeurige boekingen (alle btw-tarieven, beide richtingen, creditnota's) die
allemaal sluiten, plus 2.000 kapotte rijen die allemaal geweigerd worden.

## Wat er nog niet is, en waarom

De XML-verpakking. **Bewust nog niet gebouwd**, en er staat dus ook geen
export-knop in de app.

De officiële specificatie (XAF 4.0.3, februari 2025, veldenaantal teruggebracht
van 250 naar 90 en uitgelijnd op RGS) staat op `odb.belastingdienst.nl`. Dat
domein is vanuit de ontwikkelomgeving **geblokkeerd door de netwerkproxy**, net als
de technische naslag op `learn.microsoft.com` en `xaf-ok.nl`; op npm staat geen
schema. Uit zoekresultaten zijn wel elementnamen bevestigd (`header`,
`ledgerAccount`, `trLine`, `amnt`, `accID`, `fiscalYear`, `RGScode` onder
`ledgerAccount`), maar dat is niet hetzelfde als de XSD.

Een bestand dat zegt XAF te zijn en vervolgens sneuvelt op de validatie van de
boekhouder of de Belastingdienst is erger dan geen bestand — het is exact de valse
geruststelling die deze app nergens geeft. Daarom is de verpakking gepauzeerd tot
de specificatie er is.

## Om het af te maken zijn twee dingen nodig

1. **Welke versie vraagt de boekhouder?** 4.0.3 (de huidige, RGS-uitgelijnd) of
   3.2 (wat veel pakketten nog accepteren).
2. **De XSD of een voorbeeld-`.xaf`** uit het pakket van die boekhouder. Daarmee is
   de verpakking een dunne laag boven `buildLedger()`, plus een validatie die
   weigert te schrijven zodra `ledgerIsBalanced()` onwaar is.

Ook nog te beslissen bij het afmaken: of de rekeningnummers hierboven overeind
blijven of vervangen worden door de RGS-codes van die boekhouder. Het schema staat
daarom als één constante bovenin `xaf-ledger.ts`.
