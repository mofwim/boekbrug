-- =====================================================================
-- [VAK-BRUG] The owner's trade, stored on the profile.
-- BoekBrug · August 2026
-- =====================================================================
-- WHY: vak-sjablonen.ts knows eleven trades and, per trade, the invoice lines and the BTW rate
-- that belongs to them. Its own header makes the argument: this is a CORRECTNESS feature dressed
-- as a speed feature, because a schilder on a thirty-year-old home may charge 9% and on new build
-- 21%, a taxi is 9% where a courier is 21%, a cleaner inside a home 9% and in an office 21%.
--
-- All of it lives in the PUBLIC funnel only — /factuur-maken, the /factuur-maken/[vak] landing
-- pages, the sitemap. Nothing behind the login reads it. So a barber arrives on
-- /factuur-maken/kapper from Google, tells us his trade, registers — and the app forgets. His
-- articles catalogue starts empty and the Kassa built for him opens on "je prijslijst is nog leeg".
-- The one fact he volunteered, at the only moment he volunteered it, was thrown away.
--
-- This column is where it lands.
--
-- ── WHAT IT IS NOT ──
-- Not a permission, not a plan, not a filter, and NOTHING reads it to decide what an owner may do.
-- It changes what the app offers to PREFILL and nothing else. A kapper who starts repairing bikes
-- types a new line; there is nothing to unlock and nothing to switch. Deliberately nullable: every
-- existing account has no trade, and "we do not know" is a perfectly workable state — it is the
-- state the whole app has been in until now.
--
-- No CHECK constraint on the value, on purpose, and this differs from account_purpose next door.
-- The valid set lives in vak-sjablonen.ts and grows when a trade is added there; a database
-- constraint would mean a migration per trade, and the failure it would prevent is harmless
-- (parseVak in vak-profile.ts turns anything unknown into null, so an unrecognised slug simply
-- means "trade unknown"). A constraint that must be migrated in step with a TypeScript array is a
-- constraint that will one day reject a trade the app already offers.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- =====================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vak text;

COMMENT ON COLUMN public.profiles.vak IS
  '[VAK-BRUG] The owner''s trade, as a slug from VAKKEN in src/lib/vak-sjablonen.ts (kapper, '
  'automonteur, schilder, …). NULL = unknown, which is a normal state. Drives what the app offers '
  'to prefill (the price list, the situational BTW warning) and NOTHING about permissions.';

-- ── The signup trigger, extended by one field ────────────────────────────────
-- Same function as account_purpose_archief.sql, with the trade read out of the metadata beside
-- the purpose. Rewritten whole rather than patched because CREATE OR REPLACE takes the entire
-- body: leaving out a field here would silently drop it from every future signup.
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
  v_vak text;
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

  -- [VAK-BRUG] Het vak reist mee uit /register?vak=. Hier ONGEVALIDEERD overgenomen — de
  -- geldige verzameling staat in vak-sjablonen.ts en parseVak() maakt van alles wat daar niet
  -- in staat gewoon null. Die controle in SQL herhalen zou betekenen dat de database en de code
  -- het over elkaar eens moeten blijven, en dat is precies het soort afspraak dat uit de pas
  -- gaat lopen zodra er een vak bij komt. Leeg → NULL, want "geen vak" is de normale toestand.
  v_vak := NULLIF(meta->>'vak', '');

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
    onboarding_step, onboarding_done, role, account_purpose, vak
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
    v_purpose,
    v_vak
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

COMMIT;

-- ── Controleren ──────────────────────────────────────────────────────────────
--   select vak, count(*) from public.profiles group by 1 order by 2 desc;
--
-- En dat de trigger het vak echt overneemt (op een testaccount):
--   select vak from public.profiles where id = '<nieuw account>';
