-- =====================================================================
-- [FAIR-USE] De tellers achter het beleid eerlijk gebruik.
-- BoekBrug · juli 2026
-- =====================================================================
-- WAAROM: /eerlijk-gebruik en de Algemene Voorwaarden §5 publiceren grenzen — 50 documenten
-- door de AI per maand, 100 verstuurde facturen — maar er werd niets geteld. Een
-- gepubliceerde grens die niet gemeten wordt is geen belofte, het is decor: de gebruiker
-- kan niet zien waar hij staat, en wij kunnen niet zien wat het ons kost.
--
-- ── ÉÉN ONTWERPBESLISSING DIE ALLES BEPAALT: DE PERIODE ZIT IN DE SLEUTEL ──
-- Er is GEEN cron die op de 1e van de maand tellers op nul zet. De periode ('2026-07') is
-- onderdeel van de primaire sleutel, dus een nieuwe maand is simpelweg een nieuwe rij die
-- op 0 begint. Dat is niet alleen minder werk:
--   • een gemiste of dubbel gedraaide cron kan nooit een teller kwijtraken of verdubbelen;
--   • de historie blijft staan, dus je kunt achteraf zien wat een maand werkelijk kostte;
--   • het antwoord is deterministisch — dezelfde gebruiker, dezelfde maand, dezelfde rij.
--
-- ── WAT HIER NIET IN STAAT, EN WAAROM NIET ──
-- Alleen de twee dingen die je moet TELLEN omdat ze gebeuren en weer voorbij zijn:
-- aiDocuments en invoicesSent. Opslag, mailboxen en administraties worden GEMETEN uit de
-- tabellen waar ze al in staan (sum(documents.file_size), count(email_connections)). Een
-- gemeten waarde kan niet uit de pas lopen met de werkelijkheid; een geteld getal wel.
-- Zie measureUsage() in src/lib/fair-use-usage.ts.
--
-- ── DE FAALRICHTING ──
-- fair_use_consume() is de enige plek die "nee" kan zeggen, en zegt dat alleen bij een
-- BEWEZEN overschrijding. Kan de functie niet draaien (migratie niet toegepast, database
-- even weg), dan faalt de aanroeper in de app OPEN — zie de vier onderhandelbare regels in
-- src/lib/fair-use.ts. Een maand te veel weggeven is minder erg dan iemand onterecht op
-- slot zetten.
--
-- TOEPASSEN: draaien in de Supabase SQL-editor. Verwijdert niets. Idempotent.
-- =====================================================================

BEGIN;

-- ── 1. De tabel ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.usage_counters (
  user_id    uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Kalendermaand in UTC, 'YYYY-MM'. UTC en niet lokale tijd, zodat de teller niet
  -- afhangt van waar de server toevallig staat en een maandgrens overal hetzelfde moment is.
  period     text    NOT NULL,
  -- 'aiDocuments' | 'invoicesSent' — de sleutels uit FAIR_USE_LIMITS met perMonth: true.
  metric     text    NOT NULL,
  count      integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period, metric)
);

COMMENT ON TABLE public.usage_counters IS
  '[FAIR-USE] Maandtellers voor het beleid eerlijk gebruik. Periode zit in de sleutel, dus een nieuwe maand begint vanzelf op 0 — er is geen reset-cron.';

-- ── 2. RLS: lezen mag, schrijven niet ────────────────────────────────
-- De gebruiker MOET zijn eigen stand kunnen zien (regel 4: waarschuwen vóórdat het gebeurt
-- kan alleen als hij kan meekijken). Schrijven gaat uitsluitend via de functie hieronder,
-- die SECURITY DEFINER is — er is dus geen INSERT/UPDATE/DELETE-policy, en zonder policy
-- is dat onder RLS geweigerd. Zonder die scheiding zou een gebruiker zijn eigen teller op
-- nul kunnen zetten vanuit de browserconsole.
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_counters_select_own ON public.usage_counters;
CREATE POLICY usage_counters_select_own ON public.usage_counters
  FOR SELECT USING (user_id = auth.uid());

-- ── 3. Verbruiken: atomair controleren én ophogen ────────────────────
--
-- In één statement, en dat is de kern. Zou de app eerst lezen en daarna ophogen, dan kan
-- een gebruiker die tien bonnen tegelijk uploadt tien keer "nog ruimte" te horen krijgen
-- voordat de eerste ophoging is geland. Precies bij de duurste handeling in de app is dat
-- geen theoretische race.
--
-- p_limit = 0 betekent: geen grens (Plus/boekhouder, of een metriek die wij nog niet
-- begrenzen). Dan wordt er wel geteld maar nooit geweigerd — dezelfde stand als
-- AI_DAILY_BUDGET_EUR=0 bij de kostenzekering, en om dezelfde reden: meten voordat je
-- begrenst.
CREATE OR REPLACE FUNCTION public.fair_use_consume(
  p_user_id uuid,
  p_period  text,
  p_metric  text,
  p_limit   integer,
  p_amount  integer DEFAULT 1
)
RETURNS TABLE (allowed boolean, used integer, remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current integer;
  v_new     integer;
BEGIN
  IF p_amount IS NULL OR p_amount < 1 THEN
    p_amount := 1;
  END IF;

  -- Vergrendel de rij (of maak hem) zodat gelijktijdige uploads elkaar niet inhalen.
  INSERT INTO public.usage_counters (user_id, period, metric, count)
  VALUES (p_user_id, p_period, p_metric, 0)
  ON CONFLICT (user_id, period, metric) DO NOTHING;

  SELECT c.count INTO v_current
    FROM public.usage_counters c
   WHERE c.user_id = p_user_id AND c.period = p_period AND c.metric = p_metric
     FOR UPDATE;

  v_new := v_current + p_amount;

  -- Boven de grens: NIET ophogen. De teller mag nooit hoger komen te staan dan wat er
  -- werkelijk is gedaan, want die stand wordt aan de gebruiker getoond.
  IF p_limit > 0 AND v_new > p_limit THEN
    RETURN QUERY SELECT false, v_current, GREATEST(0, p_limit - v_current);
    RETURN;
  END IF;

  UPDATE public.usage_counters c
     SET count = v_new, updated_at = now()
   WHERE c.user_id = p_user_id AND c.period = p_period AND c.metric = p_metric;

  RETURN QUERY SELECT true, v_new, CASE WHEN p_limit > 0 THEN GREATEST(0, p_limit - v_new) ELSE -1 END;
END;
$$;

COMMENT ON FUNCTION public.fair_use_consume IS
  '[FAIR-USE] Atomair controleren en ophogen. p_limit = 0 betekent tellen zonder begrenzen. Weigert alleen bij een bewezen overschrijding en hoogt dan niets op.';

-- ── 4. Teruggeven: een mislukte poging kost niets ────────────────────
--
-- /eerlijk-gebruik zegt letterlijk: "Een bestand dat wij niet konden lezen telt ook niet
-- mee — mislukte pogingen komen nooit op jouw rekening." Deze functie is hoe die zin waar
-- wordt gemaakt. De aanroeper reserveert vóór de AI-call en geeft terug als die faalt.
--
-- Nooit onder nul (de CHECK zou dat ook weigeren): een dubbele teruggave door een retry
-- mag geen gratis tegoed opleveren.
CREATE OR REPLACE FUNCTION public.fair_use_release(
  p_user_id uuid,
  p_period  text,
  p_metric  text,
  p_amount  integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new integer;
BEGIN
  UPDATE public.usage_counters c
     SET count = GREATEST(0, c.count - GREATEST(1, COALESCE(p_amount, 1))), updated_at = now()
   WHERE c.user_id = p_user_id AND c.period = p_period AND c.metric = p_metric
  RETURNING c.count INTO v_new;

  RETURN COALESCE(v_new, 0);
END;
$$;

COMMENT ON FUNCTION public.fair_use_release IS
  '[FAIR-USE] Reservering terugdraaien wanneer de betaalde handeling mislukte. Nooit onder nul.';

-- ── 5. Rechten ───────────────────────────────────────────────────────
-- Beide functies zijn SECURITY DEFINER en worden aangeroepen door de server (pipeline /
-- service_role). `authenticated` krijgt geen EXECUTE: een gebruiker mag zijn eigen teller
-- niet kunnen ophogen of terugdraaien.
REVOKE ALL ON FUNCTION public.fair_use_consume(uuid, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fair_use_release(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fair_use_consume(uuid, text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fair_use_release(uuid, text, text, integer) TO service_role;

-- ── 6. Index voor het opruimen ───────────────────────────────────────
-- Oude periodes hebben geen functie meer zodra het jaar voorbij is; deze index maakt het
-- goedkoop om ze ooit op te ruimen zonder de hele tabel te scannen.
CREATE INDEX IF NOT EXISTS usage_counters_period_idx ON public.usage_counters (period);

COMMIT;

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen):
--
--   -- 1. Verbruiken binnen de grens: allowed = true, used loopt op.
--   select * from public.fair_use_consume(
--     (select id from public.profiles limit 1), '2026-07', 'aiDocuments', 50, 1);
--
--   -- 2. De stand.
--   select * from public.usage_counters order by updated_at desc limit 5;
--
--   -- 3. Boven de grens: allowed = false, en `used` is NIET opgehoogd.
--   select * from public.fair_use_consume(
--     (select id from public.profiles limit 1), '2026-07', 'aiDocuments', 1, 1);
--
--   -- 4. Teruggeven werkt en gaat nooit onder nul.
--   select public.fair_use_release(
--     (select id from public.profiles limit 1), '2026-07', 'aiDocuments', 99);
--
-- Ruim daarna op wat de controle heeft aangemaakt:
--   delete from public.usage_counters where period = '2026-07';
-- =====================================================================
