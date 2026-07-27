# SnelStart als maatstaf — wat kunnen zij, wat doen wij, en wat nemen we over (op onze manier)

_Juli 2026 — verkenning, geen bouwplan. Beslissingen staan in §5._

SnelStart is het pakket dat onze doelgroep het meest gebruikt (kleine handelaren en de
boekhouders die hen bedienen). Deze notitie zet hun functionaliteit naast de onze, niet om
ze na te bouwen maar om te bepalen **welke uitkomst een gebruiker bij hen wél krijgt en bij
ons niet** — en welke daarvan bij ons past.

> **Bron en betrouwbaarheid.** `snelstart.nl` is vanuit onze ontwikkelomgeving niet
> bereikbaar (netwerkbeleid blokkeert de host). Alles hieronder komt uit zoekresultaten,
> hun kennisplein-artikelen en onafhankelijke reviews van juli 2026. Prijzen verschillen
> per bron met een euro (inStap € 14,50 of € 15,50; inKaart € 20 of € 20,50) — behandel
> ze als orde van grootte, niet als offerte. Voor definitieve cijfers: hun eigen site.

---

## 1. Hun pakketten

| Pakket | Prijs/mnd | De grens die het pakket trekt |
| --- | --- | --- |
| **inStap** | ± € 14,50 | facturen en bonnen aanleveren; **btw-aangifte kan je niet zelf doen** — die doet je boekhouder |
| **inKaart** | ± € 20,50 | vanaf hier verstuur je zelf de btw-aangifte; zakelijke rekening + betaalpas inbegrepen |
| **inBalans** | ± € 37,50 | offertes, prijsbeheer, abonnementen, debiteurenbeheer, herinneringen en aanmaningen |
| **inZicht** | ± € 51,50 | pakbonnen, kostenplaatsen, verzamelfacturen, uitgebreider inzicht |

Let op wat die eerste trede zegt: **hun instappakket is expliciet gebouwd voor "jij levert
aan, je boekhouder doet de aangifte".** Dat is exact onze doelgroep en exact onze belofte —
alleen vragen zij er € 14,50 voor en krijgt de ondernemer er een boekhoudprogramma bij dat
hij moet leren bedienen.

## 2. Capaciteit voor capaciteit

| Wat SnelStart kan | Hoe zij het doen | Wat wij vandaag hebben | Oordeel |
| --- | --- | --- | --- |
| **Bonnen/facturen scannen** | Scan & Herken: foto via hun app of doorsturen naar een eigen SnelStart-mailbox → OCR vult leverancier en bedragen in, jij controleert. Zit in élk pakket | AI-intake via e-mail (Gmail/Outlook), camera, upload; leest, controleert de rekensom, herkent duplicaten, koppelt de leverancier | **Gelijk of voor.** Zij vullen velden in; wij weigeren een factuur die niet klopt |
| **Bankkoppeling (PSD2)** | Automatisch, meermaals per dag, gratis in het pakket; ABN, ING, Rabo, SNS, ASN, Regiobank, Triodos, Knab, bunq, Revolut, Van Lanschot | **Alleen bestandsimport** (CSV/MT940/CAMT). De ondernemer moet zelf downloaden en uploaden | **Grootste gat.** Zie §5.1 |
| **Btw-aangifte** | Eén klik → rechtstreeks naar de Belastingdienst, 72 uur acceptatietermijn; tussentijdse suppleties instelbaar; ICP-opgaaf; fiscale eenheid | Wij rékenen de aangifte, tonen gereedheid, bevriezen een snapshot bij indienen en signaleren afwijking + suppletiegrens. **Versturen doen we niet** | **Gat in de laatste meter.** Zie §5.2 |
| **ICP-opgaaf (EU-diensten)** | Ingebouwd | Niet aanwezig | Gat, klein publiek |
| **Facturen, creditnota's, offertes** | Vanaf inBalans offertes + prijsbeheer | Facturen, creditnota's, offertes, nummering volgens Art. 35, PDF, verzenden, UBL | **Gelijk** |
| **Herinneringen en aanmaningen** | Vanaf inBalans (€ 37,50) | Automatische betalingsherinneringen met eigen cadans, betaalverzoeken, EPC-QR, gebundelde betaallinks | **Voor** — en bij ons zit het niet achter de duurste trede |
| **Periodiek factureren (abonnementen)** | Abonnementsorder per klant → reeks facturen (vanaf inBalans) | Niet aanwezig | Gat, goedkoop te dichten. Zie §5.3 |
| **Debiteurenbeheer / CRM** | Vanaf inBalans | Klanten, leveranciersregister, openstaand per klant | **Gelijk** |
| **Kassa & dagomzet** | SnelStart Kassa (eigen POS, hardware, horeca/retail): omzet boekt automatisch door, pin en kas correct gesplitst | Dagomzet, kasboek, PIN/kas-afletteren, Z-rapport import via spreadsheet, kasverschil-signalering | **Gelijk in uitkomst, anders in aanpak.** Zij verkopen een kassa; wij lezen wat de kassa al uitspuugt |
| **Voorraadbeheer** | Voorraden, deelleveringen, backorders, pakbonnen | Artikelen zonder voorraad | Gat — **bewust niet dichten** (§6) |
| **Urenregistratie** | Eigen module + koppelingen (Keeping, QicsMilestones) | Niet aanwezig (wel een kilometer-calculator op de portal) | Gat — beperkt overnemen (§5.4) |
| **Rittenregistratie** | Via partners | Niet aanwezig | Gat, laag |
| **Kostenplaatsen** | Vanaf inZicht (€ 51,50) | Niet aanwezig | Bewust overslaan |
| **Samenwerken met de boekhouder** | Boekhouder krijgt gratis toegang, werkt in zijn eigen SnelStart-omgeving; jullie verdelen het werk; hij doet de jaarafsluiting | Accountant-module met uitnodiging, werkbord, gereedheid per klant, kwartaaloverzicht, schrijfsloten op bedragen | **Gelijk of voor** — ons werkbord vertelt de boekhouder wélke klant klaar is |
| **Rapportages / jaarrekening** | Balans, winst-en-verlies, jaarrekening, 300+ koppelingen | Resultaat, kwartaal, waarheid-overzicht | Deels — jaarrekening is boekhouderswerk, geen gat voor ons |
| **Zakelijke rekening + pas** | SnelStart Bankieren, inbegrepen vanaf inKaart | n.v.t. | Bewust overslaan (vergunningsdomein) |
| **Mobiel** | Native app voor iOS en Android | PWA + TWA (Android) | Gelijk in praktijk |

## 3. Waar zij zwak zijn

Uit de reviews van 2026, consistent over meerdere bronnen:

- **Steile leercurve.** "Functioneel, niet elegant." Gebruikers noemen het onoverzichtelijk;
  meerdere reviewers sturen absolute beginners naar Moneybird in plaats van SnelStart.
- **Verouderde omgeving** in delen van het product.
- **Wachttijden bij de helpdesk** (naast veel lof voor snelheid — het beeld is gemengd).
- **Geen Engels.** Al vastgesteld in `growth-plan-2026.md` §2.2 als de grootste
  onverdedigde flank.

Dat is het beeld van een programma dat **je moet leren bedienen**. Daar zit onze opening:
wij verkopen geen programma, wij leveren een uitkomst.

## 4. Het onderscheid in één zin

> **SnelStart is een boekhoudprogramma dat de ondernemer bedient.
> BoekBrug hoort een systeem te zijn dat een afgesloten kwartaal aflevert.**

Daarom nemen we functies over als **uitkomst**, nooit als module. Niet "wij hebben ook
urenregistratie", maar "je urencriterium is aantoonbaar". Niet "wij hebben ook een
bankkoppeling", maar "je hoeft nooit meer een bestand te downloaden".

## 5. Wat we overnemen — op onze manier

### 5.1 Bankkoppeling (PSD2) — hoogste prioriteit

**Waarom:** het is de laatste grote handmatige handeling die wij nog vragen en zij niet.
Erger: onze sterkste motor (de afletter-/waarheidsmachine) draait pas als de mutaties
binnen zijn. Elke dag dat de ondernemer geen bestand uploadt, staat onze motor stil.

**Onze manier:** niet "mutaties inladen" maar **stille afletterlus** — mutaties komen
meermaals per dag binnen, de bestaande auto-afletter koppelt ze aan facturen, en de
ondernemer ziet alleen wat écht zijn aandacht nodig heeft. Zij tonen een bankboek; wij
tonen een lijstje uitzonderingen.

**Kosten en realiteit:** dit vraagt een AISP-vergunde partij (Tink, Enable Banking,
GoCardless/Nordigen) — terugkerende kosten en compliance-werk. Dit is de duurste post in
deze notitie en de enige die niet met code alleen op te lossen is. Bestandsimport blijft
sowieso bestaan als terugvaloptie.

### 5.2 De laatste meter van de btw-aangifte

**Waarom:** "btw-aangifte in één klik" is hun kopregel, en bij ons stopt het bij
"berekend en bevroren". Het rekenwerk — het moeilijke deel — hébben we al, inclusief iets
dat zij niet prominent doen: signaleren dat een ingediende aangifte is gaan afwijken en of
de suppletiegrens van € 1.000 is gepasseerd.

**Onze manier:** rechtstreeks indienen vraagt Digipoort/fiscale-dienstverlener-status —
zwaar. De tussenstap die 90% van de pijn wegneemt: **een begeleide indiening** — per
rubriek de exacte bedragen, gekopieerd met één tik, met de schermvolgorde van Mijn
Belastingdienst Zakelijk ernaast, en na afloop de bevestiging vastleggen als snapshot.
Daarna pas beoordelen of echte indiening de investering waard is.

**Erbij:** ICP-opgaaf is klein werk zodra de rubrieken er staan, en het is een harde
blokkade voor wie aan EU-bedrijven levert.

### 5.3 Periodiek factureren — goedkope winst

Abonnementsfactuur per klant, automatisch aangemaakt op de afgesproken dag. Bij hen zit
dit achter € 37,50; onze factuurmotor (nummering, PDF, verzenden, herinneren) kan dit
grotendeels al. **Onze manier:** de reeks wordt een concept dat pas verstuurt na één tik —
automatisch factureren zonder blik is precies hoe fouten de deur uit gaan.

### 5.4 Urenregistratie — alleen als fiscaal bewijs

Niet als timesheet-module. **Onze manier:** het urencriterium (1.225 uur) is een fiscale
eis waar de zelfstandigenaftrek aan hangt — en die aftrek is in 2026 juist gekrompen naar
€ 1.200, wat de controle scherper maakt. Wat de ondernemer nodig heeft is geen
urenadministratie maar een **aantoonbare teller**: hoeveel uur staat er, haal ik het
criterium, en kan ik het bij een vraag onderbouwen. Onze portal heeft het artikel al; het
product heeft de teller niet.

### 5.5 Kassa-import verbreden — ons bestaande voordeel verstevigen

Zij verkopen een POS. Wij moeten er geen bouwen. Maar hun kassakoppeling levert de
ondernemer één ding op dat telt: **de dagomzet met pin/kas-splitsing komt vanzelf in de
boeken.** Wij lezen al Z-rapporten via de spreadsheet-import; de winst zit in **breedte** —
de exportformaten van de kassa's die onze doelgroep echt gebruikt (Mplus, Lightspeed,
SnelStart Kassa zelf) herkennen zonder dat de ondernemer kolommen moet uitleggen.

## 6. Wat we bewust NIET overnemen

| Niet bouwen | Waarom niet |
| --- | --- |
| Voorraadbeheer, deelleveringen, backorders, pakbonnen | Een ander product met een eigen leercurve; onze belofte is de administratie, niet de logistiek |
| Kostenplaatsen | Hun eigen prijslijst zet dit op € 51,50 — dat is geen doelgroep van ons |
| Eigen kassasysteem/hardware | Kapitaalintensief, servicezwaar, en het maakt ons afhankelijk van hardware |
| Zakelijke rekening / betaalpas | Vergunningsdomein |
| Jaarrekening samenstellen | Het werk van de boekhouder — wij leveren hem de basis, wij vervangen hem niet |
| 300+ koppelingen-ecosysteem | Volgt uit marktpositie, niet andersom |

## 7. Volgorde die ik zou aanhouden

1. **§5.2 begeleide btw-indiening** — kleinste afstand tot iets dat al bijna af is; maakt
   onze belofte ("kwartaal afgesloten") voor het eerst compleet.
2. **§5.5 kassa-import verbreden** — versterkt het enige gebied waar wij structureel
   beter zijn dan de generieke pakketten.
3. **§5.3 periodiek factureren** — goedkoop, en het bindt terugkerende klanten.
4. **§5.1 PSD2** — de grootste sprong, maar ook de enige met terugkerende kosten en een
   externe partij. Verdient een eigen afweging, niet een impulsbeslissing.
5. **§5.4 urenteller** — klein, en het sluit aan op content die al ranked.

## 8. Wat deze notitie NIET zegt

Ze zegt niets over prijs, over hoeveel van hun functies onze doelgroep werkelijk gebruikt,
en niets uit eerste hand van hun site (zie de bronnotitie bovenaan). Drie gesprekken met
boekhouders die kasgedreven winkels bedienen zijn hier meer waard dan nog een ronde
deskresearch: zij weten welke van bovenstaande functies dagelijks wordt aangeraakt en
welke leeg staat.
