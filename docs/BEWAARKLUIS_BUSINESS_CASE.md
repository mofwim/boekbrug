# De Bewaarkluis — opslag als inkomstenbron

*De onderbouwing achter `src/lib/bewaarkluis.ts`. Juli 2026.*

> **In één zin.** Opslag kost bijna niets, maar de fiscale bewaarplicht van zeven jaar
> loopt door nadat een ondernemer stopt — en dat maakt de vertrokken klant de enige
> klant die nog een *wettelijke* reden heeft om te betalen.

---

## 1. Waarom dit geen gewoon opslagproduct is

Opslag verkopen als opslag is kansloos. Google geeft 15 GB weg, een externe schijf kost
eenmalig veertig euro, en niemand betaalt maandelijks voor bytes.

De Bewaarkluis verkoopt geen bytes. Zij verkoopt **het enige wat een ondernemer nog moet
kunnen nadat hij overal mee is opgehouden.**

Artikel 52 AWR verplicht de ondernemer zijn administratie zeven jaar te bewaren en op
verzoek te tonen. Die verplichting:

- **overleeft het einde van de onderneming.** Wie in 2026 zijn zaak sluit, moet tot en met
  2033 kunnen leveren;
- **overleeft het einde van de softwarerelatie.** Opzeggen bij SnelStart of BoekBrug maakt
  de plicht niet kleiner;
- **is niet onderhandelbaar.** Anders dan bij elke andere functie in dit product is "ik doe
  het gewoon niet" geen optie die de klant heeft.

Dat is een zeldzame combinatie: een behoefte die *ontstaat* op het moment dat de klant
vertrekt. Elk ander product in deze markt verliest zijn klant bij opzegging. Dit product
begint er.

---

## 2. De kosten, eerlijk uitgerekend

Een winkel die 50 stukken per maand verwerkt, zeven jaar lang:

| | |
|---|---|
| Documenten | 50 × 12 × 7 = **4.200** |
| Gemiddelde grootte na normalisatie | **0,5 MB** (lange zijde 2.500 px, zie `image-normalize-client.ts`) |
| Archief | **≈ 2,1 GB** |
| Opslag bij ± $0,021 per GB per maand, 84 maanden | ≈ **€ 3,30** |
| Ruim verdubbeld voor back-ups en redundantie | ≈ **€ 7** |
| Een paar volledige exports over die zeven jaar | ≈ **€ 0,70** |
| **Werkelijke kosten per gearchiveerd account, hele termijn** | **< € 10** |

Daar komt geen AI bij (een archief wordt niet meer uitgelezen), geen support (er verandert
niets), en geen ontwikkeling (de functionaliteit staat er al: `compliance-vault.ts`,
`/dashboard/kluis`, `/api/kluis/export`).

> ⚠️ **Het GB-tarief is niet geverifieerd** tegen de actuele prijslijst van de leverancier.
> Controleer dat vóór publicatie. De marge is breed genoeg dat het antwoord ook bij een
> factor twee overeind blijft — maar dat is een reden om het na te rekenen, geen reden om
> het over te slaan.

---

## 3. De prijs, en waarom vooruitbetalen geen truc is

**€ 19 per resterend bewaarjaar, in één keer vooruit.** Een zaak die vandaag sluit betaalt
€ 133 voor de volle termijn. Wie liever per jaar betaalt: € 24 per jaar.

Brutomarge ≈ 92%.

Waarom de vooruitbetaling de hoofdvorm is, en niet de uitzondering:

1. **De klant wil het geregeld hebben.** Iemand die zijn zaak sluit gaat geen nieuwe
   doorlopende incasso aanmaken voor een bedrijf dat hij net verlaat. Eén betaling en klaar
   converteert aantoonbaar beter dan een abonnement dat elke maand aan het einde herinnert.
2. **Het is de enige geloofwaardige vorm.** Een belofte van zeven jaar uit de mond van een
   bedrijf dat zelf nog geen jaar bestaat, is alleen eerlijk als het geld er al is. Zolang
   er vooruit is betaald, kan BoekBrug nooit in de positie komen dat het opslag levert die
   niet gedekt is.
3. **Het lagere jaartarief is verdiend, niet weggegeven.** Geen incasso's, geen mislukte
   betalingen, geen herinneringen.

**Boekhoudkundig, en dit hoort een maker van boekhoudsoftware te weten:** een
vooruitbetaling van € 133 is geen omzet van € 133. Het is een verplichting van zeven jaar
die je naar rato verantwoordt (≈ € 19 per jaar). De kas voelt als winst en is het niet.
Wie dat verwart, bouwt een gat in het vierde jaar.

---

## 4. De tweede markt — en die is groter

De vertrokken klant is de voor de hand liggende doelgroep. De interessantere is:

**Mensen die nooit klant waren.**

- de winkel die vorig jaar sloot en wiens administratie op een laptop in een kast staat;
- de ondernemer wiens boekhoudpakket is opgeheven of onbetaalbaar werd;
- de erfgenaam die een onderneming afwikkelt en wettelijk nog jaren moet kunnen leveren;
- het administratiekantoor dat na het beëindigen van een klantrelatie niet weet waar het
  dossier heen moet.

Voor die groep is BoekBrug geen boekhoudprogramma dat zij moeten leren. Het is een
inleverpunt: upload wat je hebt, wij ordenen het per jaar en kwartaal, en het staat er.
Nul productgebruik, nul AI, nul support — pure bewaring.

Dat is de zuiverste vorm van wat hier "passief inkomen" wordt genoemd, en het is een
volstrekt ander verkoopgesprek dan "stap over naar onze software".

---

## 5. De derde vorm: de kantoorkluis

Een boekhouder met zestig klanten heeft zestig keer hetzelfde probleem, en heeft het
*beroepsmatig*: hij wordt aangesproken als een dossier onvindbaar is.

Zestig klanten × € 19 per bewaarjaar = € 1.140 per jaar uit één relatie, zonder support.

**Harde randvoorwaarde:** dit mag het gratis boekhoudersportaal op geen enkele manier
raken. Dat portaal is gratis, ook met honderd klanten, het staat zo in de voorwaarden §5 en
er is een test in `fair-use.test.ts` die verbiedt dat er ooit een grens aan hangt. De
kantoorkluis is een *extra dienst*, nooit een beperking van wat al gratis is.
`KLUIS_NOOIT` in `bewaarkluis.ts` legt dat vast, met een test.

---

## 6. Wat er in de weg staat — de vier eerlijke bezwaren

**"Wie vertrouwt een bedrijf van één jaar met zeven jaar archief?"**
Niemand, en terecht. Daarom zijn de waarborgen geen marketing maar clausules: vooruit
betaald (§5.7.4), 90 dagen aankondiging bij een eigen stop met automatische uitlevering van
ieders archief en terugbetaling naar rato (§5.7.6), en de zin die het hele product
relativeert — *wij zijn je tweede exemplaar, nooit je enige* (§5.7.2). Dat laatste kost
verkoop en is het waard: het is ook gewoon waar.

**"Verkopen jullie compliance?"**
Nee, en dat mag ook niet. De bewaarplicht is en blijft van de ondernemer. Wij verkopen
bewaring en toegankelijkheid, geen vrijwaring. `KLUIS_NOOIT` bevat die regel letterlijk en
een test faalt als hij uit de verkooptekst verdwijnt.

**"En de tien jaar voor onroerend goed?"**
Die geldt echt, en de kluis rekent met zeven. Dat staat in §5.7.3 in plaats van dat het
wordt weggelaten.

**"Hoeveel is dit waard bij de huidige omvang?"**
Nul. Dit product heeft vertrek nodig om te bestaan, en er is nog geen klant om te
vertrekken. Het is een reden om de gratis basis te durven bouwen — niet een reden om te
denken dat er al inkomsten zijn.

---

## 7. Wat er staat en wat er nog moet

**Staat er al:**
`src/lib/bewaarkluis.ts` (rekenkern, 14 tests) · `compliance-vault.ts` +
`/dashboard/kluis` + `/api/kluis/export` (het archief zelf) · `retention-purge.ts` + de
cron (verwijdering ná de termijn, als dry run) · voorwaarden §5.7 en §10.3 ·
`createKluisCheckoutSession()` in `billing.ts` · de pitch op `/prijzen`.

**Moet nog:**

1. Een Stripe-prijs voor één bewaarjaar (`STRIPE_PRICE_ID_KLUIS_YEAR`).
2. Een route die de offerte maakt uit het jongste boekjaar van het account en de checkout
   start; nu bestaat alleen de bouwsteen.
3. `kluis_subscriptions` — wie tot wanneer betaald heeft, zodat de purge weet wie hij
   *niet* mag aanraken. **Dit is de enige harde koppeling: zonder die tabel mag
   `RETENTION_PURGE_ENABLED` nooit op `true`.**
4. De jaarlijkse leesbaarheidscontrole die `KLUIS_WEL` belooft.
5. Het inleverpunt voor de tweede markt (upload van een oud archief zonder verder gebruik).

---

*Verwant: `docs/MARKTPOSITIE_2026.md` §10 (waar deze kostenpost als last werd opgevoerd) ·
`docs/PORT_VAN_BILLING_TAK.md` (wat er uit de billing-tak is overgenomen en wat niet).*
