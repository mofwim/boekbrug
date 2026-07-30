# Live gaan — wat er tussen de code en tien echte gebruikers staat

*29 juli 2026. Alles hieronder is nagelopen in de code of gemeten in de database; waar iets
onbekend is, staat dat er.*

> **De code is klaar om getest te worden.** Dit document gaat niet over of hij goed genoeg is,
> maar over de bedrading eromheen: het domein, de omgeving, de crons en de vraag hoe je zíet dat
> het draait. Dat laatste is het punt waarop de meeste stille storingen ontstaan.

---

## 0. Wat je zelf kunt vaststellen vóór je iets deployt

*Toegevoegd 30 juli. Dit blok kon er eerder niet staan — de productiebuild had de sleutels van de
productiedatabase nodig.*

```bash
npm ci
npx tsc --noEmit                     # types
npx tsx --test src/lib/*.test.ts     # de hele suite
npx next build                       # de PRODUCTIEBUILD, zonder één geheim
node scripts/nav-audit.mjs           # dode links
```

Die vierde regel is nieuw. Vijf inlogpagina's bouwden een Supabase-client tijdens het renderen, en
Next prerendert juist die pagina's — dus `next build` viel om zonder `NEXT_PUBLIC_SUPABASE_URL`.
Gevolg: de enige echte bouwcontrole was een Vercel-preview, dus ná de push, op infrastructuur die
een meelezer niet kan draaien. Een prerender-fout kon `main` halen en pas opvallen als een deploy
die niet vertrok.

De client wordt nu gebouwd waar hij gebruikt wordt (`src/lib/supabase.ts`), de build draait op een
schone checkout met een lege omgeving, en **CI draait hem nu als derde poort**.

> Vraagt `next build` ooit weer om een sleutel, zet hem dan **niet** in CI. Dat is het signaal dat
> iemand opnieuw een client in een component-body heeft gezet; herstel de oorzaak, anders bewijst
> de poort niets meer.

### De twee openstaande CVE's, eerlijk

`npm audit` meldt er twee als high. Geen van beide is met een upgrade op te lossen, en dat is geen
nalatigheid:

- **`xlsx@0.18.5`** — "No fix available" klopt: de gerepareerde releases staan alleen op
  `cdn.sheetjs.com`, niet op npm. De mitigatie is daarom structureel in plaats van een versienummer:
  álles gaat door `src/lib/xlsx-adapter.ts`, dat de prototype-pollution op de parsergrens terugdraait
  en de ReDoS begrenst met een groottedrempel. Dat is nagelopen én vastgelegd — een test loopt de
  broncode af en faalt zodra één bestand SheetJS rechtstreeks importeert. Het adapterpad is dus niet
  een afspraak maar de enige deur, en dat blijft zo of iemand het onthoudt of niet.
- **`sharp` <0.35.0** — dit is **niet onze** sharp. Wij staan op 0.35.3 (gepatcht); de gemelde 0.34.5
  zit in `node_modules/next/node_modules/`, komt mee met `next@16.2.6` en bedient Next's
  image-optimizer, die op Vercel op hun eigen infrastructuur draait. Op te lossen door Next te
  upgraden, niet door hier iets te veranderen. Geen livegang-blokkade.

---

## 1. De crons — op Pro, dus dit klopt gewoon

`vercel.json` declareert zes crons:

| cron | schema | per dag |
|---|---|---|
| `/api/cron/reconcile` | `0 * * * *` | 24× |
| `/api/cron/email-sync` | `0 */2 * * *` | 12× |
| `/api/cron/reminders` | `0 7 * * *` | 1× |
| `/api/cron/recurring` | `0 6 * * *` | 1× |
| `/api/cron/retention-purge` | `0 3 * * 1` | wekelijks |
| `/api/cron/quarter-close` | `0 8 5 1,4,7,10 *` | 4× per jaar |

**Dit project draait op Vercel Pro.** Daar mogen crons per minuut, dus alle zes draaien zoals
gedeclareerd, op de minuut die er staat. Er is niets aan te passen.

> Ter waarschuwing voor later: op **Hobby** laat een cron die vaker dan 1× per dag draait de
> DEPLOY falen — niet degraderen, falen. `reconcile` en `email-sync` zouden daar dus naar
> dagelijks moeten. Relevant als er ooit een staging- of hobbyproject naast komt te staan.

### `maxDuration = 300` — op Pro geen zorg

Tien routes vragen vijf minuten (het kwartaalpakket, de mailsync, de crons). **Op Pro is 300s
sowieso toegestaan**, met of zonder Fluid compute: mét Fluid is het maximum 800s, zonder Fluid is
het legacy-maximum precies 300s.

*(Ik zei eerder dat je Fluid compute moest controleren. Op Pro hoeft dat niet — die controle geldt
alleen op Hobby, waar zónder Fluid op 60s wordt gekapt en het kwartaalpakket van een echte klant
eruit zou lopen.)*

Wat Pro wél extra geeft: als een kwartaalpakket van een grote klant ooit tegen de 300s aan loopt,
kun je die route naar 800s tillen. Doe dat pas als het gebeurt — een limiet verhogen die je niet
raakt, verbergt alleen dat er iets traag is.

## 2. De omgeving

`.env.example` documenteert 39 variabelen. Deze lijst is niet de checklist — de code is dat. Wat
hier staat is wat er misgaat als je iets vergeet, want dát bepaalt de volgorde.

### Zonder deze werkt er iets níet, en dat merk je

| variabele | wat er gebeurt als hij ontbreekt |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | de app start niet |
| `SUPABASE_SERVICE_ROLE_KEY` | elke cron, elke webhook en elke ondertekende bestands-URL faalt |
| `ANTHROPIC_API_KEY` | scannen van bonnen geeft een nette foutmelding |
| `RESEND_API_KEY` | geen enkele mail vertrekt |

### Zonder deze gebeurt er STIL niets

| variabele | het stille gevolg |
|---|---|
| `CRON_SECRET` | **alle zes crons antwoorden 401 en doen niets.** Geen mail die uitblijft die iemand mist, geen scherm dat verandert. Dit is de duurste vergeten variabele van de hele lijst. |
| `NEXT_PUBLIC_APP_URL` | links in uitnodigingen en mails vallen terug op de verzoek-origin; in de kwartaal-cron (die geen verzoek heeft) op `https://boekbrug.nl`. Draai je op een ander domein, dan krijgt de boekhouder een link naar een andere site. |
| `STRIPE_WEBHOOK_SECRET` | iemand betaalt, de webhook wordt geweigerd, en het account springt nooit op `plus`. |

> **Over `NEXT_PUBLIC_SITE_URL`:** die naam bestond als tweede naam voor hetzelfde ding en stond
> niet in `.env.example`. Sinds `src/lib/app-origin.ts` is er één keten —
> `NEXT_PUBLIC_APP_URL` → `NEXT_PUBLIC_SITE_URL` → `VERCEL_URL` → de verzoek-origin — dus zet
> gewoon `NEXT_PUBLIC_APP_URL` en klaar. De oude naam blijft werken voor een omgeving die hem al
> heeft.

### Bewust leeg laten

| variabele | waarom |
|---|---|
| `AI_DAILY_BUDGET_EUR=0` | nul = **wél tellen, niet begrenzen**. Leeg laten geeft € 5/dag ≈ 260 documenten over álle gebruikers samen. Ruim voor tien, krap voor tien tegelijk. |
| `RETENTION_PURGE_ENABLED` | leeg = dry run. Dit is de enige schakelaar die data vernietigt. Er kan niets vóór 2033 aan de beurt zijn; meldt een dry run tóch een kandidaat, dan staat er ergens een datum verkeerd. |

---

## 3. Na elke deploy: één URL

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<domein>/api/health | jq
```

Dat antwoordt met één van drie oordelen — `gezond`, `let-op`, `kapot` — en zegt er precies bij
waaróm:

- **de omgeving**: alleen wat MIST, met per variabele het concrete gevolg. Nooit een waarde, ook
  niet ingekort — een gezondheidsrapport dat sleutels lekt is zelf het lek.
- **de database**: bereikbaar of niet.
- **de bestanden**: staat de `documents`-bucket op privé? Staat hij open, dan is dat het ergste
  wat deze installatie kan overkomen, en dan is het oordeel meteen `kapot`.
- **de crons**: per cron wanneer hij voor het laatst draaide en of dat klopt met zijn ritme.

Twee dingen die dit eindpunt bewust anders doet dan een gewone healthcheck:

**Ontbreekt `CRON_SECRET`, dan is dat het antwoord — geen kale 401.** Je kunt je dan niet
authenticeren, en juist dát is de diagnose: het betekent óók dat alle zes crons 401 antwoorden en
niets doen. Het eindpunt zegt dat hardop.

**"Ik weet het niet" is geen "het is goed".** Is `cron_runs.sql` nog niet toegepast, dan meldt hij
niet dat de crons stilliggen maar dat hij het niet kan zien. Dat zijn twee verschillende dingen.

Dit is een rookproef voor jou als beheerder, geen beheerdersdashboard: het raakt geen
klantgegevens, telt niets per gebruiker, en er komt geen scherm bij. Er is geen admin-rol in dit
product, en die hoort er ook niet te komen — het hele vertrouwensverhaal is dat alleen de eigenaar
en zijn gekozen boekhouder bij de gegevens kunnen.

---

## 4. Hoe je ziet dát het draait

Dit was het echte gat: **geen enkele cron legde vast dat hij had gedraaid.** Vercel's cron-log
toont of het eindpunt is aangeroepen en met welke statuscode — maar niet of hij iets heeft
uitgericht. Een cron kan 200 teruggeven en nul eigenaren verwerkt hebben omdat een query faalde.

`cron_runs.sql` legt per run vast: wanneer, geslaagd, en wat hij deed. Eén query vertelt je of de
machine leeft — hij staat onderaan dat migratiebestand. Wat hij onderscheidt:

- **nooit gedraaid** → de bedrading klopt niet (`CRON_SECRET`, of `vercel.json` niet meegedeployd)
- **afgebroken** → begonnen en halverwege gestorven (time-out, crash). Dit ziet hij dankzij een
  startregel die bij het begin van de run wordt geschreven: sterft de run, dan blijft die regel op
  `ok = null` staan. Zonder die startregel zou een vastgelopen `quarter-close` pas een half jaar
  later opvallen
- **gefaald** → tot het einde gekomen en zelf gemeld dat het misging
- **te lang stil** → liep ooit goed, daarna twee slagen niet meer langs geweest

Die vier vragen om verschillend handelen; daarom zijn het geen één "kapot".

`quarter-close` verdient aparte aandacht: hij draait **vier keer per jaar**. Een stil kapotte
quarter-close ontdek je een jaar later, met de vraag *"waarom heeft mijn boekhouder nooit iets
ontvangen?"* — en dat is precies de belofte van dit product. Draai die query één keer per kwartaal,
kort na de 5e van januari/april/juli/oktober.

### Waar je in week één naar kijkt

| waar | waarop |
|---|---|
| `cron_runs` | de query hierboven — één keer per week is genoeg |
| Stripe → Webhooks | elke aflevering die geen 200 is. Een falende webhook = iemand betaalde en de app weet het niet |
| Vercel-logs `[BILLING]` | `UNATTRIBUTED subscription` — een echte betaling zonder account erbij |
| Vercel-logs `[KLUIS]` | `UNATTRIBUTED bewaarkluis payment` — hetzelfde voor het archiefproduct |
| Vercel-logs `[COST-GUARD]` | `DAILY AI BUDGET EXHAUSTED` — de zekering is doorgeslagen |
| Vercel-logs `[CRON-RETENTION]` | élke kandidaat. Er kan niets vóór 2033 aan de beurt zijn |
| Vercel-logs `[SNELSTART]` | `MIGRATIE ONTBREEKT` — dan staat de dubbelboekingsbescherming uit |
| Sentry | nieuwe fouten in `/api/billing/*`, `/api/kluis/*` en de crons |

---

## 5. Het domein en de mail

- **DNS naar Vercel**, en `NEXT_PUBLIC_APP_URL` op datzelfde domein.
- **Supabase → Auth → URL Configuration**: het domein in `Site URL` én in `Redirect URLs`, met
  `/api/auth/callback` erbij. Zonder die callback landt de inlogcode op de homepage ongebruikt —
  zie de noot in `src/app/api/auth/callback/route.ts`.
- **Resend → domein verifiëren** (SPF + DKIM). Zonder verificatie mag je alleen naar je eigen
  adres mailen, en dat merk je pas bij de eerste echte uitnodiging aan een boekhouder.
- **Stripe → webhook** naar `https://<domein>/api/billing/webhook`, events
  `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`,
  `invoice.payment_failed`. Het ondertekengeheim in `STRIPE_WEBHOOK_SECRET`.

---

## 6. Wat nog van jou is, en geen code

- **KVK-inschrijving en een zakelijke bankrekening.** Zonder deze twee keert Stripe niet uit, en
  `/steun` blijft bewust een 404 zolang er geen echt KVK-nummer is: er wordt nooit om geld gevraagd
  zonder identificeerbare rechtspersoon.
- **MX-records voor `boekbrug.nl`, vóór de eerste gebruiker.** Op 30 juli gemeten: het domein
  heeft er **geen**, terwijl de app `privacy@`, `legal@` en `support@boekbrug.nl` publiceert als
  het officiële loket — inclusief de AVG-termijnen van 30 en 7 dagen die de privacyverklaring
  belooft. Alle drie bouncen. Resend verzorgt het *verzenden* en werkt; ontvangen is een losse
  zaak die Resend niet doet. Twee doorstuurregels bij je registrar naar een mailbox die je al
  hebt, is genoeg — en dit is het enige punt in dit hoofdstuk dat niet iets mogelijk maakt maar
  iets repareert.
- **De bedrijfsidentiteit in Vercel** — `NEXT_PUBLIC_COMPANY_LEGAL_NAME` · `_KVK` · `_BTW` ·
  `_ADDRESS` · `_CITY`. Nu tonen de voorwaarden "(volgt)". Dat is opzet — een leeg veld mag nooit
  als een echt-maar-onjuist KVK-nummer kunnen lezen — maar het is geen eindtoestand. De
  vervanging zélf is af en getest: `src/content/legal/company.ts` vult de drie juridische teksten
  bij het bouwen, dus er staat nergens een `[JOUW NAAM]` op het scherm — zonder variabelen leest
  het "geëxploiteerd door BoekBrug, gevestigd te Tilburg, KVK-nummer (volgt)". Alleen `_KVK` en
  `_BTW` horen bij "voordat je geld aanneemt"; `_LEGAL_NAME` en `_ADDRESS` staan in de
  privacyverklaring als verwerkingsverantwoordelijke en gelden vanaf de eerste gebruiker.
- **Twee Stripe-prijzen**, exact gelijk aan wat de voorwaarden publiceren: Plus **€ 12,99 per
  maand** (terugkerend) en de Bewaarkluis **€ 19 per bewaarjaar** (eenmalig). De checkout dwingt
  acceptatie van die voorwaarden af, dus een verschil is precies het gat waar de klant gelijk in
  krijgt. En zet **iDEAL** aan: kaart-alleen verliest Nederlandse klanten bij de laatste klik.
- **`xlsx` naar 0.20.3** — *bijgewerkt 30 juli.* Nog steeds niet via npm te doen: de reparatie
  staat alleen op `cdn.sheetjs.com`. Wat er sindsdien bij is gekomen, is dat de containment nu
  bewaakt wordt in plaats van beloofd: een test loopt de broncode af en faalt zodra één bestand
  SheetJS rechtstreeks importeert, dus het gedempte pad is aantoonbaar het enige. Dat maakt de
  upgrade minder dringend dan hierboven stond — doe hem alsnog wanneer je de bron vertrouwt, maar
  hij hoeft je eerste tien gebruikers niet tegen te houden.

---

## 7. En dan het enige dat telt

Tien mensen, persoonlijk begeleid, geen advertenties. De poort:

> ≥ 3 van de 10 nog actief **ná één volledig afgesloten kwartaal**, en
> ≥ 1 boekhouder die dat kwartaal daadwerkelijk heeft opgehaald.

Haal je die niet, interview dan alle tien. Hun antwoord is meer waard dan welk strategiedocument
ook, dit inbegrepen.

---

*Verwant: `docs/WELKE_MIGRATIES_STAAN_ER.sql` (wat er écht in je database staat) ·
`docs/JOUW_LIJST.md` (de rest van wat alleen jij kunt doen) ·
`supabase/migrations/cron_runs.sql` (de hartslag-query).*
