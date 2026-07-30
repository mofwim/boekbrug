# Live gaan — wat er tussen de code en tien echte gebruikers staat

*29 juli 2026. Alles hieronder is nagelopen in de code of gemeten in de database; waar iets
onbekend is, staat dat er.*

> **De code is klaar om getest te worden.** Dit document gaat niet over of hij goed genoeg is,
> maar over de bedrading eromheen: het domein, de omgeving, de crons en de vraag hoe je zíet dat
> het draait. Dat laatste is het punt waarop de meeste stille storingen ontstaan.

---

## 1. Het enige harde blokkade-punt: de crons en je Vercel-plan

`vercel.json` declareert zes crons. Twee daarvan draaien **vaker dan één keer per dag**:

| cron | schema | per dag |
|---|---|---|
| `/api/cron/email-sync` | `0 */2 * * *` | 12× |
| `/api/cron/reconcile` | `0 * * * *` | 24× |
| `/api/cron/reminders` | `0 7 * * *` | 1× |
| `/api/cron/recurring` | `0 6 * * *` | 1× |
| `/api/cron/retention-purge` | `0 3 * * 1` | wekelijks |
| `/api/cron/quarter-close` | `0 8 5 1,4,7,10 *` | 4× per jaar |

**Op Vercel Hobby laat een cron die vaker dan 1× per dag draait de DEPLOY falen.** Niet
degraderen — falen. Dus:

- **Zit je op Pro** (± € 20/maand): niets te doen, alle zes draaien met minuut-precisie.
- **Zit je op Hobby**: `email-sync` en `reconcile` moeten naar 1× per dag, anders komt de app er
  niet op.

Voor tien begeleide gebruikers is dagelijks eerlijk gezegd genoeg. `reconcile` elk uur voor tien
mensen is overdaad; `email-sync` één keer per dag betekent dat een gemailde factuur binnen een dag
verschijnt in plaats van binnen twee uur. Dat verandert het gevoel iets, maar het breekt niets — en
het kost niets. Ga naar Pro wanneer er omzet is, niet ervoor.

Wil je naar dagelijks, dan is dit de wijziging:

```json
{ "path": "/api/cron/email-sync", "schedule": "0 5 * * *" },
{ "path": "/api/cron/reconcile",  "schedule": "0 4 * * *" }
```

Let op: op Hobby spreidt Vercel de aanroep over het uur, dus `0 5` betekent érgens tussen 05:00 en
05:59. Voor alle zes maakt dat niets uit.

### `maxDuration = 300` — dat mag op beide plannen

Tien routes vragen vijf minuten (het kwartaalpakket, de mailsync, de crons). Met **Fluid compute**
is de limiet 300s op Hobby én Pro. Fluid staat standaard aan voor projecten van na april 2025;
staat het uit, dan kapt Hobby op **60s** en loopt het kwartaalpakket van een echte klant eruit.
**Controleer dit één keer** in Project → Settings → Functions.

---

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

## 3. Hoe je ziet dát het draait

Dit was het echte gat: **geen enkele cron legde vast dat hij had gedraaid.** Vercel's cron-log
toont of het eindpunt is aangeroepen en met welke statuscode — maar niet of hij iets heeft
uitgericht. Een cron kan 200 teruggeven en nul eigenaren verwerkt hebben omdat een query faalde.

`cron_runs.sql` legt per run vast: wanneer, geslaagd, en wat hij deed. Eén query vertelt je of de
machine leeft — hij staat onderaan dat migratiebestand. Wat hij onderscheidt:

- **nooit gedraaid** → de bedrading klopt niet (`CRON_SECRET`, `vercel.json`, plan-limiet)
- **afgebroken** → begonnen en halverwege gestorven (time-out, crash)
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

## 4. Het domein en de mail

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

## 5. Wat nog van jou is, en geen code

- **KVK-inschrijving en een zakelijke bankrekening.** Zonder deze twee keert Stripe niet uit, en
  `/steun` blijft bewust een 404 zolang er geen echt KVK-nummer is: er wordt nooit om geld gevraagd
  zonder identificeerbare rechtspersoon.
- **De bedrijfsidentiteit in Vercel** — `NEXT_PUBLIC_COMPANY_LEGAL_NAME` · `_KVK` · `_BTW` ·
  `_ADDRESS` · `_CITY`. Nu tonen de voorwaarden "(volgt)". Dat is opzet — een leeg veld mag nooit
  als een echt-maar-onjuist KVK-nummer kunnen lezen — maar het is geen eindtoestand.
- **Twee Stripe-prijzen**, exact gelijk aan wat de voorwaarden publiceren: Plus **€ 12,99 per
  maand** (terugkerend) en de Bewaarkluis **€ 19 per bewaarjaar** (eenmalig). De checkout dwingt
  acceptatie van die voorwaarden af, dus een verschil is precies het gat waar de klant gelijk in
  krijgt. En zet **iDEAL** aan: kaart-alleen verliest Nederlandse klanten bij de laatste klik.
- **`xlsx` naar 0.20.3.** Twee CVE's op de gepinde 0.18.5; de reparatie staat alleen op
  `cdn.sheetjs.com`, die in deze omgeving 403 geeft. Je bent intussen niet blootgesteld aan de
  ergste helft (prototype-pollution is ingedamd op de parsergrens, de ReDoS is begrensd), maar doe
  dit vóór je mensen onboardt die bestanden uploaden.

---

## 6. En dan het enige dat telt

Tien mensen, persoonlijk begeleid, geen advertenties. De poort:

> ≥ 3 van de 10 nog actief **ná één volledig afgesloten kwartaal**, en
> ≥ 1 boekhouder die dat kwartaal daadwerkelijk heeft opgehaald.

Haal je die niet, interview dan alle tien. Hun antwoord is meer waard dan welk strategiedocument
ook, dit inbegrepen.

---

*Verwant: `docs/WELKE_MIGRATIES_STAAN_ER.sql` (wat er écht in je database staat) ·
`docs/JOUW_LIJST.md` (de rest van wat alleen jij kunt doen) ·
`supabase/migrations/cron_runs.sql` (de hartslag-query).*
