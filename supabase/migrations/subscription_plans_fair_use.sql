-- [FAIR-USE] Abonnementsvormen gelijktrekken met het gepubliceerde model — juli 2026
--
-- Het oude model in de database ('free' / 'pro' / 'boekhouder' / 'boekhouder_pro') kwam uit
-- een prijsplan dat nooit is geactiveerd en dat de Algemene Voorwaarden inmiddels niet meer
-- kennen. Dat is geen cosmetisch verschil: zolang een rij 'pro' kán zijn, kan code daar iets
-- op baseren en belooft de app iets wat het contract niet kent.
--
-- Het model dat nu geldt (zie /voorwaarden §5 en /eerlijk-gebruik):
--   'free'        — ondernemer, gratis binnen het eerlijk gebruik
--   'plus'        — ondernemer, € 12,99/maand bij structureel gebruik daarboven
--   'boekhouder'  — boekhouder/administratiekantoor, ALTIJD gratis, ongeacht klantaantal
--
-- Er is bewust GEEN betaald boekhoudersplan: 'boekhouder_pro' verdwijnt en mag niet
-- terugkeren zonder dat de voorwaarden meeveranderen.

BEGIN;

-- Bestaande rijen naar het nieuwe model tillen. 'pro' was in de praktijk niemand (betaalde
-- abonnementen zijn nooit live gegaan), maar we migreren defensief in plaats van te
-- veronderstellen dat de tabel leeg is.
UPDATE public.profiles SET subscription_plan = 'plus'       WHERE subscription_plan = 'pro';
UPDATE public.profiles SET subscription_plan = 'boekhouder' WHERE subscription_plan = 'boekhouder_pro';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_plan_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_subscription_plan_check
  CHECK (subscription_plan = ANY (ARRAY['free'::text, 'plus'::text, 'boekhouder'::text]));

COMMENT ON COLUMN public.profiles.subscription_plan IS
  'free = ondernemer binnen eerlijk gebruik; plus = ondernemer € 12,99/mnd; boekhouder = altijd gratis. Zie /eerlijk-gebruik.';

COMMIT;
