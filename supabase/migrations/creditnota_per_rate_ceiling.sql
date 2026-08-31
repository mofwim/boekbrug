-- supabase/migrations/creditnota_per_rate_ceiling.sql
-- [DEEL-CREDIT] Het plafond per BTW-TARIEF, in de database. De app kent het al; de database niet.
--
-- creditnota_partial.sql liet de unieke index invoices_one_creditnota_per_original vallen — terecht,
-- want een factuur mag meer dan één creditnota krijgen — en zette er een trigger voor in de plaats
-- die het origineel met FOR UPDATE vergrendelt en de BRUTOTOTALEN optelt. Dat plafond bindt, maar
-- het is blind voor de samenstelling.
--
-- Het voorbeeld staat in de app zelf (partial-credit.ts:124-125 en de route erboven, woordelijk):
--
--     1 x EUR 1.000 @ 21% + 1 x EUR 1.000 @ 9%, bruto EUR 2.300
--     crediteer de 9%-regel, twee keer: 2 x EUR 1.090 = EUR 2.180 <= EUR 2.300 -> beide keren OK
--
-- De regel die dat hoort tegen te houden staat in /api/invoice/creditnota, tussen een SELECT van de
-- bestaande creditnota's en de INSERT — meerdere PostgREST-aanroepen uit elkaar, elk zijn eigen
-- transactie. Twee gelijktijdige aanvragen (twee tabbladen, of een client die opnieuw probeert nadat
-- de gateway een time-out gaf) lezen allebei "nog niets gecrediteerd", komen allebei door de
-- app-controle, en de trigger laat ze allebei door omdat 2.180 onder 2.300 blijft.
--
-- Wat dat kost: EUR 180 aan BTW teruggevraagd in rubriek 1b waar er ooit EUR 90 is afgedragen, en
-- EUR 2.000 omzet teruggenomen op een regel van EUR 1.000 — op twee documenten uit de doorlopende
-- reeks die niet meer zijn in te trekken (art. 35 Wet OB). Geen enkel scherm merkt het op: elke
-- creditnota is op zichzelf geldig en het brutoplafond zegt dat er nog EUR 120 te crediteren valt.
--
-- WAT DEZE TRIGGER WEL EN NIET DOET
--
-- Per TARIEF, niet per regel. Er bestaat geen kolom die een creditnotaregel terugwijst naar de regel
-- die hij terugneemt (partial-credit.ts:130-131 zegt dat met zoveel woorden), dus per regel kan de
-- database niet rekenen. Per tarief kan wel, uit de gegevens die er zijn, en dat is precies genoeg
-- voor het geval hierboven: twee keer de 9%-regel crediteren overschrijdt het 9%-bedrag van het
-- origineel.
--
-- Hij is bewust ZWAKKER dan de app-regel. Hij kan alleen weigeren wat op tariefniveau echt te veel
-- is, dus hij kan geen enkele creditnota tegenhouden die vandaag terecht wordt geaccepteerd. Dat is
-- de eigenschap die hem veilig maakt om toe te passen: hij vangt de race, en verder niets.
--
-- ⚠️ NIET TOEGEPAST door de assistent — en van de migraties die ik vannacht heb geschreven is dit
-- de enige die ik niet tegen een database heb kunnen nameten. Lees hem, en draai hem op een moment
-- dat je een creditnota kunt maken om te controleren dat een NORMALE nog gewoon lukt. Zonder hem
-- verandert er niets: het brutoplafond blijft staan en de app-regel blijft doen wat hij nu doet.

CREATE OR REPLACE FUNCTION public.assert_credit_within_rate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_original uuid;
  v_rate     numeric;
  v_origineel numeric;
  v_gecrediteerd numeric;
BEGIN
  -- Alleen regels van een creditnota die aan een origineel hangt. Al het andere gaat ongemoeid
  -- door: gewone facturen, losse creditnota's zonder origineel, en elke bestaande rij.
  SELECT i.original_invoice_id INTO v_original
  FROM public.invoices i
  WHERE i.id = NEW.invoice_id AND i.invoice_type = 'creditnota';
  IF v_original IS NULL THEN
    RETURN NEW;
  END IF;

  v_rate := coalesce(NEW.btw_rate, 0);

  -- Serialiseren op het origineel, dezelfde greep die assert_credit_within_original neemt. Twee
  -- gelijktijdige inserts wachten hier op elkaar in plaats van allebei "nog niets" te lezen.
  PERFORM 1 FROM public.invoices WHERE id = v_original FOR UPDATE;

  -- Wat het origineel op DIT tarief draagt.
  SELECT coalesce(sum(abs(coalesce(l.line_total, 0))), 0) INTO v_origineel
  FROM public.invoice_lines l
  WHERE l.invoice_id = v_original AND coalesce(l.btw_rate, 0) = v_rate;

  -- Wat er op dit tarief al is teruggenomen, inclusief de regel die nu wordt ingevoegd.
  SELECT coalesce(sum(abs(coalesce(l.line_total, 0))), 0) INTO v_gecrediteerd
  FROM public.invoice_lines l
  JOIN public.invoices c ON c.id = l.invoice_id
  WHERE c.invoice_type = 'creditnota'
    AND c.original_invoice_id = v_original
    AND coalesce(l.btw_rate, 0) = v_rate
    AND l.id IS DISTINCT FROM NEW.id;
  v_gecrediteerd := v_gecrediteerd + abs(coalesce(NEW.line_total, 0));

  -- Een halve cent speling, dezelfde als het brutoplafond hanteert. En alleen weigeren wanneer het
  -- origineel op dit tarief IETS draagt: staat er niets, dan is dit geen overschrijding maar een
  -- creditnota met een tarief dat het origineel niet had, en dat is een andere vraag dan deze.
  IF v_origineel > 0 AND v_gecrediteerd > v_origineel + 0.005 THEN
    -- Drie plaatshouders, drie argumenten. Geen `%%` in deze tekst: dat is een LETTERLIJK
    -- procentteken dat geen argument opneemt, en plpgsql telt streng — met een literal erbij zou
    -- deze RAISE zelf afbreken op "too many parameters specified for RAISE", precies op het moment
    -- dat hij een begrijpelijke zin hoort te geven. Het tarief staat er dus als getal.
    RAISE EXCEPTION
      'Deze creditnota neemt op tarief % meer terug dan de oorspronkelijke factuur daarop draagt (% van %).',
      v_rate, round(v_gecrediteerd, 2), round(v_origineel, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS assert_credit_within_rate_trg ON public.invoice_lines;
CREATE TRIGGER assert_credit_within_rate_trg
  BEFORE INSERT ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.assert_credit_within_rate();
