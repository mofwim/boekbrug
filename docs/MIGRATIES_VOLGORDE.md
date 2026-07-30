# Migraties — de volgorde waarin je ze toepast

*Stand van tak `claude/snelstart-integration-opix9l`, 29 juli 2026.*

> ## ⚠️ LEES DIT EERST: DEZE LIJST IS NIET DE WAARHEID
>
> Een handmatig bijgehouden "wat staat er nog open" is een BEWERING over een database die
> niemand meer heeft bekeken. Hij loopt achter zodra iemand een migratie draait zonder deze
> markdown bij te werken, of zodra een tweede tak er een migratie bij zet.
>
> **En dat is precies wat er is gebeurd.** Twee takken werkten tegelijk aan deze lijst. De ene
> meldde 13 en 14 als toegepast en noemde 10, 11 en 12 nog open; de eigenaar had 10, 11 en 12
> op 26–28 juli juist wél toegepast, mét CONTROLE. Beide lijsten hadden het dus deels mis, en
> geen van beide kon dat zelf weten. Een lijst die het mis heeft over de veiligheid van iemands
> boekhouding is erger dan geen lijst.
>
> **Vraag het daarom aan de database zelf:**
>
> ```
> docs/WELKE_MIGRATIES_STAAN_ER.sql
> ```
>
> Één query in de Supabase SQL-editor, leest alleen de catalogus, verandert niets. De
> OPEN-regels staan bovenaan, met per regel waarom die migratie bestaat. Dat antwoord klopt
> altijd; dit document niet noodzakelijk.
>
> ### De stand op 29 juli 2026 — GELEZEN UIT DE DATABASE, niet gemeld
>
> Dit is de uitkomst van `WELKE_MIGRATIES_STAAN_ER.sql` tegen de productiedatabase. Dat is een
> ander soort zekerheid dan de rest van dit document: geen bewering van een tak, maar wat er
> daadwerkelijk staat.
>
> | # | Bestand | Wat het dichtte |
> |---|---------|-----------------|
> | 10 | `kluis_subscriptions.sql` | Geld aannemen zonder de bewaarverplichting ergens vast te leggen |
> | 11 | `accountant_write_holes.sql` | Het IBAN-schrijfgat in de boekhoudersgrens + vier ontbrekende indexen |
> | 12 | `invoice_lines_accountant_gate.sql` | Een verstuurde factuur toonde de boekhouder een lege regelset |
> | 13 | `invoice_archive_reason.sql` | `archive_reason` + `archived_at` + CHECK + partiële index |
> | 14 | `email_sender_rules.sql` | Tabel + unieke index + RLS met vier policies |
> | 15 | `snelstart_claim_before_push.sql` | Twee gelijktijdige verzoeken konden dezelfde factuur twee keer in het wettelijke inkoopboek zetten |
> | 16 | `cash_settlement_per_instalment.sql` | Kasboekregels per termijn in plaats van één per factuur |
> | 17 | `invoice_schedules.sql` | Terugkerende facturen |
>
> ### Nog open: twee, en beide mogen wachten
>
> **19 · `bank_statement_periods.sql`** — onthoudt per bankafschrift welke periode het beslaat
> en met welke begin- en eindsaldi. Zonder deze tabel kan niemand zien dat er een MAAND
> ontbreekt: wie januari en maart uploadt heeft twee bestanden die allebei perfect kloppen, en
> `bankTxCount` is niet nul, dus ook de readiness zwijgt. De parser las die saldi al; ze werden
> nergens bewaard.
>
> Draait de migratie niet, dan vervalt stil alleen deze ene controle — de app draait er verder
> ongewijzigd zonder. Genummerd 19, niet 13: die tak was los ontstaan en had 13 al vergeven aan
> `invoice_archive_reason.sql`. Dat is precies het soort botsing waar de waarschuwing bovenaan
> dit document over gaat, dus geldt ook hier: `WELKE_MIGRATIES_STAAN_ER.sql` is de waarheid,
> deze regel is een bewering.
>
> **18 · `search_engine_clients_kvk_city.sql`** — twee trigram-indexen op `clients.kvk_number`
> en `clients.city`, plus `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
>
> Dit is de enige in de hele reeks die je met een gerust hart kunt laten liggen, en dat is geen
> inschatting maar wat het bestand over zichzelf zegt: *"Geen schema-, data- of
> gedragswijziging — puur snelheid."* Zoeken op KVK-nummer en plaats **werkt vandaag al**; het
> doet een scan die door `.eq(user_id)` per gebruiker begrensd blijft. Bij een handvol klanten
> is dat microseconden; bij een groot klantenregister loont de index. Twee CREATE INDEX-regels,
> vijf seconden, geen risico — dus draai hem gerust, maar er is niets stuk tot je dat doet.
>
> ### De terugvalpaden blijven staan
>
> Ze kosten niets (ze vuren alleen op een fout) en ze houden een verse dev- of
> staging-database werkend zolang die migraties daar nog niet gedraaid zijn. Elke migratie in
> dit project is zo geschreven dat de code er ZONDER ook werkt: de negeer-API archiveert dan
> zonder notitie, het kasboek maakt één regel per factuur in plaats van per termijn, de
> SnelStart-push valt terug op het oude pad. De eigenaar mist dan een label of een verbetering
> — nooit een functie die stukgaat, en nooit stille schade.
>
> Eén terugvalpad is bij het toepassen wél aangescherpt: het regels-eindpunt slikte vóórdien
> élke fout en antwoordde "geen regels". Dat was verdedigbaar toen de tabel nog niet bestond,
> maar nu gevaarlijk — bij een RLS- of verbindingsfout zou het beheerscherm "geen regels"
> tonen terwijl er regels zijn die post tegenhouden, en dan kan de eigenaar ze niet opheffen.
> Het onderscheidt nu "tabel bestaat niet" (stille lege lijst) van een echte fout (die wordt
> gezegd).
>
> ### En draai altijd het CONTROLE-blok
>
> Onderaan elk migratiebestand staat er één. Dat is het verschil tussen "toegepast" en
> "toegepast en gecontroleerd", en het heeft in deze codebase al twee echte fouten opgeleverd
> die op geen andere manier zichtbaar waren: een 42P10 op een partiële index, en een functie
> die vijf kolommen noemde die niet bestonden.
>
> ### Wat ik NIET weet
>
> `invoice_archive_reason.sql`, `email_sender_rules.sql`, en de drie die uit andere takken
> bij kwamen (`cash_settlement_per_instalment.sql`, `invoice_schedules.sql`,
> `search_engine_clients_kvk_city.sql`). Geen van deze is urgent — de code werkt er zonder
> ook, zie de noot hieronder — maar raad er niet naar: draai de query.
>
> ### Waarom "niet urgent" hier echt niet urgent betekent
>
> Elke migratie in dit project is zo geschreven dat de code er ZONDER ook werkt. De
> negeer-API valt bij een ontbrekende kolom terug op archiveren *zonder* notitie, de
> Genegeerd-query op de kale kolomlijst (geen leeg tabblad), het regels-eindpunt antwoordt
> "geen regels", het kasboek maakt één regel per factuur in plaats van per termijn, en de
> SnelStart-push valt terug op het oude pad. De eigenaar mist tot die tijd een label of een
> verbetering — nooit een functie die stukgaat, en nooit stille schade.
>
> De twee met een échte scherpe kant waren 11 (een gekoppelde boekhouder kon het IBAN op een
> openstaande inkoopfactuur herschrijven) en 15 (twee gelijktijdige verzoeken konden dezelfde
> factuur twee keer in het wettelijke inkoopboek zetten). **Beide zijn toegepast.**
>
> ### En draai altijd het CONTROLE-blok
>
> Onderaan elk migratiebestand staat er één. Dat is het verschil tussen "toegepast" en
> "toegepast en gecontroleerd", en het heeft in deze codebase al twee echte fouten
> opgeleverd die op geen andere manier zichtbaar waren: een 42P10 op een partiële index, en
> een functie die vijf kolommen noemde die niet bestonden.

> ### Over de urgentie van 11 — eerlijk bijgesteld
>
> Bij het overbrengen is dit gat te scherp gerapporteerd. De correctie, zelf geverifieerd:
>
> `acc_status_owner_all` staat inderdaad als `FOR ALL` zonder koppelingseis, dus élke
> ingelogde gebruiker kan met de anon-sleutel rijen schrijven tegen een willekeurige
> document-uuid. Maar **geen enkel eigenaarsscherm rendert `vraag_text`**:
> `dashboard/brug/page.tsx:189-201` leest die kolom alleen wanneer `isAccountant`, en het
> comment daar zegt het zelf ("A ZZP owner gets an empty map"). Een grep op `vraag_text`
> geeft precies twee levende plekken: de schrijver en die boekhouder-only lezer. De unieke
> index `(accountant_id, subject_type, subject_id)` sluit bovendien uit dat een aanvaller de
> rij van een échte boekhouder overschrijft.
>
> Dus: **een latent schrijfgat dat dicht moet, geen live injectie in andermans dashboard.**
> Het wordt pas live op de dag dat er een eigenaarsscherm bijkomt dat die vraag toont — en
> dat scherm is precies het volgende dat gebouwd zou moeten worden. Vandaar: eerst 11, dan
> dat scherm. Niet andersom.
>
> Het IBAN-gat in dezelfde migratie is wél onmiddellijk echt: een gekoppelde boekhouder kan
> `vendor_iban` op een openstaande inkoopfactuur herschrijven en de klant tikt dat nummer
> over in zijn bank.

> **Alles hieronder is idempotent en verwijdert niets.** Twijfel je of iets al is toegepast:
> gewoon opnieuw draaien. Een migratie die er al staat is een no-op.
>
> Draai ze in de **Supabase SQL-editor**. Die draait als `service_role`, en dat is nodig:
> het slot uit stap 3 blokkeert wijzigingen aan abonnementskolommen door gewone gebruikers.

---

## Stap 0 — Controleer drie dingen die géén migratie aanmaakt

Drie migraties hieronder bouwen voort op objecten die in productie bestaan maar die door
**geen enkel bestand in deze repo** worden aangemaakt (ze zijn ooit direct in het
Supabase-dashboard gemaakt). Ze bestaan vrijwel zeker — de bijbehorende functies werken —
maar dit kost vijf seconden en bespaart een onbegrijpelijke foutmelding halverwege:

```sql
select
  to_regclass('public.rate_limits')        as rate_limits,        -- nodig voor stap 5
  to_regclass('public.deletion_requests')  as deletion_requests,  -- nodig voor stap 6
  (select count(*) from pg_trigger
    where tgname = 'on_auth_user_created') as signup_trigger;     -- nodig voor stap 4
```

Verwacht: twee tabelnamen en `1`. Is er iets `null` of `0`, meld dat dan even — die stap
moet dan anders.

---

## De volgorde

### 1. `circle_integrity_and_indexes.sql` — *blokkeert bestaande functies*

Kolommen waar de code al van uitgaat (`content_hash`, `shared`, `needs_reauth`) plus
FK-indexen. Stond al langer open in `docs/WORK_QUEUE.md`. Niets nieuws van deze tak, maar
dit is het enige dat *nu al* iets stuk laat gaan.

### 2. `ledger_daily.sql` — *blokkeert bestaande functies*

De grootboek-kruiscontrole (hoek 3 van de afletterdriehoek). **Zonder deze tabel kan een
grootboek-upload niet opslaan.** Ook al langer open.

### 3. `subscription_plans_fair_use.sql`

Trekt `subscription_plan` gelijk met wat de voorwaarden publiceren: `free | plus |
boekhouder`. Het oude model kende `pro` en `boekhouder_pro` — plannen die nooit zijn
geactiveerd en die de voorwaarden niet meer kennen.

**Moet vóór stap 4 en 5.** De Stripe-webhook schrijft de waarde `'plus'`; staat de oude
CHECK er nog, dan weigert Postgres de **hele rij** — inclusief de statuskolom die bepaalt of
iemand Plus heeft.

### 4. `billing_subscription.sql`

`subscription_status`, `stripe_customer_id`, `current_period_end`, plus het **slot tegen
zelfbediening**. Zonder die trigger kan elke ingelogde gebruiker zichzelf vanuit de
browserconsole `active` geven: `profiles_update_own` kent geen kolombeperking.

Deze versie heeft **geen proefklok** — geen `trial_ends_at`, en de controlequery onderaan
vraagt expliciet of die kolom afwezig is. Zie `docs/PORT_VAN_BILLING_TAK.md` §2.4.

### 5. `account_purpose_archief.sql`

`profiles.account_purpose` (`boekhouden | archief`) en de aangepaste `handle_new_user()`.
Maakt de voordeur van `/bewaarplicht` echt: wie via `?doel=archief` binnenkomt slaat de
wizard over en landt in zijn kluis.

**Hangt af van de trigger uit stap 0.** Bestaat die niet, dan valt de app terug op het
zelfherstel in `/register` en `/dashboard/kluis` — het werkt dan nog steeds, alleen via een
omweg.

### 6. `fair_use_usage.sql`

`usage_counters` + `fair_use_consume()` + `fair_use_release()`. Hierna meet het beleid
eerlijk gebruik werkelijk, in plaats van alleen gepubliceerd te zijn.

Tot je dit toepast faalt alles **open**: er wordt niets geteld en niemand wordt gepauzeerd.
Dat is de veilige kant, maar het betekent ook dat de begrenzing zolang volledig op de
dagzekering uit stap 7 rust.

### 7. `ai_spend_guard.sql` — ⚠️ **de belangrijkste als je er maar één doet**

Het euro-plafond per dag op Anthropic-uitgaven, plus een wérkende anonieme ratelimiet.

Waarom die urgentie: de limiet op `/api/tools/scan-invoice` bucketde op `'scan-ip:<ip>'`
tegen een `uuid`-kolom met foreign key naar `profiles`. Elke aanroep gaf een cast-fout en de
limiter faalde open — de **login-vrije scanner die de betaalde API aanroept had in de
praktijk nooit een plafond**.

> ⚠️ **Deze migratie is één keer gecorrigeerd nadat hij was toegepast.** De eerste versie
> gebruikte een kaal `ON CONFLICT (bucket_key, endpoint)` terwijl de unieke index PARTIEEL
> is; Postgres leidt een partiële index daar niet uit af en gaf `42P10` bij elke aanroep.
> Omdat `checkRateLimitByKey()` bewust DICHT faalt, betekende dat: de login-vrije scanner
> zou ELK verzoek hebben geweigerd — een dichte deur op een marketingpagina.
>
> Gevonden door de CONTROLE tegen een echte database te draaien, niet door te lezen: `tsc`,
> 183 tests en de productiebuild raken geen SQL aan. **Draai deze migratie opnieuw als je
> hem vóór 26 juli 2026 had toegepast** — hij is idempotent en vervangt alleen de functie.

*(Hij staat op 7 en niet op 1 omdat 1 en 2 bestaande functies blokkeren. Zit je in tijdnood:
doe deze eerst en de rest morgen.)*

### 8. `retention_purge.sql`

`deletion_requests.purged_at` + de index, zodat AVG-verwijdering idempotent kan draaien.

**Zet `RETENTION_PURGE_ENABLED` NIET op `true`** vóór stap 10. Zonder die tabel weet de purge
niet wie hij *niet* mag aanraken. Sinds stap 10 bestaat die koppeling wél, en faalt de cron
bovendien DICHT als hij `kluis_subscriptions` niet kan lezen: dan wist hij niets. Niets in deze app kan vóór 2033 aan de beurt zijn; meldt
een dry run nu al een kandidaat, dan is er een datum verkeerd gezet.

### 9. `snelstart_connection.sql` — *alleen als je de koppeling wilt*

Twee tabellen voor de SnelStart B2B-koppeling. De maatwerksleutel gaat in Supabase Vault,
nooit in een gewone kolom. **Vereist ook `SNELSTART_SUBSCRIPTION_KEY` in de omgeving** — die
heb je nog niet, dus deze mag gerust wachten.

### 10. `kluis_subscriptions.sql` — ⚠️ **nieuw, vóór er één euro binnenkomt**

Wie er een Bewaarkluis heeft gekocht en tot welk jaar.

Dit moet er zijn **voordat** `STRIPE_PRICE_ID_KLUIS_YEAR` wordt ingevuld. De Bewaarkluis
rekent af met `mode: "payment"` — een eenmalige betaling zonder abonnement — en de webhook
zocht bij elk event een subscription id. Zonder deze tabel en de bijbehorende
webhook-afhandeling betekende een Bewaarkluis-betaling letterlijk: *geld aangenomen,
verplichting nergens vastgelegd.* Erger dan het product niet hebben.

Het is ook het hek dat `RETENTION_PURGE_ENABLED` eindelijk aan mag laten: een account met
een lopende kluis wordt overgeslagen, ook als zijn eigen zeven jaar verstreken zijn.

---

## Samengevat

| # | Bestand | Waarom nu |
|---|---------|-----------|
| 1 | `circle_integrity_and_indexes.sql` | blokkeert bestaande functies |
| 2 | `ledger_daily.sql` | blokkeert bestaande functies |
| 3 | `subscription_plans_fair_use.sql` | moet vóór 4 en 5 |
| 4 | `billing_subscription.sql` | sluit een gat dat pas ontstaat als de kolommen er zijn |
| 5 | `account_purpose_archief.sql` | maakt de archief-voordeur echt |
| 6 | `fair_use_usage.sql` | laat het eerlijk gebruik meten |
| 7 | `ai_spend_guard.sql` | **de enige harde bodem onder je Anthropic-rekening** |
| 8 | `retention_purge.sql` | AVG-verwijdering; blijft dry run |
| 9 | `snelstart_connection.sql` | pas nodig met een subscription key |
| 10 | `kluis_subscriptions.sql` | **vóór de eerste Bewaarkluis-betaling** |

Na afloop staat onderaan elk bestand een **CONTROLE**-blok. Draai dat — het is per migratie
één query en het is het verschil tussen "toegepast" en "toegepast en gecontroleerd".

---

## Wat er daarna nog moet (geen SQL)

- **De bedrijfsidentiteit in Vercel**: `NEXT_PUBLIC_COMPANY_KVK`, `_LEGAL_NAME`, `_BTW`,
  `_ADDRESS`. Nu tonen de voorwaarden "(volgt)" — bewust, zodat een leeg veld nooit als een
  echt-maar-onjuist KVK-nummer kan lezen. `/steun` blijft 404 tot er een echt KVK staat.
- **Twee Stripe-prijzen**: `STRIPE_PRICE_ID_PLUS` (€ 12,99/maand, terugkerend, incl. btw) en
  `STRIPE_PRICE_ID_KLUIS_YEAR` (€ 19 per bewaarjaar, eenmalig, incl. btw). Plus
  `STRIPE_WEBHOOK_SECRET`.
- **`AI_DAILY_BUDGET_EUR=0`** voor de eerste dagen: dat telt wél maar begrenst niet, zodat je
  je werkelijke uitgaven leert kennen voordat je een getal kiest.
- **`xlsx` naar 0.20.3**, in een omgeving die `cdn.sheetjs.com` kan bereiken (hier én in de
  andere sessie geeft die host 403).
