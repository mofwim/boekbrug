-- =====================================================================
-- [KLUIS] Waarvoor een account is aangemaakt: boekhouden of archiveren.
-- BoekBrug · juli 2026
-- =====================================================================
-- WAAROM: /bewaarplicht haalt mensen binnen die geen boekhoudprogramma zoeken — een
-- gestopte zaak, een opgeheven boekhoudpakket, een erfgenaam. Die knop stuurde naar
-- /register?doel=archief, maar die parameter deed niets: de bezoeker liep alsnog de
-- onboarding in over facturen versturen, bedrijfsgegevens en het koppelen van zijn Gmail.
-- Precies de wrijving waar hij voor wegliep. Deze kolom is wat dat verschil onthoudt.
--
-- ── WAT DIT NADRUKKELIJK NIET IS ──
-- Geen plan, geen abonnement, geen beperking. Een archiefaccount kan alles wat elk ander
-- account kan; er hangt geen enkele policy aan deze kolom en die mag er ook nooit aan gaan
-- hangen. Het hele idee achter de bewaarplicht-als-voordeur is dat de rest van de app al
-- klaarstaat voor als iemand hem nodig heeft — een archiefaccount dat dingen NIET mag zou
-- dat idee kapotmaken.
--
-- Om dezelfde reden is dit géén nieuwe waarde in `role`. Rollen bepalen wie wat van wie mag
-- zien (het boekhoudersportaal, de koppeling ondernemer↔boekhouder, de RLS die daarop
-- rust). Een archiefaccount is gewoon een 'zzper' — dezelfde ondernemer met dezelfde
-- stukken, alleen op een ander moment in zijn leven.
--
-- TOEPASSEN: draaien in de Supabase SQL-editor. Verwijdert niets. Idempotent.
-- Wordt de migratie niet toegepast, dan blijft alles werken: de app leest deze kolom
-- defensief en valt terug op 'boekhouden' — het volledige pad met de volledige onboarding.
-- =====================================================================

BEGIN;

-- ── 1. De kolom ──────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_purpose text NOT NULL DEFAULT 'boekhouden';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_account_purpose_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_account_purpose_check
      CHECK (account_purpose = ANY (ARRAY['boekhouden'::text, 'archief'::text]));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.account_purpose IS
  '[KLUIS] Waarvoor het account is aangemaakt. Bepaalt de begroeting en de eerste pagina, NOOIT de rechten: er hangt geen policy aan deze kolom en die mag er niet aan gaan hangen.';

-- ── 2. De trigger leest het doel mee ─────────────────────────────────
--
-- Twee dingen veranderen ten opzichte van register_profile_from_metadata.sql:
--
--   a. account_purpose komt uit de signUp-metadata, met dezelfde faalrichting als in
--      src/lib/account-purpose.ts: alles wat niet exact 'archief' is wordt 'boekhouden'.
--      Dat is de veilige kant — een verkeerd gelezen waarde levert hooguit een wizard te
--      veel op, terwijl andersom iemand een onboarding zou overslaan die hij nodig had.
--
--   b. voor een archiefaccount wordt onboarding_done meteen TRUE. Dat is geen truc om de
--      wizard te omzeilen maar de eerlijke uitkomst: die wizard vraagt om bedrijfsgegevens,
--      een mailboxkoppeling en een eerste factuur, en iemand die zijn gestopte zaak komt
--      archiveren heeft geen van drieën. De middleware stuurt hem dan ook niet meer naar
--      /onboarding, en hij landt rechtstreeks in zijn kluis.
--
-- De rest van de functie is ongewijzigd; zij wordt hier in haar geheel herschreven omdat
-- CREATE OR REPLACE geen gedeeltelijke wijziging kent.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  meta jsonb := COALESCE(new.raw_user_meta_data, '{}'::jsonb);
  v_role text;
  v_step int;
  v_purpose text;
  v_done boolean;
BEGIN
  -- Rol: alleen de twee bekende waarden; al het andere (of afwezig) → 'zzper'.
  v_role := CASE
    WHEN meta->>'role' IN ('zzper', 'accountant') THEN meta->>'role'
    ELSE 'zzper'
  END;

  -- [KLUIS] Doel: alleen exact 'archief' kiest het archiefpad.
  v_purpose := CASE
    WHEN meta->>'account_purpose' = 'archief' THEN 'archief'
    ELSE 'boekhouden'
  END;

  -- Onboarding-stap: register slaat de welkom/rol/bedrijf-schermen over (stuurt 4).
  -- Afwezig/ongeldig → 1 (volledige wizard).
  BEGIN
    v_step := COALESCE(NULLIF(meta->>'onboarding_step', ''), '1')::int;
  EXCEPTION WHEN others THEN
    v_step := 1;
  END;
  IF v_step IS NULL OR v_step < 1 THEN
    v_step := 1;
  END IF;

  -- [KLUIS] Een archiefaccount heeft geen wizard te doorlopen.
  v_done := (v_purpose = 'archief');

  INSERT INTO public.profiles (
    id, email, full_name,
    company_name, kvk_number, btw_number,
    onboarding_step, onboarding_done, role, account_purpose
  ) VALUES (
    new.id,
    new.email,
    NULLIF(meta->>'full_name', ''),
    NULLIF(meta->>'company_name', ''),
    NULLIF(meta->>'kvk_number', ''),
    NULLIF(meta->>'btw_number', ''),
    v_step,
    v_done,
    v_role,
    v_purpose
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

COMMIT;

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen):
--
--   -- 1. De kolom bestaat en iedereen die er al was staat op 'boekhouden'.
--   select account_purpose, count(*) from public.profiles group by 1;
--
--   -- 2. De CHECK weigert onzin.
--   update public.profiles set account_purpose = 'iets' where id = (select id from public.profiles limit 1);
--   -- ERROR: new row violates check constraint "profiles_account_purpose_check"
--
--   -- 3. Na een registratie via /register?doel=archief hoort de nieuwe rij
--   --    account_purpose = 'archief' EN onboarding_done = true te hebben:
--   select account_purpose, onboarding_done, role, onboarding_step
--     from public.profiles order by created_at desc limit 1;
--   -- Verwacht: archief / true / zzper
-- =====================================================================
