# De trechter — hoe iemand van een zoekopdracht een gebruiker wordt

*Geschreven 31 juli 2026, nadat bleek dat de trechter lekte op zijn duurste punt.*

Dit document beschrijft één ding: de weg van een vreemde naar een account, en waar die weg
eerder brak. Het staat los van `JOUW_LIJST.md` (wat jij moet doen) en `LIVE_GAAN.md` (hoe je
deployt), omdat het een ontwerp beschrijft dat over vijf bestanden verspreid ligt en dat je
zonder deze uitleg per ongeluk "opruimt".

---

## 1. De weg

```
zoekopdracht
   ↓
/factuur-maken            of  /factuur-maken/<vak>      of  een van de 8 andere tools
   ↓                              ↓
   └──────────────┬───────────────┘
                  ↓
        de factuur wordt weggeschreven          ← [FUNNEL-OVERDRACHT]
                  ↓
              /register
                  ↓
       "Controleer je e-mail"  →  "Je factuur is bewaard"   ← de stilste plek, zie §4
                  ↓
             onboarding          → bedrijfsblok STIL voorgevuld
                  ↓
      /dashboard/invoice/new     → de factuur wordt AANGEBODEN
                  ↓
                account
```

De hele overdracht loopt via één module: **`src/lib/factuur-handoff.ts`**. Drie schermen lezen
hem, één schrijft hem. Wie een van die vier aanraakt zonder de andere drie te kennen, breekt de
keten — vandaar dit document.

---

## 2. Wat er kapot was

Onder aan `/factuur-maken` stond een knop:

> **"Maak een gratis account. Bewaar je facturen en houd je BTW bij."**

Daarachter zat een kale `<Link href="/register">`. De ingevulde gegevens stonden wél in
localStorage — `boekbrug.gratis-factuur.sender` en `.lastnr` — maar een zoekopdracht over
`register`, `onboarding` en `dashboard` gaf **nul** verwijzingen naar die sleutels.

De bezoeker vulde dus een factuur in, las dat hij hem kon bewaren, registreerde, en kwam
binnen op een leeg formulier: bedrijfsnaam, adres, KVK, BTW, IBAN, de klant en alle regels
opnieuw. Op precies het moment dat hij besloot te blijven.

Twee dingen maakten dat erger dan een gewone ontbrekende functie:

1. **Het was een belofte van het product zelf**, letterlijk in de knoptekst. Een functie die er
   niet is, is jammer; een functie die beloofd wordt en er niet is, is iets anders.
2. **Het zat op het duurste punt.** Iemand die dit meemaakt heeft al vijf minuten werk
   geïnvesteerd. Meer bezoekers door zo'n trechter sturen levert geen extra gebruikers op —
   alleen meer teleurgestelde onbekenden, en in een kleine gemeenschap wordt dat doorverteld.

Daarom is de volgorde: eerst de trechter dicht, dan pas kanalen.

---

## 3. Drie besluiten die eruitzien als details

Ze staan alle drie vast in `factuur-handoff.test.ts` (50 controles), omdat ze zonder uitleg
"gecorrigeerd" zouden worden naar iets dat verkeerd is.

### localStorage, niet sessionStorage

De bestaande scan-overdracht (`/factuur-scannen` → `/factuur-maken`) gebruikt sessionStorage.
Dat klopt dáár: twee pagina's, één tabblad, één handeling.

Registreren is anders. Er zit een bevestigingsmail tussen, en die opent bij veel mensen een
**nieuw tabblad** of zelfs een andere browser. sessionStorage is dan weg — en de overdracht zou
juist falen bij de gebruiker die het netjes doet. Vandaar localStorage, met **zeven dagen**
houdbaarheid: genoeg voor mail plus bedenktijd, kort genoeg dat een concept niet maanden later
opduikt bij iemand die allang iets anders doet.

Een payload uit de *toekomst* (verzette systeemklok) wordt ook geweigerd, anders zou hij nooit
verlopen.

### Het factuurnummer komt niet mee

In de gratis tool is `invoice_number` een gewoon invoerveld. In het product komt het uit de
doorlopende reeks die **art. 35 Wet OB** voorschrijft en die serverkant wordt uitgedeeld. Een
zelfgekozen nummer daarin laten binnenwandelen maakt precies het gat in de reeks waar de rest
van deze codebase zo hard voor werkt — en een gat in de nummering is wat een controleur zoekt.

De regels en de tegenpartij komen mee; het nummer wordt opnieuw en juist toegekend. Er is een
test die controleert dat er geen enkel veld met "nummer" of "number" in de payload zit, ook
niet onder een andere naam.

### Een ontbrekend BTW-tarief wordt 21%, nooit 0%

0% leest als *vrijgesteld*. Van de twee mogelijke fouten — te veel BTW rekenen (kost de klant
geld) of te weinig (kost de ondernemer een naheffing) — is de tweede de zwaardere. Dus is de
default het hoge tarief.

---

## 4. Stil voorvullen versus vragen

Dit onderscheid is bewust en het is geen stijlkwestie.

| Scherm | Gedrag | Waarom |
|---|---|---|
| onboarding, bedrijfsblok | **stil voorvullen** | het zijn zijn eigen gegevens van vijf minuten geleden — hij herkent ze |
| `/dashboard/invoice/new` | **vragen** | een compleet ingevulde factuur die vanzelf verschijnt is iets anders |

Een systeem dat ongevraagd een hele factuur invult, laat de gebruiker niet meer zien wat van
hem is en wat het systeem verzon. Het bedrijfsblok heeft dat probleem niet: dat is zijn adres,
en het niet hoeven overtikken is precies de wrijving die we wegnemen.

Bij het stille voorvullen staat één zin erbij ("We hebben dit overgenomen uit de factuur die je
net maakte") — anders voelt het als een systeem dat meer van je weet dan je dacht.

Het aanbod op het factuurformulier verschijnt **alleen bij een gewone nieuwe factuur**. Komt de
gebruiker binnen via een offerte, een vervanging of een scan, dan is hij met iets anders bezig
en zou het aanbod in de weg zitten.

### Het bevestigingsscherm

`/register` toont na aanmelden "Controleer je e-mail". Dat is de **stilste plek in de hele
trechter**: de mail opent vaak een ander tabblad, dus de bezoeker laat dit scherm achter zonder
te weten wat er met zijn werk gebeurde. De vraag die dan door zijn hoofd gaat is niet "waar is
de mail" maar *"ben ik dat kwijt"*.

Daar staat nu één zin die dat beantwoordt — en **alleen als er ook echt iets klaarstaat**. Een
geruststelling over iets dat er niet is, zou de volgende loze belofte zijn.

---

## 5. Waar de bezoekers vandaan moeten komen

`boekhoudprogramma zzp` is onwinbaar: daar staan partijen die er jaren geld in stoppen.
`factuur maken loodgieter` doet vrijwel niemand iets mee, en dat zijn wél de mensen die dit
product nodig hebben.

Daarom staan er elf **vakpagina's** onder `/factuur-maken/<vak>` (`src/lib/vak-sjablonen.ts`),
statisch geprerenderd en in de sitemap. Ze zijn inhoudelijk verschillend, niet dezelfde tekst
met een ander woord erin.

**Wat ze verkopen is niet het typwerk maar het BTW-tarief.** Dat is een juistheidsfunctie in het
jasje van een snelheidsfunctie:

| Vak | De valkuil |
|---|---|
| schilder / stukadoor | woning **ouder dan 2 jaar** → 9% over het arbeidsloon; materiaal blijft 21% |
| transport | **personen**vervoer 9%, **goederen**vervoer 21% — beide heten "transport" |
| schoonmaak | **binnen een woning** 9%, kantoorpand 21% |
| fietsenmaker | repareren 9%, verkopen 21% |
| bouw / klus | vaak *BTW verlegd* — en dat is iets ánders dan 0% |
| loodgieter | 21%; het lage tarief geldt **niet** voor installatiewerk (veelgemaakte aanname) |

Twee ontwerpregels houden dit uit de onderhoudsval, allebei met een test eromheen:

- **Nooit prijzen.** Een voorgevuld uurtarief is fout voor iedereen behalve toevallig één
  iemand, en een verkeerd bedrag dat ongemerkt meegaat op een echte factuur is erger dan een
  leeg veld. Een test loopt alle sjabloonregels af en faalt zodra er een bedrag in staat — ook
  verstopt in een omschrijving. In het volledige product komen zijn eigen eerdere regels
  vanzelf in de plaats van het sjabloon.
- **Twijfel wordt zichtbaar, niet weggepoetst.** Waar het tarief van de situatie afhangt, staat
  de veilige 21% ingevuld mét de uitleg wanneer 9% mag. Nooit andersom.

---

## 6. Wat hier NIET is gebouwd, en waarom

**De scan gaat niet mee naar het account.** `/factuur-scannen` draagt zijn regels over aan
`/factuur-maken` (sessionStorage, eenmalig), en vanaf daar loopt hij mee in de gewone
overdracht. Maar een gescande factuur is er een die je **ontving** — zijn afzender is niet jouw
klant. Hem als uitgaande factuur laten binnenkomen zou de factuur stil aan de verkeerde partij
adresseren. De juiste bestemming is de inkoopkant, en dat is een groter stuk (upload + document)
dan hier thuishoort.

**Er is geen "importeer als concept"-API.** Het factuurformulier in het dashboard maakt de
factuur zelf, via de bestaande, geteste weg met de juiste nummering. Een tweede aanmaakpad
ernaast zou twee plekken opleveren waar de doorlopende reeks kan scheuren.
