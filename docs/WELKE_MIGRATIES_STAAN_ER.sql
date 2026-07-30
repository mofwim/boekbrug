-- =====================================================================
-- WELKE MIGRATIES STAAN ER ÉCHT? — één query, het echte antwoord.
-- BoekBrug · juli 2026
-- =====================================================================
-- WAAROM DIT BESTAAT
--
-- docs/MIGRATIES_VOLGORDE.md was een handmatig bijgehouden lijst van "wat staat er nog open".
-- Zo'n lijst is per definitie een BEWERING over een database die niemand meer had bekeken, en hij
-- loopt achter zodra iemand een migratie draait zonder de markdown bij te werken — of zodra een
-- tweede tak er een migratie bij zet. Een lijst die het mis heeft over de veiligheid van je
-- boekhouding is erger dan geen lijst.
--
-- Dit bestand vraagt het gewoon aan de database. Draai het in de Supabase SQL-editor (het leest
-- alleen de catalogus, dus het werkt als service_role en verandert niets).
--
-- TOEGEPAST = het object dat de migratie aanmaakt, bestaat. Dat is geen bewijs dat de migratie
-- FOUTLOOS liep — daarvoor is het CONTROLE-blok onderaan het migratiebestand zelf — maar het is
-- wel het verschil tussen "ik denk het" en "ik zie het".
--
-- DE GRENS VAN DIT BESTAND, EERLIJK GEZEGD
-- Het ANTWOORD komt uit de database, maar de VRAAG staat hier met de hand in. Een migratie die
-- via een andere tak in main belandt, staat dus niet vanzelf in de lijst hieronder — en een
-- migratie die er niet in staat, kan dit bestand ook niet 'OPEN' noemen. Dat is precies wat er
-- met #23 gebeurde. Voeg daarom een regel toe zodra je een migratie schrijft waar code op leunt,
-- en zeker als die code fail-soft is: juist dán zwijgt de app als de tabel ontbreekt.
-- Tegen elkaar leggen: `ls supabase/migrations/` naast de lijst hieronder.
-- =====================================================================

with verwacht(nr, bestand, waarom, soort, object) as (values
  -- ── De grens tussen eigenaar en boekhouder ──────────────────────────────────────────────
  (11, 'accountant_write_holes.sql',
       'Twee schrijfgaten in de boekhoudersgrens + de vier ontbrekende invoices-indexen',
       'policy', 'acc_status_owner_write'),
  (12, 'invoice_lines_accountant_gate.sql',
       'De regelspolicy stond strenger dan de factuurkop: een verstuurde factuur toonde een lege regelset',
       'policy', 'invoice_lines_select_accountant'),

  -- ── Geld dat binnenkomt, en de bewaarplicht ─────────────────────────────────────────────
  (10, 'kluis_subscriptions.sql',
       'Vóór de eerste Bewaarkluis-betaling: anders neemt de webhook geld aan en legt de verplichting nergens vast',
       'table', 'kluis_subscriptions'),

  -- ── De inkoop-poorten ───────────────────────────────────────────────────────────────────
  (13, 'invoice_archive_reason.sql',
       'Het Genegeerd-tabblad kan de reden pas tonen als archive_reason bestaat (code valt nu terug op archiveren zonder notitie)',
       'column', 'invoices.archive_reason'),
  (14, 'email_sender_rules.sql',
       'De tabel voor "altijd negeren van deze afzender" — zonder deze migratie doet die knop niets',
       'table', 'email_sender_rules'),

  -- ── SnelStart: het slot vóór de onomkeerbare boeking ────────────────────────────────────
  (15, 'snelstart_claim_before_push.sql',
       'Het idempotentie-slot moest VÓÓR de POST kunnen sluiten; zonder dit kan een tweede tabblad dezelfde factuur dubbel boeken',
       'index', 'snelstart_exports_user_invoice_claim_uidx'),

  -- ── Uit andere takken bij gekomen ───────────────────────────────────────────────────────
  (16, 'cash_settlement_per_instalment.sql',
       'Kasboek-regels per termijn (cash_entries.settlement_id). Code probeert de kolom eerst en valt zonder terug op één regel per factuur',
       'column', 'cash_entries.settlement_id'),
  (17, 'invoice_schedules.sql',
       'Terugkerende facturen',
       'table', 'invoice_schedules'),
  (18, 'search_engine_clients_kvk_city.sql',
       'Zoeken op KVK-nummer en plaats van een klant',
       'index', 'clients_kvk_number_trgm'),

  -- ── De bestandsbeveiliging ──────────────────────────────────────────────────────────────
  -- Deze twee stonden er eerder NIET in, en dat was een gat in precies het verkeerde ding: de
  -- vraag "is de bescherming van mijn bestanden live?" kon dit bestand niet beantwoorden. De
  -- policy-tak hieronder keek namelijk hard naar schemaname='public', terwijl storage-policies
  -- in schemaname='storage' wonen — het gereedschap was blind voor de bucket, per constructie.
  (19, 'documents_shared_and_storage_policies.sql',
       'De policies op storage.objects — zonder deze kan iedere ingelogde gebruiker bij andermans bestanden',
       'storage_policy', 'documents_read'),
  (20, 'storage_bucket_hardening.sql',
       'Legt vast dat de documents-bucket privé is (stond alleen als vinkje in een dashboard)',
       'bucket_private', 'documents'),

  -- ── De ontdubbeling van documenten ──────────────────────────────────────────────────────
  -- LET OP bij deze: als hij "toegepast" is, kan dat de OUDE versie zijn geweest, met een te
  -- ruime DELETE. Zie het PRE-CHECK-blok in het migratiebestand zelf, en vooral de sluitende
  -- test op cash_entries die daar staat.
  (21, 'documents_content_hash_unique.sql',
       'Race-veilige ontdubbeling op bytehash — LEES het bestand voordat je hem (opnieuw) draait',
       'index', 'uq_documents_user_content_hash'),

  -- ── Zicht op de machine ─────────────────────────────────────────────────────────────────
  (22, 'cron_runs.sql',
       'Legt vast DAT een cron draaide. Zonder deze tabel is niet te zien of de zes crons leven — en /api/health kan het dan ook niet zeggen',
       'table', 'cron_runs'),

  -- ── Het ontbrekende bankafschrift ───────────────────────────────────────────────────────
  -- Deze stond hier NIET in, en dat was de blinde vlek waar dit bestand nu juist tegen moest
  -- beschermen: hij kwam via een andere tak (#201) mee in main nadat de lijst hierboven al was
  -- geschreven. Beide lezers (bank-ingest.ts en /api/readiness) zijn keurig fail-soft — bestaat
  -- de tabel niet, dan vervalt de controle ZONDER foutmelding. Precies daarom hoort hij hier:
  -- anders is "merkt de app dat er een maand bankgeschiedenis ontbreekt?" een vraag die niemand
  -- kan beantwoorden, ook niet door goed te kijken.
  (23, 'bank_statement_periods.sql',
       'Onthoudt welke PERIODE elk bankafschrift beslaat. Zonder deze tabel wordt een ontbrekende maand nooit opgemerkt: januari en maart kloppen allebei intern, en februari mist stil',
       'table', 'bank_statement_periods')
)
select
  nr                                                        as "#",
  bestand,
  case when aanwezig then '✅ toegepast' else '⏳ OPEN' end   as status,
  waarom
from (
  select
    v.nr, v.bestand, v.waarom,
    case v.soort
      when 'table'  then to_regclass('public.' || v.object) is not null
      when 'index'  then exists (
                          select 1 from pg_indexes
                           where schemaname = 'public' and indexname = v.object)
      when 'policy' then exists (
                          select 1 from pg_policies
                           where schemaname = 'public' and policyname = v.object)
      when 'column' then exists (
                          select 1 from information_schema.columns
                           where table_schema = 'public'
                             and table_name   = split_part(v.object, '.', 1)
                             and column_name  = split_part(v.object, '.', 2))
      -- Storage-policies leven in het schema 'storage', niet in 'public'. Zonder deze tak was
      -- dit bestand blind voor de enige bescherming die de bestanden zelf hebben.
      when 'storage_policy' then exists (
                          select 1 from pg_policies
                           where schemaname = 'storage' and policyname = v.object)
      -- En de bucket zelf: 'toegepast' betekent hier "hij staat op privé".
      when 'bucket_private' then exists (
                          select 1 from storage.buckets
                           where id = v.object and public = false)
    end as aanwezig
  from verwacht v
) t
order by aanwezig, nr;

-- =====================================================================
-- HOE JE DIT LEEST
--
-- De OPEN-regels staan bovenaan. Voor elke daarvan: open het bestand in
-- supabase/migrations/, draai het, en draai daarna het CONTROLE-blok onderaan datzelfde
-- bestand. Dat blok is het verschil tussen "toegepast" en "toegepast en gecontroleerd" —
-- en het heeft in deze codebase al twee echte fouten opgeleverd die op geen andere manier
-- zichtbaar waren (een 42P10 op een partiële index, en een functie die vijf kolommen noemde
-- die niet bestonden).
--
-- STAAT ER IETS OPEN DAT URGENT LIJKT? Bijna nooit. Elke migratie in deze lijst is zo
-- geschreven dat de code er ZONDER ook werkt: de negeer-knop archiveert dan zonder notitie,
-- het kasboek maakt één regel per factuur in plaats van per termijn, de SnelStart-push valt
-- terug op het oude pad (claim ná de POST). De eigenaar mist tot die tijd een label of een
-- verbetering — nooit een functie die stukgaat, en nooit stille schade.
--
-- Eén nuance bij 23: daar mist niet een label maar een CONTROLE. De boekhouding blijft kloppen
-- met wat erin zit, alleen merkt niemand dat er een maand bankafschrift ontbreekt. Geen schade,
-- wel een blinde vlek — en anders dan bij de rest zie je aan het scherm niet dát je hem hebt.
--
-- De enige twee met een échte scherpe kant zijn 11 en 15:
--   · 11 dicht een schrijfgat in de boekhoudersgrens (een gekoppelde boekhouder kon het IBAN
--     op een openstaande inkoopfactuur herschrijven);
--   · 15 dicht het gat waarin twee gelijktijdige verzoeken dezelfde factuur twee keer in het
--     wettelijke inkoopboek van de boekhouder kunnen zetten.
-- =====================================================================
