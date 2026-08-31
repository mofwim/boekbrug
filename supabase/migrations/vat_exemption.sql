-- =====================================================================
-- [VRIJGESTELD] BTW-vrijgestelde omzet (art. 11 Wet OB) + het pro-rata aftrekrecht.
-- BoekBrug · augustus 2026
-- =====================================================================
-- WAAROM
-- Dit product kende drie BTW-tarieven — {0, 9, 21} — en niets daarbuiten. Die verzameling
-- kan VRIJGESTELD niet uitdrukken, en dat is geen nuance maar het tegenovergestelde:
--
--   0% (nultarief)  je berekent geen BTW EN je houdt het volledige recht op aftrek;
--   vrijgesteld     je berekent geen BTW EN je verliest het recht op aftrek.
--
-- Een vrijgestelde ondernemer (tandarts, docent, verzekeringstussenpersoon, zorgverlener)
-- die zijn omzet als "0%" invoerde, kreeg daardoor TWEE foute getallen tegelijk, en geen van
-- beide was zichtbaar:
--
--   1. zijn vrijgestelde omzet belandde in aangifterubriek 1e ("belast met 0%") — een
--      positief bedrag in een vak waar het niet hoort (src/lib/aangifte.ts:96);
--   2. src/lib/financial-result.ts:330 trok de voorbelasting van ELKE inkoopfactuur voor
--      100% af, omdat niets in de app wist dat de omzet waar die kosten bij horen geen
--      aftrekrecht draagt.
--
-- (2) is de dure. Een praktijk met € 132.000 vrijgestelde zorgomzet naast € 12.396 belaste
-- omzet mag ruwweg een tiende van haar algemene voorbelasting aftrekken; de app rekende het
-- volle bedrag. Op één kwartaal gewone kosten is dat duizenden euro's die worden nageheven,
-- met rente.
--
-- Het begrip stond al in de commentaren — factuur-handoff.ts:158 ("een ontbrekend tarief dat
-- als 0% doorgaat leest als vrijgesteld"), closing-package.ts:700 en icp.ts:292 ("bij KOR of
-- vrijgestelde omzet vallen de twee niet tegen elkaar weg") — maar nergens in de DATA. Deze
-- migratie zet het daar neer.
--
-- WAT DIT WEL IS
-- Vier kolommen en één regel erbij in de boekhoudersgrens. Verder niets: geen bestaande
-- policy gewijzigd, geen bestaande kolom aangeraakt, geen rij herschreven.
--
-- SCHIPT DONKER. vat_exempt_activity staat op false voor iedereen. Op dat pad rekent de
-- engine byte-identiek aan gisteren: één emmer voorbelasting, voor 100% afgetrokken. Er
-- verschuift geen cent bij een bestaande gebruiker doordat deze migratie draait.
--
-- WAT DIT NADRUKKELIJK NIET IS
-- Geen fiscaal oordeel. De app bepaalt NIET welke omzet vrijgesteld is — dat is een juridische
-- weging van de activiteit, niet iets wat uit een tarief blijkt. De ondernemer verklaart het,
-- precies zoals bij de KOR (regime_kor.sql), en de aangifte-notities zeggen wat de boekhouder
-- nog moet doen: werkelijk-gebruik als alternatieve maatstaf, de herzieningstermijn op
-- investeringsgoederen, en een pre-pro-rata per sector blijven buiten dit product.
--
-- NIET GEDEKT IN DEZE RONDE, en dat staat ook in de notities die de ondernemer ziet:
-- dagomzet (daily_turnover) en contante verkopen (cash_entries) krijgen GEEN classificatie.
-- Een vrijgestelde ondernemer met kassaomzet wordt daarop expliciet gewezen in het concept,
-- in plaats van dat de app doet alsof die omzet meegewogen is. Een kolom toevoegen die niets
-- leest zou precies die valse volledigheid opleveren.
--
-- APPLY: draaien in de Supabase SQL editor. Verwijdert niets. Idempotent.
-- =====================================================================

BEGIN;

-- ── 1. De verklaring, op het profiel ─────────────────────────────────
-- Twee kolommen, samen: "ik heb vrijgestelde omzet" én "vanaf wanneer".
--
-- De datum is dragend, om exact dezelfde reden als vat_scheme_since (vat-scheme.ts): op een
-- waarheidslaag die bij ELKE LEZING herrekent, zou een kale globale boolean een AL INGEDIENDE
-- aangifte met terugwerkende kracht herschrijven op het moment dat de ondernemer hem aanzet.
-- Een tandarts die per 1 juli een belaste tandbleking begint, mag Q1 en Q2 — ingediend,
-- betaald, gesloten — niet herrekend zien onder een regime dat er toen niet was.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vat_exempt_activity boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vat_exempt_since date;

COMMENT ON COLUMN public.profiles.vat_exempt_activity IS
  '[VRIJGESTELD] De ondernemer verklaart (deels) vrijgestelde omzet te hebben (art. 11 Wet OB). Stuurt de rubriek-indeling van verkoopregels en het pro-rata aftrekrecht op inkoop. Default false — dan rekent de engine ongewijzigd.';

COMMENT ON COLUMN public.profiles.vat_exempt_since IS
  '[VRIJGESTELD] Eerste dag waarop de verklaring geldt. Kwartalen die eerder beginnen houden het oude regime, zodat een ingediende aangifte nooit met terugwerkende kracht wordt herrekend. NULL = geldt voor alle kwartalen.';

-- ── 2. Verkoop: is deze regel belast of vrijgesteld? ─────────────────
-- Op de REGEL, niet op de factuur: gemengde praktijken bestaan (een tandarts factureert
-- zorg naast een cosmetische behandeling), en invoice_lines is al de plek waar de
-- rubriek-splitsing per tarief vandaan komt (btw-rate-split.ts).
--
-- NULL = nooit geclassificeerd = belast. Dat is de veilige default: elke bestaande regel
-- blijft exact in de rubriek waar hij altijd stond.
ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS vat_treatment text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_vat_treatment_check'
  ) THEN
    ALTER TABLE public.invoice_lines
      ADD CONSTRAINT invoice_lines_vat_treatment_check
      CHECK (vat_treatment IS NULL OR vat_treatment IN ('taxed', 'exempt'));
  END IF;
END $$;

COMMENT ON COLUMN public.invoice_lines.vat_treatment IS
  '[VRIJGESTELD] ''exempt'' = vrijgestelde prestatie (art. 11): telt als omzet, draagt geen BTW en hoort in GEEN rubriek. ''taxed''/NULL = gewoon belast, inclusief een echt 0%-tarief (dat behoudt aftrekrecht).';

-- ── 3. Inkoop: waar dient deze kost voor? ────────────────────────────
-- Op de FACTUUR, niet op de regel: inkoopfacturen komen hier binnen via scan/e-mail en
-- hebben meestal helemaal geen regels — de kop draagt de bedragen.
--
-- NULL = 'mixed' = het pro-rata aandeel. Dat is bewust niet de gulste maar de juiste default:
-- de wettelijke hoofdregel voor algemene kosten IS de verhouding, en van de drie mogelijke
-- fouten kost pro-rata op een kost die eigenlijk direct_taxed was alleen te WEINIG aftrek
-- (zichtbaar, corrigeerbaar) — terwijl het gedrag dat we vervangen te VEEL aftrok op elke
-- vrijgestelde kost in het boek.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vat_deduction text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_vat_deduction_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_vat_deduction_check
      CHECK (vat_deduction IS NULL OR vat_deduction IN ('direct_taxed', 'direct_exempt', 'mixed'));
  END IF;
END $$;

COMMENT ON COLUMN public.invoices.vat_deduction IS
  '[VRIJGESTELD] Waar dient deze inkoop voor? direct_taxed = volledig aftrekbaar · direct_exempt = niet aftrekbaar · mixed/NULL = pro-rata aandeel. Alleen betekenisvol als profiles.vat_exempt_activity aan staat.';

-- Alleen gelezen voor een vrijgestelde eigenaar, en dan per kwartaal over zijn inkoop.
CREATE INDEX IF NOT EXISTS idx_invoices_vat_deduction
  ON public.invoices (receiver_id, vat_deduction)
  WHERE vat_deduction IS NOT NULL;

-- ── 4. vat_deduction hoort ACHTER de boekhoudersgrens ────────────────
-- prevent_accountant_amount_changes() is een ALLOWLIST-van-verboden: wat er niet in staat,
-- mag een boekhouder wél schrijven. Een nieuwe kolom is daar dus standaard ONBESCHERMD — en
-- deze kolom verzet rubriek 5b rechtstreeks. Zonder deze regel zou de belofte in de kop van
-- die functie ("elke financieel relevante kolom is hier op slot") vanaf vandaag onwaar zijn,
-- en zou een boekhouder de teruggaaf van zijn klant kunnen verschuiven zonder spoor.
--
-- De functie wordt in haar GEHEEL herschreven omdat CREATE OR REPLACE geen gedeeltelijke
-- wijziging kent. Alles behalve de laatste regel is letterlijk overgenomen uit
-- accountant_write_holes.sql (migratie 11) — inclusief de commentaren die uitleggen waarom
-- elke kolom er staat, zodat de volgende lezer niet twee bestanden hoeft te vergelijken.
CREATE OR REPLACE FUNCTION public.prevent_accountant_amount_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- service_role / pipeline (auth.uid() IS NULL) gaat er rechtstreeks doorheen.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- De eigenaar mag zijn eigen factuur volledig wijzigen.
  IF auth.uid() = OLD.sender_id OR auth.uid() = OLD.receiver_id THEN
    RETURN NEW;
  END IF;

  -- Alles hieronder is een NIET-eigenaar met leesrecht: de gekoppelde boekhouder.
  -- Hij mag uitsluitend accountant_status en accountant_note verzetten.
  IF (NEW.total_ex_btw         IS DISTINCT FROM OLD.total_ex_btw)         OR
     (NEW.btw_amount           IS DISTINCT FROM OLD.btw_amount)           OR
     (NEW.total_inc_btw        IS DISTINCT FROM OLD.total_inc_btw)        OR
     (NEW.invoice_number       IS DISTINCT FROM OLD.invoice_number)       OR
     (NEW.invoice_date         IS DISTINCT FROM OLD.invoice_date)         OR
     (NEW.due_date             IS DISTINCT FROM OLD.due_date)             OR
     (NEW.status               IS DISTINCT FROM OLD.status)               OR
     (NEW.invoice_type         IS DISTINCT FROM OLD.invoice_type)         OR
     (NEW.sender_id            IS DISTINCT FROM OLD.sender_id)            OR
     (NEW.receiver_id          IS DISTINCT FROM OLD.receiver_id)          OR
     (NEW.direction            IS DISTINCT FROM OLD.direction)            OR
     (NEW.amount_paid          IS DISTINCT FROM OLD.amount_paid)          OR
     (NEW.payment_method       IS DISTINCT FROM OLD.payment_method)       OR
     (NEW.payment_date         IS DISTINCT FROM OLD.payment_date)         OR
     (NEW.marked_paid_at       IS DISTINCT FROM OLD.marked_paid_at)       OR
     (NEW.payment_prepared_at  IS DISTINCT FROM OLD.payment_prepared_at)  OR
     (NEW.pay_token            IS DISTINCT FROM OLD.pay_token)            OR
     -- [SEC-GUARD-FIX] document_id hoort er ook bij: het is de KOPPELING naar het bewijs.
     -- Een boekhouder die hem verzet, verwisselt het document onder een geboekte factuur.
     (NEW.document_id          IS DISTINCT FROM OLD.document_id)          OR
     -- [SEC] vendor_iban is het nummer dat de klant overtikt in zijn bank;
     -- payment_reference is het kenmerk dat bij die overboeking hoort. Een boekhouder
     -- die deze twee kan verzetten, kan geld omleiden.
     (NEW.vendor_iban          IS DISTINCT FROM OLD.vendor_iban)          OR
     (NEW.payment_reference    IS DISTINCT FROM OLD.payment_reference)    OR
     -- [VRIJGESTELD] Nieuw. Deze kolom bepaalt of de voorbelasting van deze inkoop voor
     -- 100%, 0% of het pro-rata aandeel meetelt — hij verzet rubriek 5b dus rechtstreeks,
     -- en hoort daarmee in dezelfde categorie als de bedragen erboven.
     (NEW.vat_deduction        IS DISTINCT FROM OLD.vat_deduction)       OR
     -- [KORTING-SLOT] Geen bedragen maar de INVOER waaruit bedragen worden herrekend:
     -- buildInvoiceUbl leidt PayableAmount en TaxAmount af uit parseDiscount(discount_type,
     -- discount_value), en PUT /api/invoice/[id] herberekent daaruit total_ex_btw, btw_amount en
     -- total_inc_btw. Een uitkomst beschermen en de invoer open laten is geen bescherming.
     (NEW.discount_type       IS DISTINCT FROM OLD.discount_type)       OR
     (NEW.discount_value      IS DISTINCT FROM OLD.discount_value)
  THEN
    RAISE EXCEPTION
      'Permission denied: een boekhouder mag alleen accountant_status en accountant_note wijzigen (invoice_id: %)',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Herbinden (no-op wanneer de trigger al onder deze naam bestaat, zoals op productie).
DROP TRIGGER IF EXISTS prevent_accountant_amount_changes ON public.invoices;
CREATE TRIGGER prevent_accountant_amount_changes
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_accountant_amount_changes();

COMMIT;

-- =====================================================================
-- CONTROLE — draai dit blok NA de migratie.
-- =====================================================================
-- 1) Staan alle vier de kolommen er? Eén query, want ze horen bij elkaar: mist er één, dan
--    werkt de helft van de keten en zwijgt de andere helft.
--
--    SELECT
--      count(*) FILTER (WHERE table_name='profiles'      AND column_name='vat_exempt_activity') AS decl_flag,
--      count(*) FILTER (WHERE table_name='profiles'      AND column_name='vat_exempt_since')    AS decl_since,
--      count(*) FILTER (WHERE table_name='invoice_lines' AND column_name='vat_treatment')       AS regel,
--      count(*) FILTER (WHERE table_name='invoices'      AND column_name='vat_deduction')       AS inkoop
--    FROM information_schema.columns WHERE table_schema='public';
--    Verwacht: 1, 1, 1, 1.
--
-- 2) Is er NIETS veranderd aan wat er al stond? Dit is de belangrijkste regel van dit blok.
--    Elke bestaande factuurregel en elke bestaande inkoopfactuur hoort ongeclassificeerd te
--    zijn, en elk profiel niet-vrijgesteld — anders verschuift er een aangifte van iemand die
--    hier nooit om heeft gevraagd.
--
--    SELECT
--      (SELECT count(*) FROM public.invoice_lines WHERE vat_treatment IS NOT NULL)       AS geclassificeerde_regels,
--      (SELECT count(*) FROM public.invoices      WHERE vat_deduction  IS NOT NULL)      AS toegewezen_inkopen,
--      (SELECT count(*) FROM public.profiles      WHERE vat_exempt_activity IS DISTINCT FROM false) AS vrijgestelde_profielen;
--    Verwacht: 0, 0, 0 direct na de migratie. Daarna groeien ze alleen doordat een ondernemer
--    het zelf aanzet.
--
-- 3) Doet de CHECK zijn werk? Een waarde buiten de gesloten lijst hoort te WEIGEREN — de
--    engine leest 'exempt' letterlijk, dus een typefout mag geen omzet uit de aangifte halen.
--
--    -- Hoort te falen met 23514 (check constraint):
--    -- UPDATE public.invoice_lines SET vat_treatment = 'vrijgesteld' WHERE id = <een id>;
--    -- Hoort te falen met 23514:
--    -- UPDATE public.invoices SET vat_deduction = 'gemengd' WHERE id = <een id>;
--
-- 4) Is de boekhoudersgrens ECHT herbouwd, en beschermt hij de nieuwe kolom? Zonder deze
--    stap is vat_deduction voor een boekhouder vrij beschrijfbaar en is de belofte in de kop
--    van die functie onwaar geworden.
--
--    SELECT pg_get_functiondef(p.oid) LIKE '%vat_deduction%' AS grens_dekt_vat_deduction
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname = 'prevent_accountant_amount_changes';
--    Verwacht: true.
--
--    En dat de trigger nog hangt (de migratie doet DROP + CREATE):
--    SELECT count(*) FROM pg_trigger
--     WHERE tgname = 'prevent_accountant_amount_changes' AND NOT tgisinternal;
--    Verwacht: 1. Staat hier 0, dan is de grens ER NIET MEER — dat is ernstiger dan de
--    migratie niet gedraaid hebben. Draai dit bestand dan opnieuw.
