# Migraties toepassen — van "code klaar" naar "live klaar"

De live-trust-check (`docs/live-trust-check.sql`, sectie A) liet zien dat een deel
van wat in de code zit, **nog niet op de live database staat**. Zolang een migratie
niet is toegepast, is die functie DOOD op live — ook al bestaat de code. Deze lijst
brengt live in lijn met de code.

**Hoe:** open elke `.sql` hieronder in de Supabase SQL-editor (Database → SQL) en
Run 'm. Draai daarna sectie A van `live-trust-check.sql` opnieuw; elke kolom moet
`true` zijn. Alle migraties zijn nu **her-uitvoerbaar** — tabellen/kolommen gebruiken
`IF NOT EXISTS` en elke RLS-policy staat nu achter een `DROP POLICY IF EXISTS`, dus je
kunt ze allemaal draaien zonder je zorgen te maken over wat al is toegepast. De twee met
een ⚠️ vragen aandacht.

> **Zie je `ERROR: 42710: policy "…" already exists`?** Dat betekende alleen dat die
> migratie AL was toegepast (`CREATE POLICY` kent geen `IF NOT EXISTS`). Opgelost: elke
> policy heeft nu een `DROP POLICY IF EXISTS` ervoor. Gebruik de HUIDIGE versie van de
> bestanden (opnieuw kopiëren/plakken) en de fout verdwijnt.

> Draai ze in deze volgorde. Tabellen komen vóór de kolommen/policies die ernaar
> verwijzen; onafhankelijke migraties mogen in elke volgorde omdat ze `IF NOT EXISTS`
> gebruiken.

## 1) Structurele migraties (veilig, idempotent)

| # | Bestand | Wat het toevoegt | Sectie-A vlag die `true` wordt |
|---|---------|------------------|--------------------------------|
| 1 | `supabase/migrations/crm_backbone.sql` | Klanten-registry (mini-CRM) + `invoices.client_id` + `clients.notes` | `invoices_client_id`, `clients_notes` |
| 2 | `supabase/migrations/articles.sql` | Artikelen-catalogus (gecodeerde regels) | `articles` |
| 3 | `supabase/migrations/daily_turnover.sql` | Dagomzet (kassa Z-rapport), per BTW-tarief | `daily_turnover` |
| 4 | `supabase/migrations/eft_settlements.sql` | EFT-terminalafrekeningen (kaart-driehoek) | `eft_settlements` |
| 5 | `supabase/migrations/cash_ledger.sql` | Kasboek (kasadministratie) | `cash_entries` |
| 6 | `supabase/migrations/bank_identity.sql` | `bank_transactions.category` + counterpart-geheugen | `bank_category` |
| 7 | `supabase/migrations/betaalverzoek.sql` | Betaalverzoek + `invoices.pay_token` | `invoices_pay_token` |
| 8 | `supabase/migrations/accountant_subject_status.sql` | Verwerkingsstatus per onderwerp (boekhouder) | — (prod-drift herstel) |
| 9 | `supabase/migrations/search_engine.sql` | `pg_trgm` + trigram-indexen voor snelle ILIKE-zoek (globale zoekmachine) | — (alleen prestaties) |
| 10 | `supabase/migrations/search_smart.sql` | Fuzzy (typo-tolerante) zoekfuncties `search_invoices_fuzzy`/`search_clients_fuzzy` | — (zoeken werkt ook zonder; dan geen typo-tolerantie) |

## 2) ⚠️ Facturnummering — MAAK EERST EEN BACKUP

`supabase/migrations/factuur_b_numbering.sql` maakt `invoice_counters` én doet een
**backfill** van bestaande nummers. Het bestand zegt het zelf: **eerst een backup**
(Supabase → Database → Backups, of `pg_dump`). Lees de kop van het bestand vóór je Run
klikt. Dit levert de Sectie-A vlag `invoice_counters` + zet B3 (nummer-gaten) in werking.

## 3) ⚠️ Beveiliging — uitnodigingen afschermen

`supabase/migrations/invitations_rls_scoped_read.sql` vervangt de policy
`"public can read invitations" USING (true)` (waarmee ELKE bezoeker, ook anoniem, elk
uitnodigings-token en e-mailadres kon uitlezen) door een lezing die alleen de uitnodiger
of de genodigde toelaat. `database.sql` bevat inmiddels dezelfde afgeschermde policy, dus
een verse provisioning is meteen veilig; deze migratie doet hetzelfde op een bestaande DB.
De accept-route leest de uitnodiging via service_role en dwingt de e-mailmatch zelf af, dus
de flow blijft werken. **Los toe te passen — het dicht een lek.**

## NIET in deze lijst

`supabase/migrations/BRIDGE-D_soft_delete_test_pollution.sql` is een **eenmalige
opschoning** van 6 stuks testdata (soft-delete), geen functie-migratie. Alleen draaien als
je die specifieke testrommel wilt opruimen — niet nodig voor de functionaliteit.

## Verificatie (draai na afloop)

Plak sectie A uit `docs/live-trust-check.sql` en Run. Alle kolommen moeten `true` zijn:

```sql
SELECT 'A. migraties toegepast?' AS check,
       to_regclass('public.daily_turnover')  IS NOT NULL AS daily_turnover,
       to_regclass('public.eft_settlements') IS NOT NULL AS eft_settlements,
       to_regclass('public.articles')        IS NOT NULL AS articles,
       to_regclass('public.cash_entries')    IS NOT NULL AS cash_entries,
       to_regclass('public.invoice_counters')IS NOT NULL AS invoice_counters,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='client_id')  AS invoices_client_id,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='pay_token')  AS invoices_pay_token,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='clients'  AND column_name='notes')      AS clients_notes,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='bank_transactions' AND column_name='category') AS bank_category;
```

Daarna sectie B (de trust-invarianten) — die vertellen of de cijfers zelf kloppen.
