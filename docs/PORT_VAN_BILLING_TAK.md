# Wat er van de billing-tak is overgenomen — en wat niet

*Overdrachtsdocument voor de sessie die `claude/boekbrug-analysis-ideas-wrbjpz` heeft
gebouwd. Geschreven vanaf `claude/snelstart-integration-opix9l`. 26 juli 2026.*

---

## 0. Waarom dit document bestaat

Er liepen twee takken naast elkaar, allebei ongemerged, en allebei met een eigen
**bindend** antwoord op dezelfde vraag: wat kost BoekBrug.

| | `boekbrug-analysis-ideas-wrbjpz` | `snelstart-integration-opix9l` |
|---|---|---|
| Ondernemer | € 12,00/maand na 30 dagen proef | **Gratis**, € 12,99 alleen boven het eerlijk gebruik |
| Boekhouder | niet als plan benoemd | **Gratis, altijd** — in code én in een test |
| Na afloop | read-only **Archief** | er loopt niets af |
| Voorwaarden §5 | eigen versie | eigen versie |
| `/prijzen` | "30 dagen gratis, daarna € 12" | — |
| `/eerlijk-gebruik` | — | "gratis, € 12,99 daarboven" |

Beide samenvoegen zoals ze waren, zou op één website twee prijzen hebben gezet en twee
versies van §5 — precies de fout waar `plan.ts` in zijn eigen header voor waarschuwt
("ambiguity in your own standard terms is construed against you"), maar dan groter.

De eigenaar heeft gekozen: **het gratis model blijft, de machine van de billing-tak komt
mee.** Dit document legt vast wat dat concreet betekende.

Belangrijk voor de context: de runbook `docs/LAUNCH.md` opent met *"Every code task is
done, tested and pushed."* Dat klopte — **op die tak**. Op `main` en op deze tak bestond
geen `src/lib/plan.ts`, geen `src/app/api/billing/`, geen `/prijzen` en geen van de vijf
migraties. Geen van beide takken is met `main` samengevoegd.

---

## 1. Overgenomen zonder wijziging

Dit werk hangt nergens van af en is onmiddellijk waardevol.

| Wat | Waarom het blijft |
|---|---|
| `src/lib/ai-budget.ts` + `ai_spend_guard.sql` + de drie reserveringen in `ai.ts` | Een euro-plafond per UTC-dag op Anthropic-uitgaven, afgedwongen bij álle transporten. Dit was ook al los aanbevolen op deze tak als antwoord op de vraag over het eerlijk gebruik. De analyse eronder — dat zes route-emmers samen ~1.440 leesbeurten per uur toestaan en dat `checkRateLimit()` open faalt — is correct en per-gebruiker niet te repareren. |
| `checkRateLimitByKey()` in `rate-limit.ts` | De limiet op `/api/tools/scan-invoice` bucketde op `'scan-ip:<ip>'` tegen een `uuid`-kolom met foreign key naar `profiles`. Elke aanroep gaf een cast-fout, de limiter faalde open, en de login-vrije scanner die de betaalde API aanroept had dus **nooit** een plafond gehad. De vervanging faalt dicht. |
| `retention-purge.ts` + `retention_purge.sql` + `/api/cron/retention-purge` + de aanpassing in `retention.ts` | `computeEligibleForDeletion` had geen enkele aanroeper: de klok werd bij deactivering gezet en nooit gelezen, dus AVG-verwijdering voerde nooit iets uit. Twee onafhankelijke controles moeten allebei "verlopen" zeggen; zonder `RETENTION_PURGE_ENABLED=true` is alles dry run. **Wij hebben dit ook nodig voor de Bewaarkluis.** |
| `xlsx-adapter.ts` (hardening) + tests voor `xlsx-adapter`, `csv-safe`, `epc-qr` | Indamming van de prototype-pollution-CVE op de parsergrens. |
| De scanfunnel (`FactuurScanner.tsx` → `GratisFactuur.tsx`) | De route-comment beweerde dat de uitgelezen regels naar `/factuur-maken` gingen; niets schreef of las die overdracht. Het hoogste-intentiemoment in de funnel gooide het werk weg. De keuze om de *tegenpartij* níét mee te geven — een gescande factuur is er een die je hebt ontvangen — is exact goed. |
| De opzet van `billing.ts` en de drie routes | Eén module bezit de leverancier. De webhook schrijft in twee stappen (eerst toegang, dan het label) zodat een geweigerd label nooit een betalende klant meesleept. `subscriptionPeriodEnd()` leest `current_period_end` van het subscription **item** — de vindplaats waar elke tutorial van vóór 2026 fout zit. |
| Het slot tegen zelfbediening in `billing_subscription.sql` | Zonder die trigger kan elke ingelogde gebruiker zich vanuit de browserconsole `active` geven, want `profiles_update_own` kent geen kolombeperking. |
| De mail bij een mislukte incasso | Toon klopt: een verlopen kaart is geen morele fout en de klant verliest niets. |

---

## 2. Overgenomen, maar aangepast

### 2.1 `src/lib/plan.ts` — herschreven

Daar stond een eigen `priceLabel: "€ 12,00"`. Op deze tak publiceren de bindende
voorwaarden € 12,99, en de checkout dwingt acceptatie van die voorwaarden af
(`consent_collection.terms_of_service`). Twee bedragen in één koopproces.

Nu staat er **geen enkel getal** meer in `plan.ts`. Alles wordt afgeleid uit
`fair-use.ts` (`PLUS_PRICE_EUR`) en `bewaarkluis.ts`. Verandert de prijs, dan verandert
hij overal mee — inclusief `<title>`, OG-beschrijving en de tekst op `/prijzen`, die daar
alle drie afzonderlijk waren overgetypt.

### 2.2 `src/lib/subscription.ts` — teruggebracht tot één vraag

`decideAccess()` beantwoordde: *mag dit account de app gebruiken?* Die vraag bestaat bij
ons niet.

Wat blijft: `normalizeStripeStatus()`, `parseTimestamp()`, `daysUntil()`, en een nieuwe
`decidePlan()` die antwoordt: *gelden de ruimere Plus-grenzen?* Uitkomsten: `free`, `plus`,
`boekhouder`. Er is geen uitkomst "geweigerd".

De faalrichting is omgedraaid en dat is bewust. Bij twijfel is het antwoord `free`, niet
`plus`. Dat is veilig omdat er twee vangnetten achter elkaar staan: `evaluateFairUse()`
rekent een ontbrekende, negatieve of `NaN`-teller al als 0, en `free` sluit sowieso niets
af. Een databasestoring levert hooguit een pauze op één handeling op, nooit een slot.

### 2.3 `billing.ts` — een tweede product

`createKluisCheckoutSession()` erbij: `mode: "payment"`, de resterende bewaarjaren als
`quantity`, `invoice_creation` aan (Stripe stuurt bij een eenmalige betaling anders geen
factuur, en voor een zakelijke klant is die factuur het halve product). Twee prijs-id's in
de omgeving: `STRIPE_PRICE_ID_PLUS` en `STRIPE_PRICE_ID_KLUIS_YEAR`.

### 2.4 `billing_subscription.sql` — zonder proefklok

De oorspronkelijke migratie voegde `trial_ends_at timestamptz DEFAULT (now() + interval
'14 days')` toe. Een `DEFAULT` betekent dat bij **elke bestaande én nieuwe rij** stil een
klok gaat lopen die later toegang kan intrekken. Die kolom staat er nu niet in;
`subscription_status` heeft default `'none'` in plaats van `'trialing'`; en de
controlequery onderaan vraagt expliciet of `trial_ends_at` **afwezig** is.

### 2.5 De webhook — `'pro'` → `'plus'`

De handler schreef `subscription_plan = 'pro'`. Onze CHECK laat alleen
`free|plus|boekhouder` toe. Postgres had daarop de **hele rij** geweigerd — inclusief de
statuskolom. Dat is precies het lek dat de twee-schrijfacties-splitsing beschrijft; hier
zou het door de waarde zelf zijn getriggerd.

### 2.6 `/api/cron/email-sync` — rechtenfilter eruit

Daar filterde `decideAccess()` welke mailboxen nog gesynct werden. Bij ons is er niets om
"geen toegang" van te maken. Vervangen door een uitleg van wat de kosten hier wél begrenst,
met het open punt eerlijk benoemd (zie §4).

### 2.7 `/prijzen` — herschreven

Drie kolommen (Gratis / Plus / Boekhouder), de Bewaarkluis eronder, en een FAQ die begint
met *"Is het echt gratis, of is dit een proefperiode?"*. De `?reden=`-melding is weg: die
hoorde bij een betaalmuur die mensen hierheen stuurde.

### 2.8 `vercel.json`

De cron voor proefperiode-herinneringen is niet meegekomen. De purge-cron wel.

---

## 3. Niet overgenomen

| Wat | Reden |
|---|---|
| `trial_30_days.sql`, `billing_trial_reminder.sql`, `/api/cron/trial-reminder`, `TrialBanner.tsx`, `sendTrialEndingEmail()` | Er is geen proefperiode. |
| `decideAccess()`, `trialBanner()`, `ARCHIVE_PATHS` / `isArchivePath()`, `isBillingEnforced()` | Samen een betaalmuur met proefklok. **Een test in `subscription.test.ts` faalt als een van deze vijf namen terugkeert**, zodat hun terugkeer een bewuste daad moet zijn en niet iets dat er bij een volgende samenvoeging stilletjes bij komt. |
| Het betaalmuurblok in `middleware.ts` | Geen enkel pad stuurt iemand weg wegens geld. |
| `BILLING_ENFORCED` | Er is geen muur om donker te verschepen. Ontbreken de Stripe-sleutels, dan geeft alleen de knop "Plus nemen" een nette 503. |

**Eén ding uit het Archief-ontwerp verdient expliciete waardering.** De redenering onder
`ARCHIVE_PATHS` — vertrouwen, de bewaarplicht is de plicht van de *gebruiker*, en een
hard slot beëindigt de relatie — is precies goed, en is de reden dat het gratis model
verdedigbaar is. Alleen: als er nooit een muur is, hoeft er ook geen deur in.

---

## 4. Open punten, eerlijk benoemd

1. **`xlsx` staat nog op 0.18.5.** De reparatie staat alleen op `cdn.sheetjs.com` en die
   host geeft ook hier 403 (zelfde netwerkbeleid). De indamming op de parsergrens is wel
   overgenomen. Dit moet gebeuren in een omgeving die die host kan bereiken.
2. ~~De fair-use-tellers bestaan nog niet als databasekolom.~~ **Opgelost.**
   `fair_use_usage.sql` + `src/lib/fair-use-usage.ts` + `src/lib/fair-use-gate.ts` meten nu
   echt: alle zes AI-routes en het versturen van facturen gaan door de poort, en de stand
   staat op `/dashboard/settings/facturering`. Wat er nog NIET doorheen gaat is de
   email-sync-cron: die draait op de service-role namens de gebruiker, en per binnengekomen
   bijlage door de poort sturen vraagt een aparte ronde. Tot die er is draagt daar de globale
   dagzekering, en dat is een echte grens: een verlaten mailbox van een gratis account blijft
   meelopen.
3. **`RETENTION_PURGE_ENABLED` mag niet op `true`** voordat er een `kluis_subscriptions`
   bestaat. Anders weet de purge niet wie hij níét mag aanraken. Dat is nu de enige harde
   koppeling tussen de purge en de Bewaarkluis.
4. **De kostenschatting per scan is naar boven bijgesteld.** Op deze tak stond eerder
   ≈ € 0,005 per document. `ai-budget.ts` rekent met ≈ **€ 0,019** — de systeemprompt van
   ~4.300 tokens was vergeten. Bij 50 documenten per maand is dat **€ 0,95 per gratis
   gebruiker**, niet € 0,25. De standaardzekering van € 5,00/dag is daarmee ongeveer 260
   documenten per dag over *alle* gebruikers samen; dat is ruim voor de eerste gebruikers
   en krap voor tien tegelijk. De billing-tak had hier gelijk en dit was een echte
   correctie.

---

## 5. Wat de runbook-stappen nu worden

De volgorde uit `docs/LAUNCH.md` klopt grotendeels; dit zijn de afwijkingen.

**Migraties.** Draai in deze volgorde:
`ai_spend_guard.sql` → `subscription_plans_fair_use.sql` → `billing_subscription.sql`
(de aangepaste versie zonder proefklok) → `retention_purge.sql` → `snelstart_connection.sql`.
`trial_30_days.sql` en `billing_trial_reminder.sql` bestaan hier niet.

**Stripe.** Twee prijzen in plaats van één: **€ 12,99/maand incl. btw** (terugkerend) en
**€ 19 per bewaarjaar incl. btw** (eenmalig). iDEAL aan, Invoicing aan, Billing Portal met
zelfbedieningsopzegging aan.

**Omgeving.** `STRIPE_PRICE_ID_PLUS`, `STRIPE_PRICE_ID_KLUIS_YEAR`,
`STRIPE_WEBHOOK_SECRET`, `AI_DAILY_BUDGET_EUR=0` (eerst tellen), `RETENTION_PURGE_ENABLED`
leeg laten. `BILLING_ENFORCED` bestaat niet meer.

**De poort van §6 verandert wezenlijk, en dit is het belangrijkste punt van dit document.**
De runbook stelt: 10 mensen, vraag om de kaart, ≥3 betalen → doorgaan. Dat kan niet meer:
het product is gratis, dus er is niets te vragen. De prijs van de keuze die de eigenaar
heeft gemaakt is **dat er geen vroege inkomstensignaal meer is**. De poort moet daarom
worden:

> 10 persoonlijk begeleide gebruikers · ≥3 nog actief ná één volledig afgesloten kwartaal ·
> ≥1 boekhouder die het kwartaal daadwerkelijk heeft opgehaald.

Betalen komt later, uit Plus en uit de Bewaarkluis. Wie dat ongemakkelijk vindt heeft
gelijk — het is een echte kostenpost van het gratis model, en het is precies waarom de
Bewaarkluis nu bestaat. Zie `docs/BEWAARKLUIS_BUSINESS_CASE.md`.

**Geen advertenties** voordat die poort door is. Dat advies staat onverkort.

---

## 6. Toestand van deze tak

`tsc` schoon · 169 tests groen · productie-build compileert.

Nieuwe of gewijzigde bestanden die de andere sessie waarschijnlijk wil zien:
`src/lib/bewaarkluis.ts` · `src/lib/plan.ts` · `src/lib/subscription.ts` (+ test) ·
`src/lib/fair-use.ts` · `supabase/migrations/billing_subscription.sql` ·
`src/app/prijzen/page.tsx` · `src/content/legal/algemene-voorwaarden.ts` §5.7 en §10.3 ·
`docs/BEWAARKLUIS_BUSINESS_CASE.md`.
