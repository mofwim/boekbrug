# Jouw lijst — alles wat alleen jij kunt doen

*Bijgewerkt 29 juli 2026. Elk codepunt op deze tak is af, getest en gepusht; wat hier staat
is de rest.*

> **Lees dit als één ding:** de app is vandaag veilig live te zetten. Er wordt niemand
> gefactureerd, niemand buitengesloten en er wordt niets verwijderd, ongeacht wat je van
> deze lijst wel of niet doet. Alles hieronder maakt iets *mogelijk* — geen enkel punt
> repareert iets dat stuk is.

---

## 1. Nu — de migraties zijn af

**☑ Alles wat de veiligheid van je boekhouding raakt, staat erin**
Op 29 juli 2026 gelezen uit je eigen database met `docs/WELKE_MIGRATIES_STAAN_ER.sql` (niet
gemeld, maar gemeten): 10 t/m 17 zijn toegepast. Daarmee zijn beide gaten met een echte
scherpe kant dicht — het IBAN-schrijfgat in de boekhoudersgrens, en het gat waarin twee
gelijktijdige verzoeken dezelfde factuur twee keer in het wettelijke inkoopboek van je
boekhouder konden zetten.

**☐ Eén staat nog open, en die mag wachten: `search_engine_clients_kvk_city.sql`**
Twee trigram-indexen zodat zoeken op KVK-nummer en plaats van een klant een index gebruikt in
plaats van een scan. Het bestand zegt het zelf: *"puur snelheid"* — geen schema-, data- of
gedragswijziging. Zoeken werkt vandaag al. Twee regels, vijf seconden, geen risico; doe het
wanneer je klantenregister groeit, of nu omdat het niets kost.

**⚠ Één ding om NU te controleren — één query**

De ontdubbelings-migratie `documents_content_hash_unique.sql` heeft hier al gelopen (de index
`uq_documents_user_content_hash` bestaat). De versie die toen liep, verwijderde documenten en
spaarde er één alleen als `documents.invoice_id` gezet was — met als argument "geen boekhoudregel
hangt ervan af". Dat argument was fout: er zijn zes verwijzingen naar een document, en vijf laten
`invoice_id` leeg. Een contante bon die aan een kasregel hing, kon dus als wees worden verwijderd.

Deze query zegt of dat is gebeurd:

```sql
select id, entry_date, amount, btw_rate, description
  from public.cash_entries
 where category = 'kosten' and btw_rate is not null and document_id is null
 order by entry_date;
```

**Nul rijen = er is geen contante bon geraakt.** Dat is het verwachte antwoord: byte-identieke
duplicaten zijn zeldzaam (twee foto's van dezelfde bon hebben verschillende bytes), dus dit treft
vooral een tweemaal geüploade PDF.

Komt er wél iets uit, dan is dat sluitend bewijs — deze toestand kan de app niet maken
(`/api/cash/route.ts:119` zet het tarief op null zodra er geen bon is). Die bonnen zijn weg en niet
terug te halen; wat je nog kunt doen is het papier opnieuw fotograferen en aan de kasregel koppelen,
zodat de voorbelasting terugkomt. De migratie is inmiddels gerepareerd en veilig opnieuw te draaien.

**☑ Wat de meting verder liet zien — allemaal goed**
De bucket staat op privé met een limiet van 25 MB · de drie storage-policies staan er ·
**élke tabel in `public` heeft RLS aan** (`relrowsecurity = false` gaf nul rijen). Dat laatste
beantwoordt in één regel de hele beveiligingsvraag van het doorgestuurde readiness-rapport.

**☐ `AI_DAILY_BUDGET_EUR=0` in Vercel**
Nul betekent: **wél tellen, niet begrenzen**. Dat is de juiste stand voor je eerste weken —
je leert je echte uitgaven kennen voordat je een getal kiest. Laat je hem leeg, dan geldt
€ 5/dag, en dat is bij ± € 0,019 per gescand document zo'n 260 documenten per dag over
*alle* gebruikers samen. Ruim voor de eerste gebruikers, krap voor tien tegelijk.

Meekijken: `select * from ai_spend_daily order by day desc limit 7;`

**☐ `RETENTION_PURGE_ENABLED` leeg laten**
Dit is de enige schakelaar in de app die data vernietigt. Leeg = dry run. Er kan niets vóór
2033 aan de beurt zijn; meldt een dry run nu al een kandidaat, dan is er een datum verkeerd
gezet — uitzoeken, niet aanzetten.

**☑ `boekbrug.nl` kan post ONTVANGEN — opgelost op 30 juli**

Dit stond hier een halve dag als het enige punt op deze lijst dat iets kapots repareerde in
plaats van iets mogelijk te maken, en het is af. De aanleiding: `boekbrug.nl` had **geen
enkel MX-record**, terwijl de app drie adressen publiceert als het officiële loket —
`privacy@` (Privacyverklaring §1, §6, §12, §13, mét de beloofde termijnen van 30 en 7 dagen),
`legal@` (Voorwaarden) en `support@` (Voorwaarden + privacy §13). Alle drie bouncden. Dat is
iets anders dan een leeg KVK-veld: "(volgt)" is een eerlijke lege plek, een gepubliceerd
adres dat weigert is een belofte die de app niet waarmaakt — en het is precies het kanaal
dat de AVG (art. 13) verplicht stelt, dus het telde vanaf de eerste gebruiker, niet vanaf de
eerste euro.

Opgelost met doorsturen in plaats van mailboxen: drie regels in de TransIP DNS-tabel, en de
aliassen bij de doorstuurdienst. Nagemeten vanaf een externe resolver, niet aangenomen:

| Record | Stand |
|---|---|
| `MX boekbrug.nl` | `10 mx1.improvmx.com` · `20 mx2.improvmx.com` |
| `TXT _dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@boekbrug.nl; fo=1` |
| CONTROLE `MX send.boekbrug.nl` | ongewijzigd (Resend-retourpad) |
| CONTROLE `TXT resend._domainkey` | ongewijzigd (DKIM) |
| CONTROLE `A boekbrug.nl` | ongewijzigd (Vercel) |

Die laatste drie staan er met opzet bij. Een MX op de hoofdnaam en het verzendpad van Resend
lijken op elkaar te botsen maar doen dat niet — Resend hangt op de subnaam `send.` — en dat
is nu gemeten in plaats van beredeneerd. DMARC stond al beschreven in
`docs/AUTH_SETUP_GUIDE.md §C.3` en was nooit aangezet; dat is meteen meegenomen, met `rua` op
het eigen domein omdat rapportage naar een extern adres een autorisatierecord vereist bij die
andere partij.

Wat hier NIET aan lag, voor de volgende lezer: Resend verzorgt het **verzenden**
(`noreply@boekbrug.nl`) en werkte de hele tijd. Ontvangen is een losse zaak die Resend niet
doet. De doorstuurbestemming wordt nergens gepubliceerd, dus welk privé-adres daarachter
hangt maakt voor de buitenwereld niets uit.

**☐ Twee kleine dingen die hierbij horen**
Een catch-all (`*@boekbrug.nl`) hoort uit: de vier expliciete aliassen dekken alles wat de
documenten noemen, terwijl `*` elk verzonnen adres accepteert en daarmee vooral spam
binnenhaalt. En het echte bewijs is niet DNS maar een verstuurde mail — stuur er één naar
`privacy@boekbrug.nl` en kijk de eerste keer in de ongewenste-map.

## 2. Voordat je geld kunt aannemen

**☐ KVK-inschrijving en een zakelijke bankrekening**
Zonder deze twee keert Stripe niet uit, en zolang er geen echt KVK-nummer is blijft `/steun`
bewust een 404: er wordt nooit om geld gevraagd zonder identificeerbare rechtspersoon.

**☐ De bedrijfsidentiteit in Vercel**
`NEXT_PUBLIC_COMPANY_LEGAL_NAME` · `_KVK` · `_BTW` · `_ADDRESS` · `_CITY`
Nu tonen de voorwaarden "(volgt)". Dat is opzet — een leeg veld mag nooit als een
echt-maar-onjuist KVK-nummer kunnen lezen — maar het is geen eindtoestand.

Twee dingen die hier eerder onduidelijk stonden, want ze vallen niet allebei onder "geld":

*Het werkt al, en er staat nergens een blokhaak op je scherm.* De vervanging zit in
`src/content/legal/company.ts` en draait bij het bouwen over de drie juridische teksten
(voorwaarden, privacy, eerlijk gebruik). Zonder ingevulde variabelen leest de bezoeker
vandaag "geëxploiteerd door **BoekBrug**, gevestigd te Tilburg, KVK-nummer **(volgt)**" —
niet `[JOUW NAAM]`. Nagemeten door de drie modules te importeren en op overgebleven
placeholders te zoeken: nul.

*Alleen `_KVK` en `_BTW` horen echt bij "voordat je geld aanneemt".* `_LEGAL_NAME` en
`_ADDRESS` staan in de privacyverklaring als de verwerkingsverantwoordelijke, en die vraag
stelt de AVG bij de eerste gebruiker. Zolang je nog niets int, is "(volgt)" verdedigbaar
mits het loket hierboven wél openstaat — een bereikbaar adres is waar een betrokkene je
daadwerkelijk mee vindt.

**☐ Stripe: twee prijzen, niet één**

| | Bedrag | Vorm |
|---|---|---|
| `STRIPE_PRICE_ID_PLUS` | **€ 12,99 per maand**, incl. btw | terugkerend |
| `STRIPE_PRICE_ID_KLUIS_YEAR` | **€ 19 per bewaarjaar**, incl. btw | eenmalig |

Het bedrag in Stripe moet **exact** gelijk zijn aan wat de voorwaarden publiceren. De
checkout dwingt acceptatie van die voorwaarden af, dus een verschil is precies het gat waar
de klant gelijk in krijgt.

**☐ Stripe: iDEAL aan, Invoicing aan, Billing Portal met zelf-opzeggen aan**
Kaart-alleen verliest echte Nederlandse klanten bij de laatste klik. Zelf kunnen opzeggen is
onder EU-consumentenrecht geen keuze.

**☐ Webhook**
Endpoint `https://boekbrug.nl/api/billing/webhook`, events:
`checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`,
`invoice.payment_failed`. Het ondertekengeheim in `STRIPE_WEBHOOK_SECRET` — dat is het enige
dat tussen een publiek eindpunt en willekeurig wie op internet staat.

**☐ Testen in testmodus, en pas daarna live**
Kaart `4242 4242 4242 4242`, dan test-iDEAL. Kijk of de webhook aankomt en het profiel op
`active`/`plus` springt. Zeg op → toegang loopt door tot het einde van de betaalde periode.
Laat een betaling mislukken → de mail komt en **de toegang blijft**. Pas als dat allemaal
klopt: live sleutels, één echte betaling op je eigen account, en kijken of de btw-factuur
klopt.

---

## 3. Eén beveiligingspunt dat ik niet kon afmaken

**☐ `xlsx` naar 0.20.3**
Twee CVE's op de gepinde 0.18.5. De reparatie staat alleen op `cdn.sheetjs.com` (SheetJS is
van npm af) en die host geeft 403 in deze omgeving — in de andere sessie ook. Je hebt er een
omgeving voor nodig die erbij kan:

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm audit && npx tsc --noEmit && npx tsx --test src/lib/*.test.ts && npm run build
```

Daarna één echte Z-rapportage, één grootboekexport en één bank-`.xlsx` uploaden om te zien
dat het parsen niet is veranderd. **Je bent intussen niet blootgesteld aan de ergste helft**:
de prototype-pollution is ingedamd op de parsergrens (`xlsx-adapter.ts`) en de ReDoS is
begrensd. Doe dit vóór je mensen onboardt die bestanden uploaden.

---

## 4. Het experiment waar dit allemaal voor was

Tien mensen, persoonlijk begeleid. Geen advertenties tot deze poort door is.

De poort is **niet** meer "vraag om de kaart" — het product is gratis, er is niets te vragen.
Dat is een echte prijs van het model dat je hebt gekozen: **er is geen vroeg
inkomstensignaal.** De vervanging:

> ≥ 3 van de 10 nog actief **ná één volledig afgesloten kwartaal**, en
> ≥ 1 boekhouder die dat kwartaal daadwerkelijk heeft opgehaald.

Betalen komt later, uit Plus en uit de Bewaarkluis. Haal je die poort niet, interview dan
alle tien — hun antwoord is meer waard dan welk strategiedocument ook, dit inbegrepen.

---

## 5. Wat je in week één in de gaten houdt

| Waar | Waarop |
|---|---|
| Stripe → Webhooks | elke aflevering die geen 200 is. Een falende webhook = iemand betaalde en de app weet het niet |
| Vercel-logs `[BILLING]` | `UNATTRIBUTED subscription` — een echte betaling zonder account erbij |
| Vercel-logs `[KLUIS]` | `UNATTRIBUTED bewaarkluis payment` — hetzelfde, maar voor het archiefproduct |
| Vercel-logs `[COST-GUARD]` | `DAILY AI BUDGET EXHAUSTED` — de zekering is doorgeslagen, er moet iemand kijken |
| Vercel-logs `[CRON-RETENTION]` | élke kandidaat. Er kan niets vóór 2033 aan de beurt zijn |
| Sentry | nieuwe fouten in `/api/billing/*`, `/api/kluis/*` en de crons |

---

## 6. Wat bewust NIET is gebouwd

Jaarabonnementen · boekhoudersplannen · kortingscodes · proration · een volledige
dunning-reeks · Mollie · meerdere valuta · een proefperiode.

Elk daarvan is een antwoord op een vraag die je nog niet hebt verdiend. En de proefperiode
staat er niet tussen bij toeval: die is uit de andere tak bewust **niet** overgenomen, want
een klok die stil begint te lopen en later toegang kan intrekken is precies het gedrag waar
dit product zich van onderscheidt. Zie `docs/PORT_VAN_BILLING_TAK.md` §3.

---

## 7. Twee open punten, eerlijk benoemd

1. **De mailrobot telt nog niet mee in het eerlijk gebruik.** `/api/cron/email-sync` draait
   namens de gebruiker via service_role; per binnengekomen bijlage door de poort sturen
   vraagt een aparte ronde. Tot die er is draagt de begrenzing daar op de dagzekering, en
   blijft een verlaten mailbox van een gratis account meelopen. Betaalbaar, niet gratis.
2. **Eén `deletion_requests`-rij heeft `data_eligible_for_deletion_at = null`** — een account
   dat is verwijderd voordat de tijdstempel bestond. De purge laat hem met rust (hij eist
   twee kloppende datums), dus er gaat niets mis. Verdient ooit een blik, niet vandaag.

---

## 8. Wat de stille-foutenjacht heeft veranderd (juli 2026)

Een volledige doorloop van de brug — opname bij jou, aflevering bij de boekhouder — met tien
lenzen en per bevinding twee sceptici. Negen fouten van het gevaarlijkste soort zijn gerepareerd:
een verkeerd of ontbrekend antwoord **zonder** foutmelding, logregel of enig spoor.

Wat je ervan merkt:

| Vroeger | Nu |
|---|---|
| Een contante terugbetaling aan een klant *verhoogde* je omzet en je af te dragen BTW | De la beweegt de kant op die hij echt op ging |
| Eén databasehapering en je zag het groene "Alles is bij" met € 12.000 openstaand | Een eerlijk paneel met een opnieuw-knop |
| Het kwartaalpakket kon een concept-aangifte meesturen waarin je hele kasboek ontbrak | Geen concept, wél de reden — en alle bewijsstukken gaan onverkort mee |
| Een verwijderd bankafschrift liet de factuur onbetaald staan met € 0 openstaand: nooit meer een herinnering | De omkering zet ook `amount_paid` terug |
| Élke klant op het werkbord van je boekhouder droeg het label "zonder bank" | De telling mag nu lezen wat ze moet lezen |
| "Herinnering verstuurd" voor een mail die de provider had geweigerd | Je hoort het als hij niet aankwam |
| "Niets overgeslagen" terwijl een onleesbare bon of een bijlage van 12 MB stil verdween | Beide staan in het overgeslagen-paneel, met de reden |
| "100% klaar" terwijl een factuur zonder datum buiten elk kwartaal viel | Een risico dat 100% onmogelijk maakt — geen blokkade, want al ingediende kwartalen mogen niet rood worden |
| "Opnieuw inlezen" wiste de dubbel-waarschuwing die het kwam hercontroleren | Het rekenoordeel wordt vernieuwd, de dubbel-signalen blijven |

Wat de jacht **niet** heeft gedekt, en waar dus geen uitspraak over is: OAuth-tokenvernieuwing,
de Storage-bucketpolicies en de levensduur van ondertekende URL's, push-aflevering, Stripe buiten
de webhook, en de kwaliteit van de AI-extractie zelf (de audit keek naar wat de code met een
gelezen bedrag doet, niet of dat bedrag klopte).

---

*Verwant: `docs/WELKE_MIGRATIES_STAAN_ER.sql` (wat er écht in je database staat) ·
`docs/MIGRATIES_VOLGORDE.md` (de volgorde en het waarom) ·
`docs/PORT_VAN_BILLING_TAK.md` (wat er uit de andere tak is overgenomen en wat niet) ·
`docs/BEWAARKLUIS_BUSINESS_CASE.md` (waarom de bewaarplicht een voordeur is).*
