# Migraties — de volgorde waarin je ze toepast

*Stand van tak `claude/snelstart-integration-opix9l`, 26 juli 2026.*

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
praktijk nooit een plafond**. Zolang deze migratie niet is toegepast is dat nog steeds zo.

*(Hij staat op 7 en niet op 1 omdat 1 en 2 bestaande functies blokkeren. Zit je in tijdnood:
doe deze eerst en de rest morgen.)*

### 8. `retention_purge.sql`

`deletion_requests.purged_at` + de index, zodat AVG-verwijdering idempotent kan draaien.

**Zet `RETENTION_PURGE_ENABLED` NIET op `true`.** Zonder die variabele draait de cron als dry
run, en dat moet zo blijven tot er een `kluis_subscriptions`-tabel is — anders weet de purge
niet wie hij *niet* mag aanraken. Niets in deze app kan vóór 2033 aan de beurt zijn; meldt
een dry run nu al een kandidaat, dan is er een datum verkeerd gezet.

### 9. `snelstart_connection.sql` — *alleen als je de koppeling wilt*

Twee tabellen voor de SnelStart B2B-koppeling. De maatwerksleutel gaat in Supabase Vault,
nooit in een gewone kolom. **Vereist ook `SNELSTART_SUBSCRIPTION_KEY` in de omgeving** — die
heb je nog niet, dus deze mag gerust wachten.

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
