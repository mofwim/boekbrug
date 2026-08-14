# BoekBrug — marktpositie, eerlijk opgeschreven

_Juli 2026. Geschreven op verzoek van de oprichter, met deze woorden erbij: "SnelStart biedt
echt iets groots; wat ons onderscheidt is niets vergeleken met hun mogelijkheden. Toen we
begonnen was het idee: de kleine klant maakt een factuur, ontvangt een factuur, en die bereikt
de boekhouder."_

_Dit is geen pitch en geen troost._

---

> ## ⚠ Hertoetsing 14 augustus 2026 — vier dragende uitspraken zijn achterhaald
>
> Dit stuk beschrijft de repo van juli 2026. Sindsdien is er doorgebouwd, en **twee van de acht
> stoppunten waren al opgelost voordat iemand ze las** — het document stuurde de oprichter naar
> werk dat niet meer bestond. Wat er nu feitelijk staat, regel voor regel nagekeken:
>
> | Uitspraak in dit stuk | Status per 14 aug 2026 |
> |---|---|
> | "geen PSD2" (§1, §2) | **ACHTERHAALD.** `src/lib/enablebanking-client.ts` + `-connection` + `-sync` + `-map`, een `/dashboard/bank`-koppelscherm en een dagelijkse cron in `vercel.json`. Het is een volledige AIS-koppeling die een eerdere GoCardless-client vervángt. Wacht nog op `ENABLEBANKING_APPLICATION_ID` en `_PRIVATE_KEY` — dus gebouwd, niet aangezet |
> | "geen rechtspersoon: `/voorwaarden` staat live met `[JOUW NAAM]`" (§1, stoppunt 0) | **ACHTERHAALD.** `src/content/legal/company.ts` vult de identiteit bij het renderen uit `NEXT_PUBLIC_COMPANY_*`, met opzettelijk onaffe terugvallen (`(volgt)`) die nooit als een echt-maar-onjuist KVK-nummer kunnen lezen. `company.test.ts` scant de gerénderde documenten op elk overgebleven `[...]`-token en laat de build vallen. De KvK-inschrijving zelf is nog steeds open — de placeholder-lek niet |
> | "AV noemt Pro € 25 en Pro+ € 45 incl. PSD2" (stoppunt 0b) | **ACHTERHAALD.** AV §5.1 kent nu Boekhouder € 0 (≤ 10 klanten) · Ondernemer Gratis € 0 · Ondernemer Plus € 12,99 incl. btw. Van PSD2 wordt in geen enkel juridisch document meer iets beloofd |
> | "de database kent een ánder viertrapsmodel" (stoppunt 0b) | **ACHTERHAALD.** `database.sql:436` staat op `free/plus/boekhouder`; `supabase/migrations/subscription_plans_fair_use.sql` tilt de oude rijen over en verbiedt `boekhouder_pro`. Geen niet-testcode leest de oude waarden nog |
>
> **Wat wél overeind bleef** en opnieuw op de code is bevestigd: geen XAF-auditfile, geen RGS,
> geen indiening bij de Belastingdienst (het `aangifte`-scherm bereidt voor, verstuurt niet),
> de UBL-export is nog steeds bewust géén SI-UBL/Peppol BIS (`src/lib/ubl-export.ts:7`), de
> SnelStart-koppeling wacht nog steeds op een subscription key
> (`docs/SNELSTART_INTEGRATION.md:3`), en de drievoudige kaartafletting bestaat echt.
>
> **Eén uitspraak in §6 valt uiteen in twee.** "Engels bestaat alleen voor de publieke tools en
> de blog" is **achterhaald**: `src/lib/i18n/` draagt een volledige vertaallaag (`messages.ts`,
> `locale.ts`, `server.ts`, `t.ts`, `use-locale.ts`) die tot in het dashboard reikt, in
> nl/en/ar/tr. De twee details ernaast **gelden nog wel**: `lang="nl"` staat nog hard in
> `layout.tsx:90`, en `preferred_language` op `profiles` wordt nog steeds door geen regel code
> gelezen — dat laatste inmiddels met opzet, want de taal zit in een cookie en bewust niet in
> een profileskolom (`use-locale.ts:6`).
>
> **Eén claim kon hier niet getoetst worden:** de commit-verdeling "80 mofwim naast 131 AI" in
> §7. Deze werkkopie is een shallow clone (125 commits, één auteur zichtbaar), dus dat getal is
> hier niet te controleren — niet weerlegd, wel ongeverifieerd.
>
> **De les die groter is dan de correcties.** Dit document waarschuwde in §0 dat zijn
> marktcijfers ongetoetst waren, maar presenteerde zijn uitspraken over de eigen repo als het
> harde deel ("regel voor regel nagekeken"). Dat wás waar op de schrijfdatum en is precies
> daarom het gevaarlijkste deel geworden: ongetoetste marktcijfers blijven ongetoetst, maar
> een gecontroleerde uitspraak over je eigen code **veroudert** — en leest daarna nog steeds
> als feit. Toets de repo-uitspraken opnieuw vóór elk besluit dat erop steunt.

---

## 0. Hoe betrouwbaar is dit stuk

Zes parallelle onderzoekssporen (concurrenten, de voorbewerkingscategorie, marktomvang,
distributie, wettelijke krachten, taalsegment), daarna een tegenlezing, daarna een controle van
elke uitspraak over het product tegen de code zelf.

**Twee waarschuwingen die je moet lezen vóór je hier een beslissing op baseert:**

1. **De adversariële toetsing is mislukt.** Vijf dragende claims gingen naar onafhankelijke
   verificatie; **vijf van de vijf kwamen terug als ONVERIFIEERBAAR** — niet omdat ze onwaar
   zijn, maar omdat het zoekbudget van de sessie op was en de uitgaande verbindingen werden
   geweigerd. Nul claims zijn bevestigd. Meer dan tachtig dragende claims zijn nooit getoetst.
   **Het volledige prijsbeeld in hoofdstuk 3 is dus ongeverifieerd**, inclusief de cijfers
   waarop de meeste conclusies leunen.
2. **Niemand in deze hele stapel heeft een tarievenpagina van een concurrent daadwerkelijk
   geopend.** Alle prijzen komen uit vergelijkings- en affiliate-sites. Drie affiliate-sites
   die hetzelfde zeggen zijn één bron, geen drie.

Wat wél hard is: alles over BoekBrug zelf. Dat is regel voor regel in de repo nagekeken en
staat met bestandsnaam erbij.

> **Eén middag werk vervangt honderd pagina's deskresearch:** open zelf de tarievenpagina's van
> Moneybird, e-Boekhouden, SnelStart, Reeleezee, Basecone, TriFact365 en Yuki. Noteer de
> raadpleegdatum en of het bedrag in- of exclusief btw is. Doe dat vóór één prijsbeslissing.

---

## 1. Het eerlijke antwoord in vijf zinnen

Als **boekhoudpakket** verliest BoekBrug elke vergelijking op rij één van de featuretabel —
geen PSD2, geen indiening bij de Belastingdienst, geen XAF-auditfile, geen RGS, en de
UBL-export is blijkens `src/lib/ubl-export.ts:7` bewust géén SI-UBL/Peppol BIS — en dat is geen
inhaalbare achterstand maar een verkeerde categorie. Tegelijk staat er in dezelfde repo iets
wat geen enkele Nederlandse partij in het segment van € 0–25 heeft: een **drievoudige afletting
van kaartomzet** (kassa-Z-bon versus terminalafslag versus netto bankuitbetaling) die het
verschil als acquirer-commissie boekt in plaats van het in een tolerantie te laten verdwijnen.
De oprichter heeft dus gelijk over het oppervlak van zijn product en ongelijk over de diepte
ervan: wat hij als onderscheid opsomt (factureren, scannen, de boekhouder laten meekijken) is
inderdaad commodity, en wat wél onderscheidt staat op geen enkele featurelijst — ook niet op de
zijne. Maar dat onderscheid is bewezen op **één winkel, één acquirerformaat, twee dagen**, de
SnelStart-koppeling is **niet live** (hij wacht op een subscription key die de tegenpartij nog
moet verstrekken), en er is **geen rechtspersoon**: `src/content/legal/algemene-voorwaarden.ts`
zegt live op `/voorwaarden` letterlijk "geëxploiteerd door **[JOUW NAAM]**, KVK-nummer
**[INVULLEN]**". De positie is daarom niet "kansloos naast SnelStart" en ook niet "we hebben
een moat" — het is: **één ongewoon goed stuk techniek zonder bedrijf eromheen, en zonder één
gesprek met een koper.**

---

## 2. Wat je goed ziet, en waar je je vergist

### Waar je gelijk hebt — harder gelijk dan je denkt

**Facturen maken is dood als onderscheid.** Niet alleen omdat minstens zes NL-pakketten een
gratis of langdurig gratis instap hebben (Moneybird, Jortt, Tellow, Rompslomp, Fiskr,
MoneyMonk) [ongetoetst], maar omdat de zoekterm zelf verloren is: de bovenkant van "factuur
maken" is Canva, Adobe Express en invoice-generator.com — geen Nederlandse boekhoudsoftware.
Het groeiplan in de repo zet daar nog wel op in. Die inzet moet weg.

**AI-bonnen scannen is een vinkje.** Dat staat al in je eigen `SNELSTART_CAPABILITY_MAP.md`:
bij SnelStart zit het "in élk pakket". Wat je erómheen doet — rekencontrole (excl+btw=incl),
bytehash- én semantische duplicaatdetectie, weigeren in plaats van invullen — is wél anders,
en dát verkoop je nergens. Je verkoopt de scan. Je zou de **weigering** moeten verkopen.

**"Je boekhouder kijkt gratis mee" is tafelinzet.** Alles wat je accountantmodule waard is,
zit in wat erbovenop komt: het werkbord over álle klanten, deadlinebewaking, gereedheidsscore,
schrijfsloten. Dat is praktijkbeheer, geen leestoegang — en zo heet het nu niet.

**Geen PSD2 is fataal — in de generieke categorie.** Moneybird prijst zijn abonnementen op het
aantal automatisch verwerkte banktransacties [ongetoetst]. Jouw bestandsimport is in dat
prijsmodel de gratis variant.

**De kennisbank als acquisitiemotor is te zwaar belast.** De koptermen zijn bezet door ~20
affiliate-vergelijkers die per lead betaald krijgen [ongetoetst]. Een team zonder kapitaal kan
dat per definitie niet overbieden.

### Waar je je vergist

**"Wat ons onderscheidt is niets."** Dat is een vergelijking van featurelijsten, en daar heb je
gelijk. Maar het ding dat je gebouwd hebt staat op geen featurelijst. Uit `card-reconcile.ts`,
als commentaar bij je eigen code:

> _"de oude reconcileDay vergeleek bruto-kassa direct met netto-bank en slikte, om een
> dagelijkse valse breuk te vermijden, het verschil in een tolerantie — waarmee de
> acquirer-commissie stilzwijgend verdween (winst overschat)."_

Dat is geen kasboekje. Dat is Been A (`kassa-PIN bruto == EFT bruto` — een breuk hier is een
échte discrepantie: ontbrekende bon, terminalfout, diefstal) en Been B (`EFT bruto − bank netto
= commissie` — een kostenpost die vandaag bij veel winkels nergens geboekt staat), met een
afwikkelingsvenster T+0..T+5 dat twee motoren moeten delen omdat ze anders ruzie krijgen over
welke dag een uitbetaling toebehoort. Zes pure modules, ~135 tests, gecontroleerd op echte
bestanden van een echte winkel.

**Je onderschat wat dat is, en overschat tegelijk hoe ver het staat.** Het is één winkel, één
acquirerformaat (Equens CTAP), twee dagen. Dat is een sterk signaal en geen bewijs.

**Je denkt dat SnelStarts breedte een voorsprong is.** Voor een kaart- en kasgedreven microzaak
is het merendeel van die breedte dood gewicht — dat heeft je eigen §6 goed. Het probleem is
niet dat SnelStart méér kan. Het probleem is dat SnelStart er al **staat**, bij het kantoor.
Dat is een distributieprobleem, geen productprobleem, en die twee vragen totaal verschillende
oplossingen.

**En één gevaarlijke:** je eigen instap-analyse zegt dat SnelStarts inStap-trede (± € 14,50)
"exact onze doelgroep en exact onze belofte" is — mét PSD2 en scan & herken inbegrepen. Zolang
BoekBrug zich als goedkoop compleet pakket positioneert, is dat geen partner maar de directe
concurrent, en dan verlies je op prijs én op functies tegelijk.

---

## 3. Het landschap

Betrouwbaarheid: **[V]** meervoudig bevestigd · **[O]** ongetoetst, secundaire bron ·
**[T–]** door de toetsing gegaan en teruggekomen als *onbevestigd*.

| Speler | Doelgroep | Prijs/mnd | Waar BoekBrug tegenaan loopt |
|---|---|---|---|
| **SnelStart** | Kleine handelaren + hun kantoor | inStap ± € 14,50 [O] | Hun instaptrede ís jouw propositie, mét PSD2 en scan & herken. En het kantoor draait er al op |
| **Moneybird** | ZZP-dienstverlener | € 0 / 15 / 28 / 39 [T–] | Prijsdifferentiatie zit óp automatische banktransacties. NL/EN/DE-interface [O] — de "Engelse flank" is niet onverdedigd |
| **e-Boekhouden** | ZZP + MKB, prijsvechter | € 7,95 / 13,90 / 24 [T–] | Sinds 2003, telefonische support; zou een dagomzetscherm hebben dat kas én PIN boekt [T–] |
| **Jortt / Tellow / Rompslomp / Fiskr / MoneyMonk** | ZZP, gratis instap | € 0 → 20–33 [O] | Zes gratis tiers. Een betaald generiek instapproduct is dood bij aankomst |
| **Reeleezee** | Retail/horeca mét kassa | € 29–89, bronnen spreken elkaar tegen [O] | De dichtstbijzijnde positionering die bestaat — duur, en mét kassa en voorraad |
| **Exact Online** | Via het kantoor | vanaf € 49 [O] | Meest gebruikte pakket in de NL-accountancy [O]. Elke serieuze voorbewerkingspartij koppelt ermee. Jij niet |
| **Basecone** (Wolters Kluwer) | Kantoren, voorbewerking | ± € 7,50/administratie [O, deels 2017–2021] | Geen zichtbare onvredegolf om op mee te liften |
| **TriFact365** | Kantoren, voorbewerking | € 2,50 → 0,99/administratie [O]; 11 koppelingen | Het bewijs dat toetreden kán — en de reden dat die wig al geslagen is |
| **Zenvoices** | Kantoren, conversie | ± € 0,09/factuur [O] | Documentherkenning wordt in centen per stuk afgerekend |
| **Winkelboekhouding.nl / Mplus / Lightspeed-connectors** | Winkel/horeca | ± € 15/mnd koppeling [O] | **De echte tegenstander van weg A.** Zij boeken dagstaten mét betaalwijzesplitsing door |
| **A2X / Link My Books / Synder** (internationaal) | E-commerce | vanaf ± $ 25–29 per kanaal/mnd, oplopend tot $ 1.039 [V, juli 2026] | Dezelfde vorm — settlement → grootboek, fee als aparte kostenregel — maar voor webshops, niet voor fysieke terminals |

**Wat deze tabel niet bevat, en dat is het belangrijkste eraan:** geen marktaandelen, geen
betalende-klantaantallen, geen churn, geen CAC. Die bestaan niet publiek voor deze markt. Elk
plan dat op marktaandeel steunt, steunt op niets.

---

## 4. De categorie-vraag

BoekBrug zit vandaag in **drie** categorieën tegelijk, en in twee ervan verliest het per
ongeluk van partijen die honderd keer zoveel geld hebben.

**Categorie 1 — boekhoudpakket voor ZZP (€ 0–25).** Vijftien tot dertig actieve spelers, zes
gratis tiers, PSD2 als tafelinzet, en een zoekpagina die eigendom is van affiliates. Je verliest
niet op product; je verliest op rij één van de tabel en op advertentiebudget.

**Categorie 2 — publieke rekentools en "factuur maken".** Hier is je tegenstander Adobe en
Canva. Dat is geen moeilijke strijd, dat is een verkeerde strijd.

**Categorie 3 — voorbewerking richting het grootboek van het kantoor.** De prijsvloer is
€ 2–3 per administratie [O] en het toegangscriterium is het **aantal koppelingen**, niet de
herkenkwaliteit: TriFact365 heeft er elf. Jij hebt er één, en die is nog niet aan.

**De kleinste categorie die BoekBrug kan wínnen in plaats van meedoen:**

> **De dagafsluiting van een kaart- en kasgedreven winkel of horecazaak, aangeleverd als
> kloppende boeking in het pakket waar zijn boekhouder al in werkt.**

Niet "boekhouden". Niet "bonnen scannen". Het afsluiten van een dag waarvan drie bronnen — de
kassa, de terminal, de bank — verschillende bedragen noemen, en het aanwijzen wélke van de drie
liegt.

**Twee nuchterheden daarbij.** De internationale spelers (A2X, Link My Books, Synder) doen
precies deze vorm voor webshops, geverifieerd, vanaf ± $ 29 per kanaal per maand. Dat is
tegelijk goed nieuws — **de betalingsbereidheid voor settlement-afletting is bewezen, en tien
keer hoger dan een prijs van € 2–5 per administratie** — en slecht nieuws: je slotgracht is
lokalisatie naar Nederlandse fysieke terminals, geen uitvinding. En de standaardoplossing van
de markt bestaat al: de betaalwijze op een **tussenrekening** boeken en die periodiek
controleren (zo legt Jortt het zelf uit) [V]. Het verschil tussen "een tussenrekening die
niemand narekent" en "een dag die klopt" is precies jouw product — en precies wat je bij tien
kantoren moet toetsen voordat je er iets op bouwt.

---

## 5. Het oorspronkelijke idee, opnieuw gewogen

> _"De kleine klant maakt een factuur, ontvangt een factuur, en die bereikt de boekhouder."_

Alle drie de schakels zijn in 2026 gratis onderdeel van andermans product. Als bedrijf op
zichzelf is deze keten **geen bedrijf meer** — het is een functie in het product van iemand
anders, en die iemand geeft hem weg om er iets anders mee te verkopen.

Maar er zit één woord in dat van betekenis is veranderd: **"bereikt"**.

Toen betekende het: de boekhouder krijgt het bestand. Daarmee concurreer je met een gedeelde map
en een e-mail, en dat verlies je. Nu betekent het: **het staat als kloppende boeking in het
pakket waar hij in werkt.** Dat is een andere belofte, en het is precies de belofte die
`snelstart-mapping.ts` waarmaakt — mits de sleutel er komt.

Dus: het idee overleeft, maar met een ander werkwoord, en dan is het geen keten meer maar een
**bewijs**. Wat de winkelier niet kan en zijn boekhouder uren kost, is niet het máken van de
factuur. Het is aantonen dat een periode klopt terwijl kassa, terminal en bank drie
verschillende getallen roepen.

**En één cijfer dat je waarschijnlijk verkeerd leest.** Contant was in 2025 nog 17% van de
toonbankbetalingen; 83% ging per kaart [V, DNB/Betaalvereniging]. Dat lijkt het einde van een
"kas"-positionering. Het is het omgekeerde: jouw driehoek is een **kaart**driehoek. Been B — de
commissie — bestaat alleen omdát er met kaarten betaald wordt. Elke euro die van kas naar kaart
schuift maakt dat probleem **groter**.

**Maar met een harde randvoorwaarde die de eerste versie van dit stuk miste:** dit geldt alleen
bij **netto-afrekening**, waar de acquirer de commissie van de uitbetaling aftrekt. Rekent de
acquirer bruto uit en factureert hij de kosten apart (je eigen code anticipeert daarop met
`netCommissionToBook` en `ACQUIRER_VENDOR_RE`), dan is Been B nul en valt er niets te vinden.
Je markt is dus niet "kaartzware winkels" maar "kaartzware winkels **op een
netto-afrekencontract**" — een onbekende deelverzameling van een al onbekende verzameling.

**En over de btw op die commissie: het argument is zwakker dan de repo beweert.** Twee plekken
in je eigen code zeggen "a real cost + reclaimable BTW" (`eft-parser.ts:12`,
`RECONCILIATION_TRIANGLE.md:12`), terwijl regel 55 van diezelfde notitie zegt "commission has no
BTW". Het fiscale beeld: betalingsverkeer is in beginsel btw-**vrijgesteld** (art. 11 lid 1 sub
j Wet OB) — geen btw om terug te vragen — maar terminalhuur is dat níét, en een uitspraak uit
2023 oordeelde dat puur technisch-administratieve verwerkingsdiensten buiten de vrijstelling
vallen [V]. Het antwoord hangt dus af van wat er precies op de acquirerfactuur staat. **Leid je
verkoopgesprek daarom met "je winst is overschat", niet met "je laat btw liggen"** — en zoek
het uit op één echte acquirerfactuur voordat het in een pitch komt.

---

## 6. De wegen — vier, niet drie

### Weg A — De dagafsluiting, verkocht aan het kantoor _(richting: goed)_

**Klant.** Het administratiekantoor met 10–40 winkel- en horecaklanten. Het kantoor betaalt,
niet de winkelier.

**Belofte.** "Je krijgt de dagstaat kloppend aangeleverd. Kassa, terminalafslag en
bankuitbetaling zijn tegen elkaar afgezet, de commissie is geboekt in plaats van weggetolereerd,
en wat niet klopt staat als uitzondering op één lijstje."

**Wat het echt vraagt** (de eerste versie van dit stuk had dit te rooskleurig):
- Breedte in de import: de EFT-parser kent één acquirerformaat. Mplus, Lightspeed, CCV,
  Worldline, unTill moeten erbij.
- **Wél een bankbestand per klant per maand.** De eerste versie schreef "geen PSD2 nodig"; dat
  is half waar. `card-reconcile.ts` zegt zelf dat de netto bankuitbetaling optioneel is — maar
  zonder die regel bestaat Been B niet, en Been B ís het verkoopargument. Bij 40 klanten is dat
  40 handmatige uploads per maand. Onderzoek eerst of SnelStarts eigen API bankmutaties
  teruggeeft; dan is die getuige gratis. Eén middag in hun documentatie beslist dit.
- Multi-tenant onboarding is **geen opsommingsteken maar een datamodelwijziging**:
  `accountant-access.ts` koppelt per `zzper_id`, elke winkelier heeft een eigen account nodig,
  en de maatwerksleutel geldt per administratie. De betaler is niet de accounthouder.
- Twee onbeantwoorde vragen: mag een administratie die bij een kantoor in beheer is een
  maatwerksleutel afgeven, en zit Maatwerk/B2B überhaupt in de inStap-trede? Als het antwoord
  "vanaf inKaart" is, kost jouw oplossing de winkelier eerst een duurder SnelStart-abonnement.

**Verdedigbaarheid.** Redelijk — maar niet door intellectueel eigendom. Door vieze details
(afwikkelingsvertraging, DAT-datum uit de bankomschrijving, commissie-attributie naar de juiste
dag, splitsing per kaartschema) en door iets wat je nergens verkoopt: **het systeem doet liever
niets dan iets onwaars** (blokkade bij onbekend btw-tarief, `detect-file.ts`, `import-health.ts`,
schrijfsloten, centgrens van twee cent). Het kantoor draagt de aansprakelijkheid. Dát is de
verkoopreden. De echte slotgracht is verder desinteresse: dit segment is te klein voor de
aandacht van een grote speler — een echte slotgracht en een slecht compliment tegelijk.

### Weg B — Brede voorbewerking voor kantoren (de TriFact365-route) _(afraden)_

Vereist Exact Online, daarna Twinfield en AFAS, plus XAF 3.2-auditfile en RGS-mapping —
`grep` op `xaf`, `auditfile` en `rgs` levert **nul** treffers in `src/`. Maanden werk voordat je
mag meedoen, tegen een prijsvloer van € 2–3 [O], zonder onvredegolf om op mee te liften.

### Weg C — Goedkoop compleet ZZP-pakket (de huidige koers) _(afraden)_

Vraagt PSD2 (AISP-partij, terugkerende kosten), btw-indiening (Digipoort of
fiscale-dienstverlenerstatus), een Peppol-toegangspunt (ISO 27001 vereist in NL [O], instapprijs
nergens te vinden) en Engels in de applicatie zelf — vandaag staat `lang="nl"` hard in
`layout.tsx`, bestaat Engels alleen voor de publieke tools en de blog, en zijn `'ar'` en `'tr'`
in `preferred_language` een databasekolom die door **geen enkele regel code** wordt gelezen. Je
concurreert tegen zes gratis tiers. Verdedigbaarheid: nul.

### Weg D — Weg A, maar eerst als dienst _(de uitvoerbare vorm — dit ontbrak volledig)_

Verkoop de dagafsluiting als **betaalde dienst** aan 3–5 kantoren, met de code als jouw interne
gereedschap. Self-service pas daarna.

- Geen abonnementsincasso nodig: KvK, factuur, IBAN. Je product kán al factureren.
- Geen multi-tenant onboarding nodig.
- **Geen subscription key nodig om te beginnen** — een exportbestand volstaat. Daarmee verdwijnt
  je grootste enkelvoudige afhankelijkheid uit het kritieke pad, en wordt de SnelStart-koppeling
  een margeverbetering in plaats van een blokkade.
- Het risico "elke winkel is maatwerk" draait om van kostenpost naar omzet: elke nieuwe
  kassa/terminal die je met de hand verwerkt is een klant die betaalt terwijl jij de parser
  schrijft.
- Het levert het enige ontbrekende getal: wat kost een dagafsluiting werkelijk, en wat wil een
  kantoor ervoor betalen.

Ja, dit is consultancy en het schaalt slecht. Dat is niet de faalmodus — **het is de goedkoopste
manier om te ontdekken of het product bestaat.**

### Weg E — De motor licentiëren _(minstens één telefoontje waard)_

TriFact365, Zenvoices, een kassaleverancier, een acquirer, of SnelStart zelf. Zij hebben
distributie en geen begrip van kas/PIN; jij het omgekeerde. Als het segment klein genoeg is om
hun aandacht niet te trekken, is het ook klein genoeg om te licentiëren in plaats van na te
bouwen. Het is de enige weg waarvan de uitkomst niet afhangt van jouw verkoopvaardigheid als
eenpitter.

---

## 7. Aanbeveling

**Richting A, vorm D, met E als parallel telefoontje.**

Niet omdat de markt groot is — hij is klein en niemand weet hoe klein — maar omdat het de enige
richting is waar het gebouwde vóórsprong is in plaats van achterstand.

Hernoem het product in je hoofd van "boekhouding voor kleine ondernemers" naar **"dagafsluiting
voor kaartgedreven zaken, geleverd aan hun kantoor"**. Verkoop niet aan winkeliers maar aan
kantoren. En prijs **niet per administratie**: € 2–5 per administratie is een gesprek dat je
niet wint. Test € 150 per kantoor per maand, of per vestiging zoals de internationale spelers —
dat is hetzelfde bedrag en een veel makkelijker gesprek.

**De tegenwerpingen, en ik kan ze niet wegnemen:**

1. Ik beveel de enige weg aan waarvan de markt **niet te meten** is. Het aantal kaartzware
   microzaken mét externe boekhouder, zónder integreerbare kassa, óp een netto-afrekencontract
   is nergens vastgesteld. Weg C heeft een meetbare markt van 1,2–1,8 miljoen — en daarin
   verlies je aantoonbaar. Ik kies een onmeetbare markt boven een meetbaar verlies. Wie zegt
   dat dat geen gok is, liegt.
2. Het dossier spreekt zichzelf tegen over wie de software kiest: 16% via de boekhouder tegen
   49,3% via eigen Google-onderzoek [O], terwijl een ander spoor precies het omgekeerde beweert.
   De hele kanaalstrategie hangt hieraan. Mijn vermoeden — dienstverlenende ZZP'ers googelen,
   winkeliers met een schoenendoos volgen hun kantoor — is redenering, geen bevinding.
3. **De grootste ontbrekende aanname ben jij.** De git-historie toont één menselijke auteur
   (`mofwim`, 80 commits) naast AI-assistentie (131 commits). Nergens in dit hele onderzoek
   staat hoeveel tijd je hebt, of je inkomen hebt, en hoelang je zonder omzet kunt. "Eerste
   betalend kantoor in 3–6 maanden" (realistischer 6–9: kantoren beslissen niet tijdens
   aangifteperiodes) is onbeslisbaar zonder die twee getallen. En reken de uitkomst kaal door:
   10 kantoren × 25 administraties × € 4 = **€ 1.000 per maand, na 12–18 maanden**.

---

## 8. Stoppunten — meetbaar, met volgorde

| # | Binnen | Waarneming | Als dit gebeurt |
|---|---|---|---|
| **0** | 14 dagen | **Geen rechtspersoon.** `/voorwaarden` en `/privacy` staan live met `[JOUW NAAM]` en `KVK-nummer [INVULLEN]`. Geen kantoor tekent een verwerkersovereenkomst met een placeholder; Stripe/Mollie-KYC vraagt een KvK-nummer; art. 3:15d BW eist identificatie | Blokkeert **alle** wegen. Kost een middag. Doe dit eerst |
| **0b** | 14 dagen | **De gepubliceerde prijslijst spreekt de strategie tegen.** De AV §5.1 noemt Pro € 25 en Pro+ € 45 "inclusief bankkoppeling (PSD2 — binnenkort beschikbaar)"; die PSD2 bestaat niet en vereist een AISP-partij. En de database kent een ánder viertrapsmodel (`free/pro/boekhouder/boekhouder_pro`) dan de AV | Corrigeer of verwijder vóór het eerste kantoorgesprek |
| **1** | 30 dagen | **Eén handmatig gefactureerde en ontvangen euro.** Niet: een werkende Stripe-integratie. Stripe komt na klant 3 | Zonder dit is alles theorie — maar bouw geen incasso vóór klant 1 |
| **2** | 30 dagen | **Wordt het probleem gevoeld?** Spreek 10 kantoren met winkel-/horecaklanten: hoeveel uur per kwartaal kost zo'n dagafsluiting, en wie betaalt die uren? Minder dan 3 van de 10 noemt het een terugkerende kostenpost | Weg A vervalt. Het gat bestaat technisch, niet economisch |
| **3** | 30 dagen | **Subscription key aangevraagd én toegekend** voor dit gebruik | Zo nee: weg A draait op export, koppeling terug naar de bijlage |
| **4** | 60 dagen | **Netto of bruto?** Van 10 winkels: hoeveel hebben een netto-afrekencontract? | Onder de 5: Been B is geen product |
| **5** | 60 dagen | **Zit er geld in?** Reken in 10 administraties uit hoeveel commissie er níét geboekt is. Mediaan onder ± € 250/jaar. Splits apart: ís die commissie btw-belast? | Zonder bedrag is het een technische fijnigheid, geen verkoopreden |
| **6** | 60 dagen | **Import-maatwerkhel.** Verzamel 10 echte Z-rapporten en 10 terminalafslagen uit 10 zaken. Minder dan 6 parsen zonder nieuwe code — én tel de OCR-faalgevallen apart | Dan is dit een dienst (weg D), geen product. Dat is een keuze, geen ramp |
| **7** | 90 dagen | **Is het al opgelost?** 3 of meer van de 10 kantoren zeggen "dat doet onze kassakoppeling al". Bel ook Lightspeed/Mplus/unTill: nemen zij de **acquirerafrekening** mee? | Het onderscheid bestaat niet. Terug naar de tekentafel, niet naar meer bouwen |
| **8** | 90 dagen | **Prijstest.** Geen enkel kantoor wil ≥ € 150/maand (of ≥ € 5/administratie) toezeggen | Bij € 2–3 met een handmatige verkoopbeweging sluit de rekensom niet |

---

## 9. Kanalen die nergens genoemd werden

- **NOAB / SRA / Fiscount.** Koepels van administratie- en belastingadvieskantoren, met
  nieuwsbrieven, bijeenkomsten en softwarevoorkeuren. **Eén bijeenkomst is meer kantoorcontact
  dan een jaar SEO** — en het is de goedkoopste uitvoering van stoppunt 2.
- **De acquirer en de kassaleverancier.** CCV, Worldline, Rabo SmartPin, SumUp en de
  kassabouwers hebben de lijst van "kaartzwaar, geen integreerbare kassa" en verkopen al aan
  jouw doelgroep, zonder boekhoudproduct. Je noemt dit zelf een distributieprobleem en noemde
  vervolgens geen enkele distributiepartner.
- **De longtail van de kóper, niet van de gebruiker.** Je kennisbank mikt op "boekhoudpakket
  zzp" — bezet door affiliates. De zoektermen van je koper zijn "pinomzet klopt niet met kassa",
  "afrekening Worldline boeken", "acquirerkosten boeken btw", "dagstaat horeca boeken",
  "kasverschil verklaren Belastingdienst". Dat is longtail die niemand monetiseert, gezocht dóór
  een boekhouder mét het probleem. Dat is wél een kanaal, en het is het enige goedkope dat je hebt.

---

## 10. Kosten die in geen enkel scenario stonden

Claude-API per document (`ai.ts` draait op Haiku 4.5; EFT-bonnen lopen via transcriptie) — bij
€ 2–5 per administratie is dat een marge-eter zodra een winkel 200+ documenten per maand
aanlevert. Zeven jaar bewaren zoals je privacyverklaring belooft — opslag die dóórloopt na
opzegging, per klant, én juridisch discutabel omdat de fiscale bewaarplicht op de ondernemer
rust, niet op jou. Supabase, Vercel, Resend, Sentry, domein. Aansprakelijkheidsverzekering: je
schrijft boekingen in de administratie van een derde en je AV beperkt aansprakelijkheid tot
€ 1.000 — een kantoor accepteert dat niet zonder gesprek. Plus het papierwerk dat je wél hebt
ook zonder AISP/Digipoort/ISO: verwerkersovereenkomst als subverwerker van het kantoor, de vraag
"gaan onze klantgegevens naar een Amerikaans AI-model?" (die krijg je in élk gesprek), en een
securityvragenlijst bij grotere kantoren.

---

## 11. Wat we niet weten

**Fouten die in de eerste versie van deze studie stonden en hier gecorrigeerd zijn:** dat de
SnelStart-koppeling live is (nee — hij wacht op een sleutel), dat er geen betaalcode of
prijslijst bestaat (er ís een gepubliceerde prijslijst met € 25/€ 45 en een `subscription_stripe_id`
in het datamodel), dat de commissie terugvorderbare btw draagt (waarschijnlijk niet, en de repo
spreekt zichzelf tegen), dat weg A geen bankregel nodig heeft (nodig voor Been B), en dat "geen
enkele partij dit doet" (internationaal bestaat de categorie wél).

**Wat het onderzoek expliciet niet vond:** marktaandelen, betalende-klantaantallen, churn, ARPU
of CAC voor NL-boekhoudsoftware (bestaan niet publiek). De prijs van reseller- of
white-labeltoegang tot een Peppol-toegangspunt. De omvang van het kaart/kas-zware
microsegment. Of kantoren software doorbelasten en met welke marge. Een actuele officiële
Basecone-prijs. De doorlooptijd van een softwarebeslissing bij een klein kantoor. Enige
betalingsbereidheid voor taal als zodanig — geen onderzoek, geen data, geen prijspremie.

**Interne tegenspraken die niemand oploste:** het aantal ZZP'ers (1,167 mln CBS hoofdbaan Q4-2025
/ "bijna 1,5 mln" CBS Q1-2026 / 1,805 mln KVK 30-6-2026 — drie tellingen, drie definities); of
de ondernemer of de boekhouder kiest; en of e-Boekhoudens dagomzetscherm bestaat (de claim die
je nis zou doden kwam onbevestigd terug — maak zelf een proefaccount aan).

**Eén ding dat je nooit in een pitch moet zetten:** er is **geen** Nederlandse
e-facturatieverplichtingsdatum. Meerdere hoog scorende blogs presenteren 1-1-2027 en 1-1-2028
als Nederlandse wet; dat zijn Duitse data. (Daar ligt wel een gratis kans: één accurate,
gedateerde, bronvermeldende pagina in een markt waar de bestaande content aantoonbaar fout is.)

### De drie vragen die alleen een gesprek beantwoordt

1. **Aan een kantoor met winkelklanten:** hoeveel uur per kwartaal gaat er in de dagafsluiting
   van zo'n klant, en eet het kantoor die uren of factureert het ze door? Dit is het enige getal
   dat je prijs bepaalt en het staat in geen enkele bron.
2. **Aan datzelfde kantoor:** wat doe je vandaag als de PIN-uitbetaling niet klopt met de kassa?
   Is het antwoord "we zetten het op een tussenrekening en kijken niet om", dan bestaat het
   probleem wel maar is er geen koper.
3. **Aan tien winkeliers:** wie koos je software — jij of je boekhouder?

---

**Slotsom.** Je vroeg waar BoekBrug staat. Antwoord: als generiek boekhoudpakket sta je nergens
en is er geen weg terug in die richting. Als leverancier van één bewijsbaar kloppende
dagafsluiting sta je op iets wat geen Nederlandse concurrent heeft — bewezen op één winkel, nog
niet verkocht aan één klant, gebouwd door één persoon, zonder rechtspersoon eronder. Dat is geen
groot bedrijf en ook geen mislukking. Het is een hypothese die tien telefoongesprekken en één
middag notariswerk verwijderd is van "waar" of "onwaar" — en er is geen enkele reden om die tien
gesprekken nog langer uit te stellen voor meer code.
