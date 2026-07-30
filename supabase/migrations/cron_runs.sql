-- =====================================================================
-- [CRON-HARTSLAG] Vastleggen DAT een cron heeft gedraaid, en wat hij deed.
-- BoekBrug · juli 2026
-- =====================================================================
-- HET GAT
--
-- Er draaien zes crons, en nergens staat dat er één van heeft gedraaid:
--
--     email-sync        elke 2 uur    haalt facturen uit de mailbox
--     reconcile         elk uur       houdt de financiële cirkel kloppend
--     reminders         dagelijks     maant klanten aan die niet betalen
--     recurring         dagelijks     maakt terugkerende facturen als concept
--     retention-purge   wekelijks     de enige die data vernietigt
--     quarter-close     4x per jaar   "het kwartaal staat klaar voor je boekhouder"
--
-- Valt er één stil — een ontbrekende CRON_SECRET, een deploy die vercel.json niet meenam, een
-- 500 die blijft terugkomen, een plan-limiet — dan merkt niemand het. Er is geen scherm dat het
-- toont, geen mail die uitblijft die iemand mist, geen getal dat verandert.
--
-- Bij quarter-close is dat rampzalig én traag zichtbaar: die draait VIER KEER PER JAAR. Een stil
-- kapotte quarter-close ontdek je een jaar later, bij de vraag "waarom heeft mijn boekhouder
-- nooit iets ontvangen?". En dat is nu net de belofte van dit product.
--
-- Vercel's eigen cron-log toont of het EINDPUNT is aangeroepen en met welke statuscode. Dat is
-- iets, maar niet genoeg: een cron kan 200 teruggeven en toch niets gedaan hebben (nul eigenaren
-- verwerkt omdat een query faalde). Deze tabel legt de UITKOMST vast, niet de aanroep.
--
-- Bewust géén scherm ervoor. Dit is bedrijfsvoering, geen eigenaarsfunctie — de ondernemer is
-- geen systeembeheerder. Eén query onderaan dit bestand is het hele gereedschap.
--
-- TOEPASSEN: Supabase SQL-editor. Verwijdert niets. Idempotent.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- De naam zoals in vercel.json, zonder pad: 'email-sync', 'quarter-close', …
  job text NOT NULL,

  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,

  -- true = de run kwam tot het einde. false = hij brak af. NULL = hij is nog bezig, of het
  -- proces is halverwege gestorven — en juist die derde toestand wil je kunnen zien.
  ok boolean,

  -- Wat de run heeft gedáán. Vrij vormgegeven per cron ({"owners":12,"sent":3}), want het gaat
  -- om één vraag: heeft hij iets uitgericht, of draaide hij leeg?
  result jsonb,

  -- De foutmelding bij een afgebroken run, afgekapt.
  error text
);

-- "Wanneer draaide deze cron voor het laatst goed?" is de enige vraag die deze tabel krijgt.
CREATE INDEX IF NOT EXISTS cron_runs_job_started_idx
  ON public.cron_runs (job, started_at DESC);

COMMENT ON TABLE public.cron_runs IS
  '[CRON-HARTSLAG] Eén rij per cron-run. ok=null betekent begonnen maar nooit afgerond (proces gestorven) — dat is een andere storing dan ok=false en moet zichtbaar blijven. Uitsluitend geschreven via service_role.';

-- ── RLS: niemand leest dit via de app ────────────────────────────────
-- Hier staan geen gebruikersgegevens in, maar ook geen enkele reden om het aan een sessie te
-- tonen. RLS aan zonder policies = dicht voor iedereen behalve service_role. Dat is precies goed:
-- de crons schrijven via service_role, en de beheerder leest mee in de SQL-editor.
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

COMMIT;

-- =====================================================================
-- HET GEREEDSCHAP — draai dit wanneer je wilt weten of de machine leeft.
--
--   with verwacht(job, elke_uur) as (values
--     ('email-sync',       2),
--     ('reconcile',        1),
--     ('reminders',       24),
--     ('recurring',       24),
--     ('retention-purge', 168),
--     ('quarter-close',  2184)          -- ~3 maanden; deze hoort meestal "te laat" te lijken
--   )
--   select v.job,
--          l.started_at                                        as laatste_run,
--          l.ok,
--          l.result,
--          round(extract(epoch from (now() - l.started_at))/3600)::int as uur_geleden,
--          case
--            when l.started_at is null                       then '❌ NOOIT GEDRAAID'
--            when l.ok is null                               then '⚠️ afgebroken halverwege'
--            when l.ok = false                               then '❌ laatste run faalde'
--            when now() - l.started_at > (v.elke_uur * 2 || ' hours')::interval
--                                                            then '⚠️ te lang stil'
--            else '✅'
--          end as oordeel
--     from verwacht v
--     left join lateral (
--       select started_at, ok, result from public.cron_runs
--        where job = v.job order by started_at desc limit 1
--     ) l on true
--    order by oordeel, v.job;
--
-- '❌ NOOIT GEDRAAID' op email-sync of reconcile betekent bijna altijd één van deze twee:
--   · CRON_SECRET staat niet in de omgeving (elke cron antwoordt dan 401 en doet niets), of
--   · je draait op Vercel Hobby, waar een cron vaker dan 1x per dag de DEPLOY laat falen —
--     zie docs/LIVE_GAAN.md.
--
-- CONTROLE (na het toepassen):
--   select to_regclass('public.cron_runs') as tabel,
--          (select count(*) from pg_indexes
--            where schemaname='public' and indexname='cron_runs_job_started_idx') as index_er,
--          (select relrowsecurity from pg_class where oid='public.cron_runs'::regclass) as rls;
--   -- Verwacht: een naam, 1, true.
-- =====================================================================
