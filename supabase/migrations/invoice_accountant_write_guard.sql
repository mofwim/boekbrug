-- invoice_accountant_write_guard.sql
-- [AUDIT-2026-07] Two DB-level hardenings for invoice writes, from the invoice-
-- processing audit:
--
--  A. prevent_accountant_amount_changes() guarded only amounts/dates/sender_id.
--     The accountant UPDATE policy (invoices_accountant_update_v2) is not
--     column-restricted, so a linked accountant could still — outside every
--     guarded app path — flip `direction` (turning a client's omzet into
--     voorbelasting), set `status` ('archived' drops the row out of the
--     quarterly totals; 'paid' invents a payment with no audit row and no
--     bank-tx detach), re-point `receiver_id` to a DIFFERENT linked client
--     (moving an expense + its voorbelasting into another tenant's books), or
--     write payment fields / `pay_token` directly. The accountant's ONLY
--     legitimate invoice write is `accountant_status` (kwartaal page), so the
--     guard now protects every financially-relevant column.
--
--  B. The B.4 'verwerkt' guard existed ONLY on prod (see the drift note in
--     database.sql) — a fresh provision had no DB-level lock on a verwerkt
--     invoice, even though /api/invoice/pay-toggle and the confirm route
--     depend on it (they string-match 'verwerkt' in the error). This adds the
--     guard to the repo with deterministic names. If prod already carries its
--     own copy under another name the two coexist harmlessly (either RAISE
--     aborts the write first).
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Service-role writes
-- (auth.uid() IS NULL) bypass both guards — pipeline paths re-assert their own
-- preconditions (e.g. bank-auto-confirm's verwerkt WHERE clause).

-- ⚠ LET OP — DEZE TRIGGERFUNCTIE IS LATER NOG EEN KEER AANGEPAST.
-- accountant_invoice_mandate.sql voegt uitzondering 4 toe (een gemachtigde boekhouder die een
-- concept uitgeeft dat hij ZELF heeft gemaakt, voor deze klant, met sender_id/receiver_id/direction
-- onveranderd). Die migratie doet dat met CREATE OR REPLACE op dezelfde functie. Draai je DIT
-- bestand daarna opnieuw, dan wint de versie hieronder en verdwijnt die uitzondering geruisloos:
-- het concept wordt dan wel aangemaakt maar het versturen breekt af op "Permission denied", nadat
-- het factuurnummer al is verbruikt. Draai in dat geval accountant_invoice_mandate.sql er nog een
-- keer achteraan — hij is idempotent.

-- ── A. Accountant write guard — extended column list ─────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_accountant_amount_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
  -- Everyone else (accountant) — protected columns. The accountant's only
  -- legitimate invoice write is accountant_status; every financially-relevant
  -- column is locked here.
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
     -- [SEC] Deze drie zijn later toegevoegd (accountant_write_holes.sql) en vielen bij een
     -- volgende CREATE OR REPLACE stil uit de lijst. Ze staan nu in ELKE herdefinitie, zodat het
     -- niet uitmaakt welke van deze bestanden als laatste is gedraaid — deze map kent geen volgorde
     -- en houdt geen journaal bij, dus dat is niet vast te stellen.
     --
     -- vendor_iban        het rekeningnummer waar de ondernemer naartoe betaalt, EN de referentie
     --                    waartegen de IBAN-wisselcontrole de volgende factuur van dezelfde
     --                    leverancier afzet: hem verzetten verlegt de betaling én de meetlat.
     -- payment_reference  het kenmerk dat hij bij die betaling overneemt.
     -- document_id        welk bewijsstuk onder deze factuur hangt.
     (NEW.vendor_iban         IS DISTINCT FROM OLD.vendor_iban)         OR
     (NEW.payment_reference   IS DISTINCT FROM OLD.payment_reference)   OR
     (NEW.document_id         IS DISTINCT FROM OLD.document_id)         OR
     -- [VRIJGESTELD] vat_deduction verzet rubriek 5b van de klant met het volledige btw_amount van
     -- de factuur: 'direct_exempt' schuift de voorbelasting van aftrekbaar naar geblokkeerd, en
     -- andersom net zo makkelijk. Hij stond in GEEN enkele versie van deze lijst. Hij staat in élke
     -- herdefinitie omdat in deze map niet vast te stellen is welke als laatste draait — één oude
     -- die na de nieuwe draait zou hem anders weer uit de bescherming halen.
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
$$;

-- Re-bind (no-op when the trigger already exists with this name, as on prod).
DROP TRIGGER IF EXISTS prevent_accountant_amount_changes ON public.invoices;
CREATE TRIGGER prevent_accountant_amount_changes
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_accountant_amount_changes();

-- ── B. B.4 'verwerkt' guard — now reproducible from the repo ──────────────────
-- Once the accountant marks an invoice 'verwerkt', its financial fields are
-- frozen for every SESSION write (owner included — the app then shows the
-- "vraag de boekhouder om de verwerking ongedaan te maken" dialog). Changing
-- accountant_status itself stays allowed — that IS the undo flow — but never
-- combined with a financial change in the same statement.
-- The error message deliberately contains 'verwerkt': pay-toggle and the
-- confirm route detect the conflict by that substring.
CREATE OR REPLACE FUNCTION public.prevent_verwerkt_invoice_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- service_role / pipeline bypass (paths re-assert their own verwerkt checks)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.accountant_status IS DISTINCT FROM 'verwerkt' THEN
    RETURN NEW;
  END IF;
  IF (NEW.total_ex_btw   IS DISTINCT FROM OLD.total_ex_btw)   OR
     (NEW.btw_amount     IS DISTINCT FROM OLD.btw_amount)     OR
     (NEW.total_inc_btw  IS DISTINCT FROM OLD.total_inc_btw)  OR
     (NEW.invoice_date   IS DISTINCT FROM OLD.invoice_date)   OR
     (NEW.due_date       IS DISTINCT FROM OLD.due_date)       OR
     (NEW.invoice_number IS DISTINCT FROM OLD.invoice_number) OR
     (NEW.status         IS DISTINCT FROM OLD.status)         OR
     (NEW.amount_paid    IS DISTINCT FROM OLD.amount_paid)    OR
     (NEW.payment_method IS DISTINCT FROM OLD.payment_method) OR
     (NEW.payment_date   IS DISTINCT FROM OLD.payment_date)   OR
     (NEW.marked_paid_at IS DISTINCT FROM OLD.marked_paid_at)
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
