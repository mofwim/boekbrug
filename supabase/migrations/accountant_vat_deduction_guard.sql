-- supabase/migrations/accountant_vat_deduction_guard.sql
-- [SEC][VRIJGESTELD] invoices.vat_deduction hoort achter de boekhoudersgrens, en stond erbuiten.
--
-- Die kolom bepaalt of de voorbelasting van een inkoopfactuur voor 100%, voor 0% of pro rata
-- meetelt. financial-result.ts:364 leest hem: 'direct_taxed' → aftrekbaar, 'direct_exempt' →
-- geblokkeerd, anders → gemengd. Eén PATCH verzet dus rubriek 5b van de klant met het volledige
-- btw_amount van die factuur — op EUR 10.000 + 21% is dat EUR 2.100, stil, in de aangifte die naar
-- de Belastingdienst gaat. En de andere kant op net zo goed: geblokkeerde voorbelasting alsnog
-- aftrekbaar maken is geen boekhoudkundige nuance maar een onterechte teruggave.
--
-- Een boekhouder die aan een klant gekoppeld is (accountant_clients, géén mandaat nodig) kwam er
-- bij: de factuur is 'incoming' met status 'received' of 'paid', dus de GENERATED kolom `shared`
-- staat aan en invoices_accountant_update_v2 laat de rij door. De trigger noemde de kolom niet, dus
-- de schrijving landde.
--
-- Dit is dezelfde soort omissie als vendor_iban, payment_reference en document_id — de drie die bij
-- een eerdere CREATE OR REPLACE stil uit de lijst vielen. De functie waarschuwt daar zelf voor:
-- "zodat de volgende herdefinitie ze niet nog eens kan vergeten zonder het te zien." Dit is er een
-- die er nooit in heeft gestaan. De poort [SEC] in lifecycle-gates.test.ts eist sinds vandaag dat
-- ELKE herdefinitie de volledige lijst draagt, vat_deduction inbegrepen, zodat de volgorde van deze
-- map er niet meer toe doet.
--
-- Op de LIVE definitie gebaseerd, niet op het laatste bestand in deze map — dat onderscheid is
-- eerder vandaag duur gebleken. Alles wat een boekhouder MAG blijft ongewijzigd; er komt precies
-- één kolomvergelijking bij, op twee plekken.
--
-- ⚠️ NIET TOEGEPAST door de assistent. Draai hem zelf in de Supabase SQL-editor.

CREATE OR REPLACE FUNCTION public.prevent_accountant_amount_changes()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Exception 1: service_role / pipeline (auth.uid() = NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Exception 2: ZZP invoice owner (sender) may change anything
  IF OLD.sender_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  -- Exception 3: receiver of an incoming invoice (mark-as-paid)
  IF OLD.receiver_id = auth.uid() AND OLD.direction = 'incoming' THEN
    RETURN NEW;
  END IF;
  -- [MANDAAT] Exception 4: a mandated accountant issuing a draft THEY made for THIS client.
  -- Ongewijzigd. De machtiging heet "facturen opstellen namens de klant" en zegt niets over
  -- BETAALD verklaren, dus de betaalkolommen blijven hier gepind.
  IF OLD.status = 'draft'
     AND OLD.created_by = auth.uid()
     AND NEW.sender_id   IS NOT DISTINCT FROM OLD.sender_id
     AND NEW.receiver_id IS NOT DISTINCT FROM OLD.receiver_id
     AND NEW.direction   IS NOT DISTINCT FROM OLD.direction
     AND NEW.status IN (OLD.status, 'sent')
     AND (OLD.invoice_number IS NULL
          OR NEW.invoice_number IS NOT DISTINCT FROM OLD.invoice_number)
     AND NEW.amount_paid         IS NOT DISTINCT FROM OLD.amount_paid
     AND NEW.payment_method      IS NOT DISTINCT FROM OLD.payment_method
     AND NEW.payment_date        IS NOT DISTINCT FROM OLD.payment_date
     AND NEW.marked_paid_at      IS NOT DISTINCT FROM OLD.marked_paid_at
     AND NEW.payment_prepared_at IS NOT DISTINCT FROM OLD.payment_prepared_at
     AND NEW.pay_token           IS NOT DISTINCT FROM OLD.pay_token
     AND public.has_active_invoice_mandate(auth.uid(), OLD.sender_id)
  THEN
    RETURN NEW;
  END IF;
  -- [BEVESTIGEN] Exception 5: a mandated accountant confirming an incoming invoice — and ONLY
  -- moving it processing → received. Every financial column stays locked, including for them.
  --
  -- [VRIJGESTELD] vat_deduction hoort in deze lijst en stond er niet in. Dit is precies de
  -- factuursoort waar hij op werkt (inkoop), en bevestigen is niet hetzelfde als beslissen of de
  -- voorbelasting aftrekbaar is.
  IF OLD.direction = 'incoming'
     AND OLD.status = 'processing'
     AND NEW.status = 'received'
     AND NEW.receiver_id IS NOT DISTINCT FROM OLD.receiver_id
     AND NEW.sender_id   IS NOT DISTINCT FROM OLD.sender_id
     AND NEW.direction   IS NOT DISTINCT FROM OLD.direction
     AND NEW.total_ex_btw  IS NOT DISTINCT FROM OLD.total_ex_btw
     AND NEW.btw_amount    IS NOT DISTINCT FROM OLD.btw_amount
     AND NEW.total_inc_btw IS NOT DISTINCT FROM OLD.total_inc_btw
     AND NEW.invoice_date  IS NOT DISTINCT FROM OLD.invoice_date
     AND NEW.due_date      IS NOT DISTINCT FROM OLD.due_date
     AND NEW.amount_paid   IS NOT DISTINCT FROM OLD.amount_paid
     AND NEW.payment_date  IS NOT DISTINCT FROM OLD.payment_date
     AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method
     AND NEW.vat_deduction  IS NOT DISTINCT FROM OLD.vat_deduction
     AND public.has_active_confirm_mandate(auth.uid(), OLD.receiver_id)
  THEN
    RETURN NEW;
  END IF;
  -- Everyone else (accountant) — protected columns.
  IF (NEW.total_ex_btw        IS DISTINCT FROM OLD.total_ex_btw)        OR
     (NEW.btw_amount          IS DISTINCT FROM OLD.btw_amount)          OR
     (NEW.total_inc_btw       IS DISTINCT FROM OLD.total_inc_btw)       OR
     (NEW.invoice_date        IS DISTINCT FROM OLD.invoice_date)        OR
     (NEW.due_date            IS DISTINCT FROM OLD.due_date)            OR
     (NEW.sender_id           IS DISTINCT FROM OLD.sender_id)           OR
     (NEW.receiver_id         IS DISTINCT FROM OLD.receiver_id)         OR
     (NEW.direction           IS DISTINCT FROM OLD.direction)           OR
     (NEW.status              IS DISTINCT FROM OLD.status)              OR
     (NEW.amount_paid         IS DISTINCT FROM OLD.amount_paid)         OR
     (NEW.payment_method      IS DISTINCT FROM OLD.payment_method)      OR
     (NEW.payment_date        IS DISTINCT FROM OLD.payment_date)        OR
     (NEW.marked_paid_at      IS DISTINCT FROM OLD.marked_paid_at)      OR
     (NEW.payment_prepared_at IS DISTINCT FROM OLD.payment_prepared_at) OR
     (NEW.pay_token           IS DISTINCT FROM OLD.pay_token)           OR
     (NEW.invoice_number      IS DISTINCT FROM OLD.invoice_number)      OR
     (NEW.invoice_type        IS DISTINCT FROM OLD.invoice_type)        OR
     -- [SEC] De drie die accountant_write_holes.sql had toegevoegd en die bij de volgende
     -- CREATE OR REPLACE stil uit de lijst vielen.
     (NEW.vendor_iban         IS DISTINCT FROM OLD.vendor_iban)         OR
     (NEW.payment_reference   IS DISTINCT FROM OLD.payment_reference)   OR
     (NEW.document_id         IS DISTINCT FROM OLD.document_id)         OR
     -- [VRIJGESTELD] De vierde, die er nooit in heeft gestaan. Hij verzet rubriek 5b: 'direct_exempt'
     -- schuift de voorbelasting van deze inkoop van aftrekbaar naar geblokkeerd, en terug net zo
     -- makkelijk. Dat is geen boekhoudkundige nuance maar het bedrag dat de klant terugkrijgt.
     (NEW.vat_deduction       IS DISTINCT FROM OLD.vat_deduction)       OR
     -- [KORTING-SLOT] Geen bedragen maar de INVOER waaruit bedragen worden herrekend:
     -- buildInvoiceUbl leidt PayableAmount en TaxAmount af uit parseDiscount(discount_type,
     -- discount_value), en PUT /api/invoice/[id] herberekent daaruit total_ex_btw, btw_amount en
     -- total_inc_btw. Een uitkomst beschermen en de invoer open laten is geen bescherming.
     (NEW.discount_type       IS DISTINCT FROM OLD.discount_type)       OR
     (NEW.discount_value      IS DISTINCT FROM OLD.discount_value)
  THEN
    RAISE EXCEPTION
      'Permission denied: only the invoice owner can modify amounts, dates, status or payment fields (invoice_id: %)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$function$;
