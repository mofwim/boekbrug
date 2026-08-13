-- supabase/migrations/creditnota_partial.sql
-- [DEEL-CREDIT] Meer dan één creditnota per factuur — met een plafond dat harder is dan de index
-- die hij vervangt.
--
-- ── WAT ER WEGGAAT, EN WAAROM DAT NIET GRATIS IS ──
--
-- invoices_one_creditnota_per_original stond er om een echte reden: de route deed SELECT-dan-
-- INSERT ("bestaat er al een creditnota?"), en twee snelle kliks kwamen allebei door die SELECT.
-- Het resultaat waren twee geldige creditnota's op één factuur — de btw en de omzet twee keer
-- gecorrigeerd, met twee nummers uit de doorlopende reeks om het te doen.
--
-- Die index kan niet blijven zodra crediteren in delen mag. Maar hem weghalen zonder vervanging
-- zet precies die race weer open, en dan is de schade groter dan hiervoor: niet twee documenten
-- die elkaar dubbelen, maar een onbeperkt aantal.
--
-- ── WAT ERVOOR IN DE PLAATS KOMT ──
--
-- Het echte verbod is nooit "één document" geweest, dat was een benadering. Het verbod is:
--
--     de som van de creditnota's op een factuur mag die factuur nooit overschrijden.
--
-- Daar overheen gaan betekent meer teruggeven dan er ooit in rekening is gebracht: de btw op het
-- meerdere wordt teruggevraagd zonder ooit te zijn afgedragen, en de klant houdt een tegoed dat
-- nergens vandaan komt. Beide documenten zien er los van elkaar volstrekt normaal uit, dus er is
-- geen scherm waarop dit opvalt.
--
-- De trigger hieronder vergrendelt de ORIGINELE factuurrij (SELECT ... FOR UPDATE) voordat hij
-- telt. Dat is het hele punt: twee gelijktijdige verzoeken op dezelfde factuur gaan achter elkaar
-- staan in plaats van allebei een verouderd totaal te lezen. Dezelfde bescherming als de unieke
-- index gaf, maar tegen de regel die er werkelijk toe doet.
--
-- ── MARGE ──
-- Een halve cent, dezelfde marge die de rest van de app hanteert voor "dit bedrag is afgedaan".
-- Hij is er zodat afrondingsruis een laatste, kloppende creditnota niet tegenhoudt — niet zodat
-- er een cent meer terug kan dan er is gefactureerd.
--
-- Idempotent. Draait veilig meerdere keren.

-- ── 1. De index die "precies één" afdwong ──
DROP INDEX IF EXISTS invoices_one_creditnota_per_original;

-- ── 2. Het plafond ──
CREATE OR REPLACE FUNCTION public.assert_credit_within_original()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  origineel_totaal numeric;
  al_gecrediteerd numeric;
  dit_bedrag numeric;
BEGIN
  -- Alleen creditnota's die aan een factuur hangen. Al het andere gaat ongemoeid door, zodat deze
  -- trigger geen enkele gewone factuur raakt.
  IF NEW.invoice_type IS DISTINCT FROM 'creditnota' OR NEW.original_invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- FOR UPDATE: hier worden gelijktijdige creditnota's op dezelfde factuur geserialiseerd. Zonder
  -- deze vergrendeling lezen twee transacties allebei het oude totaal en passen ze allebei — de
  -- race die de verwijderde unieke index dichthield.
  SELECT abs(coalesce(total_inc_btw, 0)) INTO origineel_totaal
  FROM public.invoices
  WHERE id = NEW.original_invoice_id
  FOR UPDATE;

  -- Geen origineel gevonden: niets om tegen af te zetten. De foreign key hoort dit al te hebben
  -- geweigerd; laat het daar en niet hier, zodat de fout blijft zeggen wat hij is.
  IF origineel_totaal IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(abs(coalesce(total_inc_btw, 0))), 0) INTO al_gecrediteerd
  FROM public.invoices
  WHERE invoice_type = 'creditnota'
    AND original_invoice_id = NEW.original_invoice_id
    AND id IS DISTINCT FROM NEW.id;

  dit_bedrag := abs(coalesce(NEW.total_inc_btw, 0));

  IF al_gecrediteerd + dit_bedrag > origineel_totaal + 0.005 THEN
    RAISE EXCEPTION
      'creditnota exceeds original invoice: % already credited plus % would pass the invoice total of %',
      al_gecrediteerd, dit_bedrag, origineel_totaal
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_credit_within_original ON public.invoices;
CREATE TRIGGER trg_assert_credit_within_original
  BEFORE INSERT OR UPDATE OF total_inc_btw, original_invoice_id, invoice_type
  ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_credit_within_original();

COMMENT ON FUNCTION public.assert_credit_within_original() IS
  '[DEEL-CREDIT] De som van de creditnota''s op een factuur mag die factuur nooit overschrijden. '
  'Vergrendelt het origineel, zodat twee gelijktijdige creditnota''s elkaar niet kunnen passeren. '
  'Zie src/lib/partial-credit.ts voor dezelfde regel aan de applicatiekant.';
