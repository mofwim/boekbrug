-- verwerkt_freeze_level.sql
-- [VERWERKT-GELIJK] De verwerkt-bevriezing noemde 11 kolommen; haar tweelingzuster op DEZELFDE
-- tabel noemt er 23. Precies de 11 zaten in allebei, en 12 alleen in de andere.
-- BoekBrug · augustus 2026
--
-- ── WAT ER MIS WAS ──
--
-- Op public.invoices staan twee bevriezingen naast elkaar:
--
--   prevent_accountant_amount_changes   een boekhouder mag de cijfers van zijn klant niet verzetten
--   prevent_verwerkt_invoice_changes    is de factuur eenmaal 'verwerkt', dan liggen ze vast
--
-- Ze beschermen tegen verschillende personen, maar ze beschermen dezelfde FEITEN. Allebei zijn ze
-- met de hand opgesomd, en alleen de eerste is bijgehouden. Gemeten: de verwerkt-lijst is een
-- ECHTE deelverzameling van de andere — nul kolommen de andere kant op. Er is dus geen enkele
-- reden waarom deze twaalf er niet in staan; ze zijn simpelweg nooit meegegroeid.
--
-- Wat er daardoor nog kon, NADAT de boekhouder de factuur had geboekt:
--
--   · invoice_type omzetten van 'factuur' naar 'creditnota'. De bedragen liggen vast, dus het
--     document houdt zijn getallen en verandert alleen van TEKEN-betekenis: elke lezer die een
--     creditnota aftrekt (creditedTotalsFrom, openAfterCredit, de aangifte, SnelStart) beweegt de
--     andere kant op, over een boeking die de boekhouder al heeft verwerkt. Dat is exact de vorm
--     die creditnotaSignConflict "de app die zichzelf tegenspreekt" noemt.
--   · direction omdraaien — verkoop wordt inkoop, omzet wordt kosten.
--   · sender_id / receiver_id verzetten: de factuur verhuist naar een andere partij.
--   · vat_deduction verzetten, wat rubriek 5b met het volledige btw-bedrag verschuift. Die kolom
--     is aan de andere trigger toegevoegd toen bleek dat hij in GEEN enkele lijst stond.
--   · discount_type / discount_value schrijven. Die twee zijn geen bedrag maar de INVOER waaruit
--     total_ex_btw, btw_amount en total_inc_btw worden herberekend (PUT /api/invoice/[id]) én
--     waaruit de e-factuur haar PayableAmount afleidt. Een uitkomst bevriezen en de invoer ervan
--     open laten is geen bevriezing.
--   · vendor_iban / payment_reference: waar het geld straks heen gaat.
--   · document_id: welk BEWIJSSTUK onder de geboekte factuur hangt.
--
-- ── WAT DIT VERANDERT VOOR DE EIGENAAR ──
--
-- Op een factuur die de boekhouder heeft VERWERKT lagen betaal-, bedrag- en datumvelden al vast;
-- daar komt nu de rest van dezelfde lijst bij. pay_token en payment_prepared_at horen daarbij: de
-- betaalvelden waar ze bij horen (amount_paid, payment_date, marked_paid_at) waren al bevroren, dus
-- een betaling vastleggen op een verwerkte factuur kon sowieso al niet. Wie iets moet wijzigen
-- vraagt de boekhouder eerst de verwerking ongedaan te maken — precies wat de foutmelding zegt.
--
-- ── TOEGEPAST ──
-- ✅ Op de productiedatabase gezet op 1 september 2026. Vooraf gemeten wat het zou kosten: er
-- stonden op dat moment NUL facturen met accountant_status = 'verwerkt', dus deze uitbreiding kon
-- op de dag zelf niets tegenhouden dat vandaag werkt. Ze is er voor de eerste factuur die een
-- boekhouder verwerkt — en dat is precies het moment waarop je hem niet meer wilt moeten regelen.

CREATE OR REPLACE FUNCTION public.prevent_verwerkt_invoice_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role / pipeline bypass (paths re-assert their own verwerkt checks)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.accountant_status IS DISTINCT FROM 'verwerkt' THEN
    RETURN NEW;
  END IF;
  -- [VERWERKT-GELIJK] Dezelfde kolommen als prevent_accountant_amount_changes, in dezelfde
  -- volgorde, zodat een lezer de twee naast elkaar kan leggen en het verschil ZIET.
  IF (NEW.total_ex_btw        IS DISTINCT FROM OLD.total_ex_btw) OR
     (NEW.btw_amount          IS DISTINCT FROM OLD.btw_amount) OR
     (NEW.total_inc_btw       IS DISTINCT FROM OLD.total_inc_btw) OR
     (NEW.invoice_date        IS DISTINCT FROM OLD.invoice_date) OR
     (NEW.due_date            IS DISTINCT FROM OLD.due_date) OR
     (NEW.sender_id           IS DISTINCT FROM OLD.sender_id) OR
     (NEW.receiver_id         IS DISTINCT FROM OLD.receiver_id) OR
     (NEW.direction           IS DISTINCT FROM OLD.direction) OR
     (NEW.status              IS DISTINCT FROM OLD.status) OR
     (NEW.amount_paid         IS DISTINCT FROM OLD.amount_paid) OR
     (NEW.payment_method      IS DISTINCT FROM OLD.payment_method) OR
     (NEW.payment_date        IS DISTINCT FROM OLD.payment_date) OR
     (NEW.marked_paid_at      IS DISTINCT FROM OLD.marked_paid_at) OR
     (NEW.payment_prepared_at IS DISTINCT FROM OLD.payment_prepared_at) OR
     (NEW.pay_token           IS DISTINCT FROM OLD.pay_token) OR
     (NEW.invoice_number      IS DISTINCT FROM OLD.invoice_number) OR
     (NEW.invoice_type        IS DISTINCT FROM OLD.invoice_type) OR
     (NEW.vendor_iban         IS DISTINCT FROM OLD.vendor_iban) OR
     (NEW.payment_reference   IS DISTINCT FROM OLD.payment_reference) OR
     (NEW.document_id         IS DISTINCT FROM OLD.document_id) OR
     (NEW.vat_deduction       IS DISTINCT FROM OLD.vat_deduction) OR
     (NEW.discount_type       IS DISTINCT FROM OLD.discount_type) OR
     (NEW.discount_value      IS DISTINCT FROM OLD.discount_value)
  THEN
    RAISE EXCEPTION
      'Factuur % is verwerkt door de boekhouder — vraag eerst om de verwerking ongedaan te maken',
      COALESCE(OLD.invoice_number, OLD.id::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_verwerkt_guard ON public.invoices;
CREATE TRIGGER invoices_verwerkt_guard
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_verwerkt_invoice_changes();

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen). Moet `true` geven.
-- =====================================================================
-- select
--   position('NEW.invoice_type'   in pg_get_functiondef(p.oid)) > 0
--   and position('NEW.direction'  in pg_get_functiondef(p.oid)) > 0
--   and position('NEW.discount_value' in pg_get_functiondef(p.oid)) > 0
--   and position('NEW.vat_deduction'  in pg_get_functiondef(p.oid)) > 0 as verwerkt_op_niveau
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'prevent_verwerkt_invoice_changes';
