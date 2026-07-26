-- =====================================================================
-- [KLUIS] Wie er een Bewaarkluis heeft gekocht, en tot wanneer.
-- BoekBrug · juli 2026
-- =====================================================================
-- WAAROM DIT ER MOET ZIJN VOORDAT ER ÉÉN EURO BINNENKOMT:
--
-- De Bewaarkluis rekent af met `mode: "payment"` — een eenmalige betaling, geen abonnement.
-- De Stripe-webhook zocht bij elk event een subscription id en logde "carried no
-- subscription id — ignored" als die er niet was. Voor een Bewaarkluis-betaling betekende
-- dat letterlijk: **geld aangenomen, verplichting nergens vastgelegd**. Dat is erger dan het
-- product niet hebben, want de klant heeft betaald voor zeven jaar bewaring en wij zouden
-- niet eens weten dat hij bestaat.
--
-- Deze tabel is dus geen administratie achteraf maar het bewijsstuk zelf.
--
-- ── EN HET IS DE SLEUTEL VOOR DE PURGE ──
-- /api/cron/retention-purge wist bestanden van accounts waarvan de bewaarplicht is
-- verlopen. Zolang deze tabel niet bestaat, kan die cron niet weten wie hij NIET mag
-- aanraken — en daarom moest RETENTION_PURGE_ENABLED tot nu toe uit blijven. Met deze
-- tabel is die koppeling er: een account met een lopende Bewaarkluis wordt overgeslagen,
-- met reden, ook als zijn eigen zeven jaar zouden zijn verstreken.
--
-- TOEPASSEN: draaien in de Supabase SQL-editor. Verwijdert niets. Idempotent.
-- =====================================================================

BEGIN;

-- ── 1. De tabel ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kluis_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Het jaar tot en met wanneer wij bewaren. Dit is het getal dat telt: de purge kijkt
  -- hiernaar, de klant ziet het op zijn scherm, en het is wat er is betaald.
  keep_through_year integer NOT NULL CHECK (keep_through_year BETWEEN 2000 AND 2200),

  -- Waar dat getal vandaan kwam, zodat een geschil naar te rekenen is.
  years_purchased integer NOT NULL CHECK (years_purchased BETWEEN 1 AND 10),
  last_fiscal_year integer CHECK (last_fiscal_year BETWEEN 1990 AND 2200),

  -- Wat er is betaald, in centen. Integer — geen float op geld.
  amount_cents integer NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),

  -- Stripe's eigen identificatie. UNIEK, en dat is de idempotentie: Stripe levert een
  -- webhook-event bij twijfel opnieuw af, en zonder deze index zou dezelfde betaling twee
  -- rijen opleveren.
  stripe_session_id text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Terugbetaald / geannuleerd. Nooit de rij verwijderen: een kluis die heeft bestaan hoort
  -- terug te vinden te zijn, ook nadat hij is beëindigd.
  cancelled_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS kluis_subscriptions_session_uidx
  ON public.kluis_subscriptions (stripe_session_id);

-- "Heeft deze gebruiker een lopende kluis?" is de vraag die de purge en het scherm stellen.
CREATE INDEX IF NOT EXISTS kluis_subscriptions_user_idx
  ON public.kluis_subscriptions (user_id) WHERE cancelled_at IS NULL;

COMMENT ON TABLE public.kluis_subscriptions IS
  '[KLUIS] Gekochte Bewaarkluizen. keep_through_year is het jaar t/m wanneer wij bewaren; de retentie-purge slaat een gebruiker met een lopende rij over. Uitsluitend geschreven door de Stripe-webhook.';

-- ── 2. RLS: lezen mag, schrijven niet ────────────────────────────────
-- De klant moet kunnen zien waar hij aan toe is. Schrijven gebeurt uitsluitend door de
-- webhook via service_role, dat RLS omzeilt — er is dus bewust geen INSERT/UPDATE-policy,
-- en zonder policy is dat onder RLS geweigerd. Zonder die scheiding kan iemand zichzelf
-- vanuit de browserconsole zeven jaar bewaring geven, of erger: de rij van de purge
-- weghalen.
ALTER TABLE public.kluis_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kluis_subscriptions_select_own ON public.kluis_subscriptions;
CREATE POLICY kluis_subscriptions_select_own ON public.kluis_subscriptions
  FOR SELECT USING (user_id = auth.uid());

COMMIT;

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen):
--
--   -- 1. De tabel en haar twee indexen bestaan.
--   select to_regclass('public.kluis_subscriptions') as tabel,
--          (select count(*) from pg_indexes
--            where indexname in ('kluis_subscriptions_session_uidx',
--                                'kluis_subscriptions_user_idx')) as indexen;
--   -- Verwacht: een naam en 2.
--
--   -- 2. Alleen een SELECT-policy — schrijven kan niemand behalve service_role.
--   select policyname, cmd from pg_policies
--    where schemaname='public' and tablename='kluis_subscriptions';
--   -- Verwacht: precies één rij, cmd = SELECT.
--
--   -- 3. Dezelfde Stripe-sessie kan geen twee kluizen opleveren.
--   insert into public.kluis_subscriptions
--     (user_id, keep_through_year, years_purchased, stripe_session_id)
--   values ((select id from public.profiles limit 1), 2033, 7, 'cs_test_dubbel');
--   insert into public.kluis_subscriptions
--     (user_id, keep_through_year, years_purchased, stripe_session_id)
--   values ((select id from public.profiles limit 1), 2033, 7, 'cs_test_dubbel');
--   -- De TWEEDE hoort te falen:
--   --   ERROR: duplicate key value violates unique constraint "kluis_subscriptions_session_uidx"
--
--   delete from public.kluis_subscriptions where stripe_session_id = 'cs_test_dubbel';
-- =====================================================================
