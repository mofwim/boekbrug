# Clips voor social — wat er klaarstaat en hoe je het maakt

`npx tsx scripts/record-clips.mts` maakt verticale schermopnames van de app. Geen opnameprogramma,
geen montage: het pad staat in code, en één commando maakt alles opnieuw.

```bash
npx next build && npx next start -p 3100        # in één shell
npx tsx scripts/record-clips.mts                # in een andere
```

Uitvoer: `store-assets/clips/*.mp4`, 1080×1920, H.264 — het formaat dat Reels, Shorts en TikTok
native tonen.

## Waarom gegenereerd en niet gefilmd

Een productvideo veroudert stil. Hij blijft staan waar hij is gepost, blijft een scherm tonen dat
niet meer bestaat, en niemand merkt het. Dat is precies wat `capture-screenshots.mjs` voor de
storefoto's oploste — dit is dezelfde machine met beweging erbij. Verandert een scherm, dan draai je
het commando opnieuw en zijn alle clips weer waar.

## De demo-administratie, nooit een echte

Een video verraadt méér dan een foto: scrollen toont rijen, een autocomplete toont klantnamen, het
bankscherm toont IBAN's en omschrijvingen. `scripts/seed-demo-account.sql` maakt een tenant van
verzonnen gegevens voor precies dit doel — dezelfde die Play Console als testaccount wil.

```bash
SHOT_EMAIL=demo@boekbrug.nl SHOT_PASSWORD=… npx tsx scripts/record-clips.mts
```

Het wachtwoord staat hier niet, en dat is geen slordigheid maar de afspraak die
`docs/PLAY_STORE_LISTING.md` al volgde: deze repository is openbaar. Het staat in de
wachtwoordkluis, en `scripts/seed-demo-account.sql` leest het uit `DEMO_PASSWORD`.
Het account is bovendien afgeschermd — zie `src/lib/demo-tenant.ts`: er gaat geen mail
naar buiten en er wordt niets ingelezen, want een openbaar wachtwoord beschermt zichzelf
niet.

Dat levert vier clips extra op: **klaar**, **aangifte**, **bank** en **brug** — de vier schermen
waar het product zijn belofte waarmaakt.

Twee dingen die je één keer nodig hebt:

```bash
npm i -D ffmpeg-static     # anders blijven de clips .webm, en dat accepteert Instagram niet
```

En de sessie wordt op de SERVER bepaald (`dashboard/layout.tsx` en elke pagina zelf), dus de machine
waar je dit draait moet de Supabase-host kunnen bereiken. Lukt dat niet, dan zegt het script dat met
zoveel woorden en slaat de dashboard-clips over — het filmt nooit stilletjes het inlogscherm.

Zonder die twee variabelen draaien alleen de vier publieke clips. Die hebben geen account nodig en
draaien overal — ook op een CI-doos die de Supabase-host niet mag bereiken (inloggen gebeurt in de
BROWSER, dus die moet erbij kunnen; zie dezelfde noot in `PLAY_STORE_LISTING.md`).

## Twee soorten clip, en het verschil is niet cosmetisch

| | Werving (01–04) | Uitleg (10) |
| --- | --- | --- |
| Voor wie | iemand die de app niet heeft | iemand die al is blijven kijken |
| Begint bij | een probleem | een taak, van begin tot eind |
| Waar | Reels, Shorts, TikTok, LinkedIn | in de app, de kennisbank, YouTube |
| Lengte | 9–15 seconden | 30–40 seconden |
| Balk bovenin | de merknaam | "stap 2 van 4" |
| Zin blijft staan | 1,8–2,2 s | 2,2–2,7 s |

Op social wil niemand een rondleiding langs knoppen van software die hij niet gebruikt. Daarom
beginnen 01–04 bij een vraag die de kijker zelf heeft, en laten ze het antwoord zien in plaats van
het uit te leggen.

**Een uitleg is geen langere werving.** Dat verschil is gemeten en niet bedacht: hetzelfde pad
(factuur maken) op vijftien seconden geperst wordt een flikkering waarin je ziet dát er getypt
wordt en niet wát. Drie dingen maken er uitleg van, en ze staan alle drie expres in de code:

- **de balk telt de stappen**, zodat je altijd weet waar je bent — zonder die balk lijkt veertig
  seconden één lange handeling en weet wie halverwege instapt niet of hij iets heeft gemist;
- **elke zin blijft ruim twee seconden staan**, want hij moet gelezen worden, niet opgevangen;
- **na elk resultaat valt een stilte**, zodat het oog kan landen op het getal dat net veranderde.

En het pad eindigt niet willekeurig. Het eindigt bij het btw-tarief, want dát is het moment waarop
te zien is dat de app RÉKENT en niet alleen een formulier toont: 21% wordt 9%, en het totaal
eronder verandert mee terwijl je kijkt. Een uitleg die daar niet komt, heeft niets uitgelegd.

## Onderschriften, niet gesproken tekst

De meeste mensen kijken zonder geluid. De tekst staat daarom IN het beeld, in het merklettertype,
en is niet weg te klikken. Muziek eronder mag; een stem is een extra, geen drager.

En als er ooit een stem komt: één Nederlandse stem, geen synthetische. Dit is een boekhoudapp — de
Nederlandse ondernemer die dit hoort beslist in twee seconden of dit een serieus product is.

## De vier die klaarstaan, met de tekst voor eronder

Kort, geen hashtag-muur, en de laatste regel is altijd dezelfde vraag: probeer het zelf.

**01 · BTW berekenen** — 9 s
> Hoeveel btw zit er op € 1.000?
>
> € 210 erbij, € 1.210 totaal. Zonder account, zonder je bestand ergens heen te sturen — het rekenen
> gebeurt in je eigen browser.
>
> boekbrug.nl/btw-berekenen

**02 · Uurtarief** — 12 s
> "Wat moet ik per uur vragen?"
>
> De meeste zzp'ers rekenen hun jaardoel door 2.080 uur. Dat is precies te weinig: vakantie, ziekte
> en de uren die je niet kunt factureren zitten er niet in. Dit rekent ze wél mee.
>
> boekbrug.nl/uurtarief-berekenen

**03 · Kilometervergoeding** — 9 s
> 4.200 zakelijke kilometers = € 1.050 aftrekbaar.
>
> € 0,25 per kilometer in 2026. Reken je eigen jaar na — het duurt tien seconden en het staat op je
> aangifte.
>
> boekbrug.nl/kilometervergoeding

**04 · Factuur maken** — 15 s
> Een factuur die klopt, zonder programma.
>
> Jij, je klant, je regels. Btw en totaal rekenen zichzelf uit, en je downloadt de PDF. Geen account
> — je gegevens blijven in je browser zolang je er geen maakt.
>
> boekbrug.nl/factuur-maken

## De uitleg-clip, met de tekst voor eronder

**10 · Een factuur maken, van niets tot pdf** — 39 s, 1080×1920

> Een factuur maken duurt geen kwartier.
>
> Jouw naam, je klant, één regel — en het totaal rekent zichzelf uit. Ander btw-tarief? Eén keuze,
> en alles telt opnieuw.
>
> Geen account, geen installatie, geen kosten.
>
> boekbrug.nl/factuur-maken

Deze werkt op YouTube, in de kennisbank en als antwoord onder een vraag in een zzp-groep — plekken
waar iemand al heeft besloten te kijken. Op Reels of TikTok verliest hij het van 01 en 03.

## De rondleiding, veld voor veld

**11 · Een factuur maken, elk veld uitgelegd** — 65 s, 1080×1920

> Elk vakje op een factuur, en waarom het er staat.
>
> Het nummer dat vanzelf doortelt · je KVK en btw-nummer, die er wettelijk op moeten · je klant ·
> wat je hebt geleverd, hoeveel en tegen welk tarief. En onderaan telt alles zichzelf op.
>
> boekbrug.nl/factuur-maken

**Het verschil met clip 10 is niet de lengte maar waar de kijker kijkt.** Zeggen "hier vul je je
klant in" terwijl het hele formulier even hard in beeld staat, wijst nergens naar. Per stap komt één
blok in het MIDDEN te staan en gaat de rest achter een waas — `focusBlock()` doet allebei.

"Het midden" is trouwens niet het midden van het scherm: bovenin staat de stapbalk en onderin de
ondertitel, dus het midden van wat de kijker kán zien ligt hoger. `centerBlock()` rekent dat uit; op
het echte midden mikken zet het blok te laag.

En de velden worden per BLOK geteld, niet over de hele pagina — met een controle op het aantal
(`expectFields`). Een globale index ("het 16e input-veld") verschuift stil zodra iemand een veld
toevoegt: de opname slaagt en filmt het verkeerde vakje, met een bijschrift dat iets anders belooft.
Dat is precies het soort fout dat je pas ziet als de clip al gepost is, dus faalt de opname nu in
plaats daarvan.

## De formule, en waar wij ervan afweken

Opgezocht in september 2026 in plaats van bedacht. Wat elke bron zegt, en wat dat hier veranderde.

| Regel | Bron is eensgezind over | Wat wij deden |
| --- | --- | --- |
| **Pijn vóór functie** | open bij het probleem van de kijker, niet bij het product | clip 10 en 11 openen bij een functie ("elk veld uitgelegd"). **Fout.** Clip 12 opent bij "kost je een half uur, en dan klopt de btw nóg niet" |
| **De eerste 3 seconden** | 2–3 s beslist; gemiddelde kijktijd ligt rond 1,5 s | onze hook stond pas op 1,4 s in beeld — de hele gemiddelde kijktijd was een stilstaande paginakop. Staat er nu op 0,4 s |
| **Onder de 60 s** | betrokkenheid zakt scherp voorbij een minuut; <60 s haalt ±52% | clip 11 duurt 65 s. Clip 12 doet hetzelfde in 53 |
| **Ondertitels ingebrand** | autoplay staat stil; 4–7 woorden, hoog contrast | deden we al — dit is het enige punt waarop we vooropliepen |
| **Het échte product** | Notion en Figma landen omdat je het gereedschap écht ziet werken | doen we al: gegenereerd uit de draaiende app, geen namaak |
| **Eén boodschap** | één ding per film | clip 11 legt vijf blokken uit; clip 12 legt uit dat het rekenen vanzelf gaat |
| **Bewijs aan het eind** | sluit met het resultaat, niet met nóg een functie | clip 12 eindigt op het tarief dat verandert en de bedragen die meelopen |

En drie dingen uit het ambacht van schermopnames die hier ontbraken:

- **Een muisaanwijzer.** Playwright neemt er geen op. Al onze clips lieten dus dingen *vanzelf*
  gebeuren: velden lichtten op, een keuzelijst versprong, zonder dat te zien was dat iemand klikte.
  Er wordt er nu één getekend, met een rimpel bij elke klik — hetzelfde wat Screen Studio en
  soortgelijk gereedschap doet, en om dezelfde reden: een handeling moet gemótiveerd lijken.
- **Zoomen op het veld dat wordt genoemd.** Gebouwd, geprobeerd en er weer uit: op een blok dat al
  is uitgelicht én gecentreerd voegde de zoom onrust toe in plaats van aandacht, en hij sneed de
  zijkanten van de regel af — juist de kolom met het bedrag. De schijnwerper doet het werk al.
- **Telefoonbreedte.** 540 CSS-pixels is geen telefoon: een iPhone is er 390 tot 430 breed. Op 540
  opnemen en naar 1080 schalen levert een beeld dat een kwart kleiner oogt dan wat een échte
  telefoon van dezelfde pagina toont — precies op de cijfers. Clip 12 neemt op 432×768 op, exact
  1080×1920 gedeeld door 2,5.

**Wat we NIET hebben overgenomen.** De bronnen raden een voice-over aan (Stripe leunt erop). Dat
blijft hier staan zoals het stond: de meeste mensen kijken zonder geluid, en een synthetische stem
op een boekhoudapp kost meer vertrouwen dan hij aan begrip oplevert. Een echte Nederlandse stem is
een aanvulling voor later, geen drager.

**Clip 11 blijft staan naast 12, en dat is opzet.** 11 legt élk veld uit voor iemand die het gaat
doen; 12 is de wervende versie van hetzelfde pad. De formule hierboven gaat over werving. Een
handleiding mag langer, trager en saaier zijn — die wordt gezocht, niet voorgeschoteld.

## De stem — een proef, en wat hij kostte om te bouwen

`CLIP_VOICE=1` legt een gesproken spoor onder de clip. Standaard staat het UIT en dat blijft zo: de
ondertitels dragen de boodschap, want de meeste mensen kijken zonder geluid.

**De stem is nu `espeak-ng` en dat hoor je.** Het is een formant-synthesizer uit een ander tijdperk.
Hij staat er om te horen óf gesproken tekst de uitleg helpt, niet om te publiceren. Een neuraal
model (`piper`, stem `nl_NL-mls-medium`) is de bedoeling en is hier niet te installeren: het
downloaden van de stem gaat langs de egress-proxy en die geeft 403. Op een machine die er wél bij
kan is het één commando, en er hoeft niets aan de tijdlijn hieronder te veranderen — die staat los
van wie er spreekt.

**Wat wél al klopt is het moeilijke deel: de synchronisatie.** Elke `say()` legt vast wanneer hij in
beeld kwam, en het spoor wordt op die tijdstippen gebouwd. Niet uit de som van de `ms`-waarden —
daar zitten typen, scrollen en wachten tussen, en die duren nooit twee keer hetzelfde.

Dat ging de eerste keer mis, en de manier waarop is het opschrijven waard: **de eerste gesproken zin
viel dertien seconden te laat.** Playwright begint pas te filmen bij het eerste getekende beeld, niet
bij het aanmaken van de context — en de navigatie ervóór duurde hier dertien seconden. De eerste
versie trok alleen de afgeknipte aanloop af (`from`), en die was nul. Het nulpunt van de video is
afleidbaar zonder iets aan te nemen: de opname stopt exact bij `ctx.close()`, dus **seconde nul is
dat moment min de lengte van het bestand**.

Nagemeten in plaats van aangenomen, met `silencedetect` op het eindresultaat: eerste spraak op
0,98 s waar de ondertitel op 0,98 s staat, en elke gevonden grens daarna valt op zijn eigen zin.

Een `Beat` mag een eigen `voice` hebben. Een ondertitel is kort omdat lezen tijd kost; een gesproken
zin mag een lidwoord meer hebben, en getallen worden voluit gespeld ("zestienhonderd drieëndertig
euro vijftig") omdat elke synthesizer over "€ 1.633,50" struikelt.

## De gereedschapskist — zestien publieke pagina's die echt werk doen

Zestien publieke pagina's doen echt werk zonder account: pdf's samenvoegen, splitsen, ondertekenen,
verkleinen, foto's schalen, een watermerk erop. Ze delen één vorm — er gebeurt niets tot er een
BESTAND in gaat, daarna verschijnt de bediening, dan een resultaat — dus ze delen ook één definitie
(`toolClip` in `scripts/record-clips.mts`) in plaats van zestien bijna-gelijke clips.

`npx tsx scripts/make-sample-assets.mts` maakt de bestanden die erin gaan: verzonnen inkoopfacturen
en een bonfoto die eruitzien als echt werk. Nooit een document van een echte klant — dezelfde regel
als voor de winkelfoto's, en een video verraadt méér dan een foto.

### Wat het opnemen zelf heeft rechtgezet

Vier dingen die je alleen vindt door te kijken naar wat er is opgenomen:

- **Het bijschrift sprak zijn eigen scherm tegen.** "METEEN TE ZIEN" stond in beeld terwijl de foto
  vierhonderd pixels lager stond. Dezelfde fout zat in de handtekeningclip: de handtekening
  verscheen zonder dat iemand hem zag zetten — het enige moment waar die clip om bestaat. Beide
  clips wisselen nu bewust tussen twee kaders: de knoppen waar je iets doet, en de plek waar je het
  ziet gebeuren.
- **De voorbeeldfoto woog 181 kB.** Onder een clip die vraagt of je foto te groot is om te mailen,
  liet /afbeelding-verkleinen "van 181 kB naar 65 kB" zien — een belofte die het eigen scherm
  tegensprak. Een telefoonfoto van een bon is een paar MB, en die grootte komt van sensorruis, dus
  die zit er nu in.
- **/afbeeldingen-uit-pdf gaf niets terug**, en dat was het JUISTE antwoord: er zat geen enkele
  afbeelding in de facturen-PDF, alleen vectortekst. Daar hoort een gescande PDF bij, en die maakt
  het script apart.
- **Eén verkeerde selector nam vijf goede clips mee.** De opslaanknop van /watermerk-op-foto heet
  `" Opslaan (204 kB)"` — met een spatie ervoor van het icoon, en met een grootte die meebeweegt.
  Een anker (`^`) of een getal in de selector is dus twee keer fout. En een gemiste knop is nu een
  regel in het verslag in plaats van een afgebroken reeks.

### Eén pagina die we bewust NIET filmen

**/factuur-scannen.** Technisch te forceren, en daarom juist niet. De snelheidsbegrenzer is
fail-closed en heeft Supabase nodig; daarna is het een echte, betaalde Anthropic-aanroep. Je kunt
dat wegmokken met `page.route()` en een verzonnen antwoord — en dan toont de clip een AI-lezing die
nooit heeft plaatsgevonden, van een factuur die niet bestaat, als bewijs van een functie die geld
kost. Dat is geen demo maar een bewering. Deze clip komt er pas als hij tegen een echte omgeving kan
draaien.

## Waar te posten

- **LinkedIn** is voor dit publiek waarschijnlijk het sterkst: Nederlandse zzp'ers én de boekhouders
  die met ze werken. De PDF-deck uit `scripts/generate-deck.mts` werkt daar als carrousel; deze
  clips als losse video.
- **Instagram / TikTok** — 01 en 03 zijn het kortst en het makkelijkst te delen.
- **In de app en de kennisbank** — 05 en 06, naast de functie die ze uitleggen.

Lees eerst de regels van een groep voordat je erin post. Een clip op een plek waar promotie niet
welkom is kost meer dan het bereik oplevert.

## Een nieuwe clip toevoegen

Eén item in `CLIPS` in `scripts/record-clips.mts`: een pad, een openingszin, en een `run` die de
pagina echt bedient. `say()` zet een onderschrift, `type()` typt met een menselijk ritme. Zet
`auth: true` als de clip een sessie nodig heeft.

Twee dingen die uit meten zijn gekomen en die je niet zelf hoeft te ontdekken:

- **De opname begint bij het aanmaken van de context**, dus het laden van de pagina staat vooraan in
  het bestand — soms twaalf seconden wit beeld. Dat wordt er automatisch afgeknipt door te KIJKEN
  waar het beeld begint (`negate,blackdetect`), niet door het te berekenen; twee pogingen om het uit
  te rekenen zaten er allebei naast.
- **Scroll naar een element, niet naar een aantal pixels.** Een vast getal schoot voorbij het totaal
  en liet de factuurclip eindigen op de uitleg onderaan de pagina in plaats van op het bedrag dat
  zojuist was uitgerekend.
- **En zet het op OOGHOOGTE, niet "net in beeld".** `scrollIntoViewIfNeeded` doet het minimum, en
  het minimum is meestal onderaan het scherm — precies waar de ondertitelbalk staat. In de eerste
  opname van de uitleg-clip stond het uitgerekende totaal daardoor achter zijn eigen bijschrift:
  € 1.512,50 werd genoemd en was niet te zien. `bringToEyeLine()` zet het op een vaste fractie van
  de viewport en is niet gevoelig voor de lengte van de pagina.

Twee schakelaars die het afstellen doenlijk maken:

- `CLIP_ONLY=uitleg` — maak alleen de clips waarvan de naam dit bevat. Een reeks die vijf minuten
  duurt, stel je niet af.
- `CLIP_FFMPEG=/pad/naar/ffmpeg` — ffmpeg-static is ~80 MB en hoort niet in de dependencies van een
  boekhoud-app; wie hem elders al heeft staan, wijst hem hiermee aan.

En `maxLen` per clip: ruim zetten, niet krap. Het snijden gebeurt aan de staart, dus een te lage
waarde knipt precies de slotzin eraf. De lengte regel je met het tempo van `run`, niet daarmee.
