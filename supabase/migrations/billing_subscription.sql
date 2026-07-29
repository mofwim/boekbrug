-- =====================================================================
-- [BILLING] Abonnementstoestand op profiles + het slot tegen zelfbediening.
-- BoekBrug · juli 2026
-- =====================================================================
-- WAAROM: de app kan geen geld aannemen. `profiles` draagt al `subscription_plan`
-- (default 'free') en `subscription_stripe_id` uit het oorspronkelijke ontwerp, maar
-- niets schreef die ooit: er is geen Stripe-klantkoppeling en geen verlengdatum.
-- Deze migratie voegt de minimale toestand toe die een Stripe-abonnement nodig heeft,
-- en dicht het gat dat die toestand opent.
--
-- ── OVERGENOMEN UIT HET BILLING-EXPERIMENT, MAAR ZONDER DE PROEFKLOK ──
-- De oorspronkelijke versie van deze migratie voegde ook `trial_ends_at` toe, met
-- DEFAULT (now() + interval '14 days'), zodat bij ELKE bestaande én nieuwe rij stil een
-- proefperiode ging lopen. Die kolom staat hier bewust NIET in, en dat is geen detail:
--
--   • wij voeren geen proefperiode. De app is gratis voor de ondernemer en gratis voor
--     zijn boekhouder, binnen het eerlijk gebruik (/eerlijk-gebruik, voorwaarden §5);
--   • een klok die begint te lopen zonder dat iemand erom vroeg, en die later toegang
--     kan intrekken, is precies het gedrag waar dit product zich van onderscheidt;
--   • en een kolom die er niet is, kan later niet per ongeluk als betaalmuur gaan werken.
--
-- Komt er ooit toch een proefperiode, dan hoort dat een BEWUSTE migratie te zijn samen
-- met een herschreven §5 — niet een default die er al stond.
--
-- ── HET GAT DAT DIT DICHT ──
-- Policy `profiles_update_own` is
--   FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid())
-- ZONDER kolombeperking. RLS is het enige slot vóór de publieke anon-sleutel, dus zodra
-- er abonnementskolommen bestaan kan ELKE ingelogde gebruiker
--   update profiles set subscription_plan='plus', subscription_status='active'
-- rechtstreeks vanuit de browserconsole draaien en zichzelf een betaald plan geven.
-- De trigger onderaan maakt die kolommen alleen schrijfbaar voor de service-role webhook
-- — dezelfde vorm als de bestaande `prevent_accountant_amount_changes`.
--
-- TOEPASSEN: draaien in de Supabase SQL-editor. Verwijdert niets. Idempotent.
-- De app leest deze kolommen defensief: zolang zij niet bestaan geldt overal 'free',
-- wat voor bijna iedereen ook het juiste antwoord is. Laat toepassen breekt dus niets.
--
-- VOLGORDE: draai subscription_plans_fair_use.sql (free|plus|boekhouder) VÓÓR of NÁ deze
-- migratie, maar draai hem — de webhook schrijft de waarde 'plus', en zonder die
-- migratie weigert de oude CHECK die waarde.
-- =====================================================================

BEGIN;

-- ── 1. Kolommen ──────────────────────────────────────────────────────

-- Levensloopstatus. Genormaliseerd in src/lib/subscription.ts uit de ruwe Stripe-status.
-- Default 'none' = "heeft nooit een abonnement gehad", niet 'trialing': er is geen proef.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'none';

-- Stripe Customer id (cus_...). Eén klant per profiel — zie de unieke index.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- Einde van de periode waarvoor Stripe al heeft geïnd. Plus loopt tot dat moment door,
-- ook na een opzegging: die dagen zijn betaald, dus die dagen krijgt de klant.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

-- ── 2. Toegestane waarden ────────────────────────────────────────────
-- Idempotent: alleen toegevoegd wanneer afwezig.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_subscription_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_subscription_status_check
      CHECK (subscription_status = ANY (ARRAY[
        'none'::text,       -- nooit geabonneerd — de normale toestand
        'active'::text,     -- betaalt
        'past_due'::text,   -- incasso mislukt, Stripe probeert opnieuw (houdt Plus)
        'unpaid'::text,     -- pogingen uitgeput
        'paused'::text,     -- inning gepauzeerd
        'incomplete'::text, -- eerste betaling nooit voltooid
        'canceled'::text    -- gestopt (Plus kan nog doorlopen tot current_period_end)
      ]));
  END IF;
END $$;

-- ── 3. Opzoekindex ───────────────────────────────────────────────────
-- De webhook arriveert met alleen de Stripe-klant-id en moet daarmee het profiel vinden;
-- zonder index is elk event een volledige tabelscan. UNIQUE maakt bovendien op
-- databaseniveau onmogelijk dat twee profielen één Stripe-klant delen.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_customer_id_key
  ON public.profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ── 4. Documentatie ──────────────────────────────────────────────────
COMMENT ON COLUMN public.profiles.subscription_status IS
  '[BILLING] Genormaliseerde abonnementstoestand. UITSLUITEND geschreven door de Stripe-webhook via de service-role client (zie prevent_billing_self_grant). Er is geen proefperiode.';
COMMENT ON COLUMN public.profiles.stripe_customer_id IS
  '[BILLING] Stripe Customer id (cus_...). Uniek — één Stripe-klant per profiel.';
COMMENT ON COLUMN public.profiles.current_period_end IS
  '[BILLING] Einde van de al geinde periode. Plus loopt tot dit moment door, ook na opzegging.';

-- ── 5. Slot tegen zelfbediening ──────────────────────────────────────
-- Zelfde vorm als public.prevent_accountant_amount_changes: de service-role client (de
-- Stripe-webhook) draait met auth.uid() = NULL en gaat er rechtstreeks doorheen;
-- iedereen anders mag geen abonnementskolom verplaatsen.
--
-- Dit verstoort geen enkele bestaande schrijfactie. Elke profielupdate in de app
-- (onboarding-PATCH, instellingen opslaan, rolwissel bij uitnodiging, kas-beginsaldo,
-- register-upsert) raakt alleen niet-abonnementskolommen, dus alle IS DISTINCT
-- FROM-toetsen hieronder zijn onwaar en de rij gaat ongemoeid door.
CREATE OR REPLACE FUNCTION public.prevent_billing_self_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Uitzondering: service_role / pipeline (auth.uid() = NULL) — de Stripe-webhook.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.subscription_status    IS DISTINCT FROM OLD.subscription_status)    OR
     (NEW.subscription_plan      IS DISTINCT FROM OLD.subscription_plan)      OR
     (NEW.subscription_stripe_id IS DISTINCT FROM OLD.subscription_stripe_id) OR
     (NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id)     OR
     (NEW.current_period_end     IS DISTINCT FROM OLD.current_period_end)
  THEN
    RAISE EXCEPTION
      'Permission denied: subscription fields are set by the Stripe webhook only (profile_id: %)',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_billing_guard ON public.profiles;
CREATE TRIGGER profiles_billing_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_billing_self_grant();

COMMIT;

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen):
--
--   select subscription_status, subscription_plan,
--          stripe_customer_id, current_period_end
--     from public.profiles limit 5;
--
-- Verwacht: elke bestaande rij 'none' / 'free' / NULL / NULL. Niemand zit in een
-- proefperiode, want die bestaat niet.
--
-- Er mag GEEN kolom trial_ends_at zijn. Staat hij er wel, dan komt hij uit de oude
-- versie van deze migratie en hoort hij weg:
--
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='profiles'
--      and column_name='trial_ends_at';   -- verwacht: 0 rijen
--
-- Het slot hoort dit te WEIGEREN wanneer het als ingelogde gebruiker draait (niet in de
-- SQL-editor — die is service-role en hoort er juist door te mogen):
--
--   update public.profiles set subscription_plan = 'plus' where id = auth.uid();
--   -- ERROR: Permission denied: subscription fields are set by the Stripe webhook only
-- =====================================================================
