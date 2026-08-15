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
> ### Nog open: vijf — één daarvan vóór de eerste echte gebruiker
>
> **`storage_bucket_hardening.sql`** — de enige op deze lijst die vóór livegang moet. Hij
> verandert vandaag NIETS: op 29 juli is gemeten dat de `documents`-bucket privé staat en de app
> deelt uitsluitend via ondertekende URL's. Het probleem is de herkomst van die stand — één
> vinkje in een dashboard, in geen enkel bestand, door geen enkele test bewaakt. Zet je ooit een
> tweede omgeving op (staging, herstel na een incident), dan begint die op de Supabase-standaard
> en staat elk bonnetje, elk bankafschrift en elke factuur-PDF publiek zonder dat er iets misgaat
> op een manier die opvalt. Dit legt de stand vast in code. Draai hem.
>
> **`cron_runs.sql`** — legt vast DÁT een cron gedraaid heeft. Zonder deze tabel blijft de
> hartslag in `/api/health` leeg: valt email-sync, reminders of quarter-close stil, dan is er geen
> scherm dat het toont en geen mail die uitblijft die iemand mist. Je merkt het bij de
> kwartaalafsluiting die nooit kwam. Niet stukmakend, wel de reden dat je health-pagina anders
> minder weet dan ze suggereert.
>
> **`bank_ignore_reason.sql`** — een reden bij een genegeerde bankregel. Kolom is NULL voor alles
> wat er al staat; zonder de migratie blijft de reden simpelweg leeg. Mag wachten.
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
| 11 | `cash_entry_soft_delete.sql` | zet zachte verwijdering in het kasboek AAN; tot dan blijft een kasboeking hard verwijderd |
| 12 | `invoice_line_discount.sql` | korting per factuurregel |
| 13 | `creditnota_partial.sql` | een creditnota voor een DEEL van een factuur |
| 14 | `offerte_akkoord.sql` | de klant kan zelf akkoord geven op een offerte |
| 15 | `invoice_bijlage.sql` | één eigen bestand met de factuurmail mee |
| 16 | `rpc_anon_revoke.sql` | ⚠️ **de geld-functies zijn aanroepbaar zonder account — draai deze als eerste** |
| 17 | `function_search_path.sql` | een vast zoekpad op de negen eigen functies — hygiëne, geen haast |

**Over 16 — dit is de enige met haast.** De andere migraties voegen iets toe; deze sluit iets af
dat open staat. Een reeks `SECURITY DEFINER`-functies bewaakt zichzelf met
`IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id`, waarvan de gedachte is: "service_role
heeft geen uid, dus dat is de server". Klopt — maar `anon` heeft óók geen uid, en `anon` is de rol
achter de publieke sleutel die in elke browserbundel meegaat. Nagemeten op de productiedatabase:
`SET LOCAL ROLE anon; SELECT auth.uid() IS NULL` → true, en `anon` had EXECUTE op alle dertien.

Het zwaarste geval is niet het grootste bedrag maar het onomkeerbare: `seed_invoice_counter` kan
door `GREATEST` alleen vooruit, dus verlagen kan niemand — maar de teller van een vreemde op
999999999 zetten wél, en een kapotte Art. 35-reeks is niet te herstellen. Daarnaast staan het
boeken en verplaatsen van betalingen open op andermans administratie.

Intrekken in plaats van dertien guards aanscherpen: een rechtencontrole draait vóór de body en is
niet te omzeilen door `SECURITY DEFINER`. De guards blijven staan voor ingelogde gebruikers
onderling. Geen enkele aanroep in deze app gebeurt als `anon` — alle call sites nagelopen — dus er
gaat niets van kapot; `service_role` wordt in de migratie expliciet opnieuw gemachtigd.

> **Stand op 15 augustus 2026, gelezen uit de productiedatabase:** deze migratie is TOEGEPAST.
> `has_function_privilege('anon', …)` is nu false voor alle dertien, `service_role` houdt overal
> EXECUTE, en de zes functies die het scherm aanroept houden `authenticated`. De linter noemt onder
> `anon` alleen nog de vijf leeshulpjes die met opzet buiten deze migratie bleven — zie hieronder.

> **Stand op 15 augustus 2026, gelezen uit de productiedatabase:** 17 is TOEGEPAST. Alle negen
> tonen `search_path=public, pg_catalog, pg_temp`; nul staan er nog los. Daarna een UPDATE op
> `invoices` binnen een teruggedraaide transactie: de hele triggerketen liep zonder fout, dus elke
> functie vindt haar namen onder het nieuwe pad. Er is niets geschreven.

**Over 17.** Alleen metadata: `ALTER FUNCTION … SET search_path`, geen functie wordt herschreven.
Er is **geen haast**, en dat staat er expliciet bij omdat de vorige regel wél haast had. Op de
productiedatabase nagemeten: geen van de negen is `SECURITY DEFINER`, en noch `anon` noch
`authenticated` heeft CREATE op énig schema — twee onafhankelijke redenen waarom er niets te kapen
valt. Het wordt toch vastgezet omdat dat omstandigheden zijn en geen afspraken: wie morgen één van
deze bewakers `SECURITY DEFINER` maakt, erft anders stilzwijgend een echte kwetsbaarheid.
Terugdraaien is één regel per functie (`RESET search_path`).

---

## Wat de linter meldt en met opzet zo blijft

Niet elke melding is een taak. Deze drie zijn nagekeken en blijven staan, met de reden erbij — een
lijst waar bekende-en-geaccepteerde meldingen tussen staan zonder uitleg is een lijst die niemand
meer leest.

- **Vijf `SECURITY DEFINER`-functies die `anon` mag aanroepen** — `acting_for_owner`,
  `is_my_accountant_client`, `has_active_invoice_mandate`, `has_active_confirm_mandate`,
  `audit_row_is_about_me`. Alle vijf zijn `STABLE`/`IMMUTABLE`: ze veranderen niets en geven een
  boolean of één uuid terug. Ze worden samen in **19 RLS-policies** aangeroepen, en een policy
  draait als de bevragende rol — `anon` het recht afnemen zou dus LEZEN breken op de publieke
  pagina's in plaats van schrijven dichtzetten. Dat is de verkeerde kant op.
- **`rls_enabled_no_policy` op `ai_spend_daily`, `cron_runs`, `email_skipped_attachments`** — RLS
  aan met nul policies betekent **alles geweigerd** voor `anon` en `authenticated`; alleen
  `service_role` komt erlangs, en dat is precies wat deze drie tabellen nodig hebben. De linter
  meldt het als INFO omdat het meestal een vergeten policy is; hier is het de bedoeling.
- **`extension_in_public` op `pg_trgm`** — verplaatsen betekent elke index en elke functie die
  eraan hangt opnieuw opbouwen, voor een melding die geen rechten verruimt.

Eén melding is **wél** een taak en staat niet in SQL: **Leaked Password Protection** staat uit.
Aanzetten is één schakelaar in het Supabase-dashboard onder *Authentication → Policies*; Supabase
controleert een nieuw wachtwoord dan tegen HaveIBeenPwned.

**Over 12 t/m 15.** Deze horen bij vier functies die al op `main` staan. Ze hebben geen onderlinge
volgorde en mogen los van elkaar. **Zonder de migratie werkt de app precies als de dag ervoor** —
elke functie is aan de kolom vastgeknoopt, niet aan een schakelaar, en de code weigert het NIEUWE
in plaats van het bestaande stuk te maken:

- **12** — een concept met een regelkorting wordt teruggedraaid en de ondernemer leest waarom
  (`/api/invoice/draft`, HTTP 503). Een factuur zonder regelkorting merkt niets.
- **13** — de oude unieke index laat één creditnota per factuur toe, dus een tweede deelcreditnota
  wordt door de database geweigerd. Het plafond (Σ|credits| ≤ |origineel|) staat óók in de route en
  in `partial-credit.ts`, dus het bedrag kan nooit te hoog worden; de migratie voegt de
  vergrendeling tegen twee gelijktijdige verzoeken toe.
- **14** — de offertemail gaat zonder akkoordknop de deur uit, met een luide regel in het log
  (`send-offerte`). De offerte zelf verstuurt gewoon.
- **15** — de bijlage kan per verzending worden meegegeven maar wordt niet op de factuur onthouden.
  De weigering blijft vóór het factuurnummer staan, dus er ontstaat nooit een gat in de reeks.

> **Stand op 15 augustus 2026 — 11 is TOEGEPAST, GEMELD door de eigenaar en niet nagemeten.**
> Dat onderscheid staat er omdat de waarschuwing bovenaan dit document er precies over gaat: de
> verbinding met de database was weg op het moment van melden, dus dit is een bewering en geen
> lezing. Draai `docs/WELKE_MIGRATIES_STAAN_ER.sql` of het CONTROLE-blok onderin de migratie om er
> een lezing van te maken. Let daarbij vooral op de definitie van
> `cash_entries_one_settlement_per_instalment`: staat `deleted_at` er niet in, dan is de DROP/CREATE
> niet gedraaid en houdt een verwijderde tegenboeking haar plek bezet.
>
> Wat er vóór toepassing wél is gemeten: beide voorwaarden stonden er (`invoice_id`,
> `settlement_id`), de index stond nog in zijn oude vorm, en de tabel telde 14 rijen. Dat was geen
> formaliteit — dit bestand faalt halverwege, ná de geslaagde ALTER, op een database waar die twee
> kolommen ontbreken.
>
> **De code-kant is wél gemeten, en die is compleet.** Alle 24 aanroepen op `cash_entries` in
> `src/` en `scripts/` vallen aan de goede kant: 18 gaan door `cash-live.ts`, 5 zijn zelf een
> schrijfactie, 1 is de capability-probe. Nul werden alleen vrijgesteld doordat er toevallig een
> insert in de buurt stond — de poort is dus niet groen bij toeval.

**Over 11.** Deze mag op elk moment, ook los van de rest, en er zit geen haast bij: de app werkt er
volledig zonder. De code PROBEERT de kolom (`src/lib/cash-live.ts`) en gedraagt zich zonder hem
precies zoals de dag ervoor — een verwijderde kasboeking wordt dan echt verwijderd, met alleen het
auditspoor als bewijs. Zodra deze SQL staat, gaat zachte verwijdering vanzelf aan: een verwijderde
regel telt nergens meer mee (saldo, kasboek, resultaat, aangifte, readiness, de blokkade op indienen,
zoeken, het pakket voor de boekhouder) maar blijft leesbaar en omkeerbaar. Draai hem NA
`cash_settlement_invoice_link.sql` en `cash_settlement_per_instalment.sql`: onderin wordt hún unieke
index opnieuw gebouwd, en die noemt `invoice_id` en `settlement_id`.

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
