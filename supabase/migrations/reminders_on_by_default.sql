-- supabase/migrations/reminders_on_by_default.sql
-- [HERINNER-AAN] Herinneringen staan voortaan AAN voor een nieuw account — met een rem erop.
--
-- ── WAAROM DIT VERANDERT ──
-- invoice_reminders.sql zette DEFAULT false neer met de woorden "DEFAULT false is the whole trust
-- ...". Dat was juist zolang niemand het aanzette: de hele machinerie stond gebouwd en uit, en in
-- productie had 1 van de 9 eigenaren hem ooit gevonden. Een functie die niemand aanzet is geen
-- functie. De eigenaar heeft besloten hem standaard aan te zetten.
--
-- ── WAAROM DAT NIET GENOEG IS, EN WAT ER DUS BIJ MOET ──
-- reminderTierDue() geeft de HOOGST bereikte trap terug en kijkt niet hoe lang de vervaldatum al
-- verstreken is. Voor een bestaand account dat de schakelaar zelf omzet is dat prima: hij kent zijn
-- eigen openstaande posten. Voor een NIEUW account is het dat niet. Wie zijn administratie
-- meeneemt uit een ander pakket importeert facturen van maanden geleden, en die staan allemaal
-- voorbij de laatste trap. De eerste cron-ronde na registratie zou dan de ZWAARSTE brief — de
-- ingebrekestelling, met incassokosten — sturen naar elke klant in die stapel. Naar mensen die
-- misschien allang betaald hebben buiten dit pakket om.
--
-- Dat is precies het risico waar DEFAULT false voor betaalde, en het verdwijnt niet doordat de
-- schakelaar omgaat. Dus komt er een tweede feit bij: WANNEER gingen de herinneringen aan. Er
-- wordt alleen gejaagd op een factuur die verviel NÁ dat moment. De stapel van vroeger blijft van
-- de ondernemer; die kent hij, en die stuurt hij desgewenst met de hand.
--
-- ── WAT ER VOOR BESTAANDE ACCOUNTS VERANDERT: NIETS ──
-- reminders_enabled_at wordt voor bestaande rijen op created_at gezet, niet op nu. Wie hem aan
-- heeft staan blijft dus precies dezelfde facturen chasen als gisteren. Een migratie die stilletjes
-- lopende herinneringen stopzet is net zo fout als een die er nieuwe start.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reminders_enabled_at timestamptz;

-- Bestaande rijen: het gedrag van vandaag bevriezen (alles vanaf accountaanmaak blijft in beeld).
UPDATE public.profiles
   SET reminders_enabled_at = COALESCE(created_at, now())
 WHERE reminders_enabled_at IS NULL;

-- Nieuwe rijen: aan, en de klok begint bij registratie.
ALTER TABLE public.profiles
  ALTER COLUMN reminders_enabled SET DEFAULT true;
ALTER TABLE public.profiles
  ALTER COLUMN reminders_enabled_at SET DEFAULT now();

COMMENT ON COLUMN public.profiles.reminders_enabled IS
  '[HERINNER-AAN] Mag de app openstaande verkoopfacturen namens deze eigenaar aanmanen? Sinds 3 september 2026 DEFAULT true; de schakelaar staat op /dashboard/settings.';
COMMENT ON COLUMN public.profiles.reminders_enabled_at IS
  '[HERINNER-AAN] Sinds wanneer herinneringen aanstaan. Een factuur die VOOR dit moment verviel wordt nooit aangemaand: anders stuurt de eerste cron-ronde van een nieuw account de zwaarste trap naar de hele geïmporteerde stapel. Wordt op now() gezet zodra een eigenaar de schakelaar aanzet.';
