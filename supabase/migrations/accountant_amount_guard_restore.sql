-- accountant_amount_guard_restore.sql
-- [SEC] Twee gaten in dezelfde trigger: drie kolommen die stil uit de deny-list vielen, en een
-- machtigingsuitzondering die meer toestond dan de machtiging zelf.
-- BoekBrug · augustus 2026
--
-- ── WAT ER IS GEBEURD ──
--
-- accountant_write_holes.sql voegde `vendor_iban`, `payment_reference` en `document_id` toe aan de
-- beschermde kolommen van prevent_accountant_amount_changes(), met een [SEC]-toelichting erbij
-- over waarom juist die. Daarna herdefinieerde accountant_confirm_mandate.sql dezelfde functie —
-- om uitzondering 5 (de bevestigmachtiging) toe te voegen — en nam de lijst over ZONDER die drie.
--
-- CREATE OR REPLACE vervangt het lichaam volledig. Er is geen waarschuwing, geen conflict, en in
-- een map met 118 migraties zonder volgordenummer en zonder journaal is er ook niets dat zegt
-- welke van de twee als laatste is gedraaid. Nagekeken in de productiedatabase op 30 augustus
-- 2026: de LIVE functie draagt zeventien kolommen, niet twintig. De reparatie was dus terug-
-- gedraaid en niemand wist het.
--
-- ── WAAROM DIT ERGER IS DAN EEN VERGETEN KOLOM ──
--
-- `invoices_accountant_update_v2` laat een gemachtigde boekhouder een gedeelde factuur UPDATEN;
-- deze trigger is wat daar de financiële kolommen uit houdt. Met vendor_iban erbuiten kan een
-- boekhouder het rekeningnummer op een inkoopfactuur van zijn klant wijzigen. De ondernemer
-- betaalt daarna naar dat nummer.
--
-- En het is dubbel: `vendor_iban` is óók de referentie waartegen de IBAN-wisselcontrole
-- (iban-change.ts, import-health.ts) de VOLGENDE factuur van dezelfde leverancier vergelijkt.
-- Wie hem hier verzet, verlegt de betaling én de meetlat die dat had moeten opmerken.
-- correction-scope.ts zegt het zelf, over een andere deur: "letting it change AFTER money moved
-- is precisely the edit an attacker would want".
--
-- ── WAT HIERONDER STAAT ──
--
-- Dezelfde functie als in accountant_confirm_mandate.sql — alle vijf de uitzonderingen ongewijzigd,
-- inclusief de bevestigmachtiging — met de drie kolommen terug in de deny-list. Er verandert
-- niets aan wat een boekhouder MAG; alleen aan wat hij niet mag.
--
-- ── EN HET TWEEDE GAT, IN DEZELFDE FUNCTIE ──
--
-- Uitzondering 4 (de factuurmachtiging) pinde alleen sender_id, receiver_id en direction. Al het
-- andere stond open — inclusief status, amount_paid en de betaaldatums. De machtiging heet
-- "facturen opstellen namens de klant" en zegt niets over BETAALD verklaren, maar een gemachtigde
-- boekhouder kon met één PATCH zijn eigen concept op 'paid' zetten met een bedrag erbij: een
-- betaling die nooit binnenkwam, in de boeken van de klant. Nu staat er precies toe wat
-- /api/invoice/send schrijft en niets daarbuiten. Zie de toelichting bij de uitzondering zelf.
--
-- Beide zitten in ÉÉN bestand omdat ze dezelfde functie herschrijven: los toegepast wint de
-- laatste en verliest de andere, wat exact is hoe het eerste gat is ontstaan.
--
-- TOEPASSEN: draaien in de Supabase SQL-editor. Verwijdert niets. Idempotent (CREATE OR REPLACE).
-- =====================================================================

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
  -- [MANDAAT] Exception 4: a mandated accountant issuing a draft THEY made for THIS client.
  --
  -- [SEC] De uitzondering pinde alleen sender_id, receiver_id en direction. Al het andere stond
  -- open, en dat is méér dan de machtiging zegt. De machtiging heet "facturen opstellen namens de
  -- klant"; ze zegt niets over BETAALD verklaren. Met de oude vorm kon een gemachtigde boekhouder
  -- zijn eigen concept met één PATCH op `status = 'paid'`, `amount_paid = <totaal>`,
  -- `payment_date = <datum>` zetten: een betaling die nooit is binnengekomen, in de boeken van de
  -- klant, zonder bankregel en zonder dat de eigenaar iets deed.
  --
  -- Wat de app zelf schrijft bij het VERSTUREN (api/invoice/send, met de sessie van de boekhouder)
  -- is precies: status → 'sent', invoice_number, invoice_type, soms delivery_date, en de drie
  -- totalen. Die blijven allemaal toegestaan — er verandert niets aan wat een boekhouder MAG doen.
  --
  --   · status mag alleen naar 'sent' (of blijven wat het was: een conversie raakt hem niet aan).
  --     Niet naar 'paid', niet naar 'received'.
  --   · invoice_number mag worden GEZET als er nog geen stond — dat is het slaan van het nummer —
  --     maar een bestaand nummer niet worden herschreven. Art. 35 vraagt een doorlopende reeks, en
  --     invoice-continuity.ts meldt een gat op het klaar-scherm van de eigenaar.
  --   · de betaalkolommen blijven staan zoals ze stonden.
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
     -- CREATE OR REPLACE stil uit de lijst vielen. Ze staan hier weer, met hun reden erbij,
     -- zodat de volgende herdefinitie ze niet nog eens kan vergeten zonder het te zien.
     --
     -- vendor_iban        het rekeningnummer waar de ondernemer straks naartoe betaalt, EN de
     --                    referentie waartegen de IBAN-wisselcontrole de volgende factuur van
     --                    dezelfde leverancier afzet. Hem hier laten wijzigen verlegt niet
     --                    alleen de betaling, het verzet ook de meetlat die het zou opmerken.
     -- payment_reference  wat de ondernemer bij die betaling als kenmerk overneemt.
     -- document_id        welk BEWIJSSTUK onder deze factuur hangt. Een ander document
     --                    eronder schuiven verandert waar de boeking op steunt.
     (NEW.vendor_iban         IS DISTINCT FROM OLD.vendor_iban)         OR
     (NEW.payment_reference   IS DISTINCT FROM OLD.payment_reference)   OR
     (NEW.document_id         IS DISTINCT FROM OLD.document_id)         OR
     -- [VRIJGESTELD] Toegevoegd toen bleek dat vat_deduction in GEEN enkele versie van deze lijst
     -- stond. Hij verzet rubriek 5b van de klant met het volledige btw_amount van de factuur:
     -- 'direct_exempt' schuift de voorbelasting van aftrekbaar naar geblokkeerd, en andersom net zo
     -- makkelijk. Hij staat hier ook al is dit niet de nieuwste herdefinitie — dat is juist het punt
     -- van deze lijst: welke migratie als laatste draait, valt in deze map niet vast te stellen, dus
     -- draagt elke herdefinitie de volledige lijst. Zonder deze regel zou dit bestand, één keer ná
     -- accountant_vat_deduction_guard.sql gedraaid, de kolom weer uit de bescherming halen.
     (NEW.vat_deduction       IS DISTINCT FROM OLD.vat_deduction)
  THEN
    RAISE EXCEPTION
      'Permission denied: only the invoice owner can modify amounts, dates, status or payment fields (invoice_id: %)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen). Alle drie moeten `true` geven.
-- =====================================================================
-- select
--   position('vendor_iban'       in pg_get_functiondef(p.oid)) > 0 as iban_beschermd,
--   position('payment_reference' in pg_get_functiondef(p.oid)) > 0 as kenmerk_beschermd,
--   position('document_id'       in pg_get_functiondef(p.oid)) > 0 as bewijs_beschermd
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'prevent_accountant_amount_changes';
--
-- En dat uitzondering 5 er nog staat (de bevestigmachtiging mag niet zijn gesneuveld):
-- select position('has_active_confirm_mandate' in pg_get_functiondef(p.oid)) > 0 as bevestigen_nog_mogelijk
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'prevent_accountant_amount_changes';
--
-- En dat uitzondering 4 de betaalkolommen vastpint (moet `true` geven):
-- select position('NEW.amount_paid         IS NOT DISTINCT FROM OLD.amount_paid' in pg_get_functiondef(p.oid)) > 0 as mandaat_betaalt_niet
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'prevent_accountant_amount_changes';
