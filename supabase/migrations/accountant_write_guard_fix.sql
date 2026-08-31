-- =====================================================================
-- [SEC-GUARD-FIX] De boekhoudersgrens noemde vijf kolommen die niet bestaan
-- =====================================================================
-- Probleem (bevestigd tegen het schema):
--   accountant_write_holes.sql herschreef prevent_accountant_amount_changes()
--   "letterlijk ongewijzigd, plus twee regels". Dat klopte niet. De nieuwe lijst
--   noemde VIJF kolommen die public.invoices niet heeft:
--       subtotal_excl_btw, btw_rate, paid_at, paid_amount, vendor_name
--   en liet ZES echte kolommen vallen die de vorige versie wél beschermde:
--       total_ex_btw, amount_paid, payment_method, payment_date,
--       marked_paid_at, payment_prepared_at
--
--   plpgsql bindt veldnamen van een record pas bij UITVOERING, en CREATE OR
--   REPLACE kan de body niet tegen een tabel valideren — de migratie draaide dus
--   schoon. De eigenaar- en service_role-takken keren eerder terug, dus niemand
--   merkte iets. Maar de eerste keer dat een GEKOPPELDE BOEKHOUDER een factuur
--   bijwerkt — elke klik op 'Verwerkt' / 'In behandeling' / 'Vraag', de kern van
--   zijn werk — bereikt de uitvoering de IF en geeft PostgreSQL:
--       ERROR 42703: record "new" has no field "subtotal_excl_btw"
--   De schrijfactie faalt, het scherm draait zijn optimistische status terug, en
--   de melding bevat geen 'verwerkt', dus geen enkele conflict-handler in de app
--   legt uit wat er misging.
--
--   Tegelijk was de grens ONDERBESCHERMD voor alles wat er wél doorheen kwam:
--   amount_paid en de vier betaalvelden stonden niet meer in de deny-list.
--
-- Deze migratie zet de functie terug op de originele lijst uit
-- invoice_accountant_write_guard.sql, plus vendor_iban + payment_reference (het
-- IBAN-gat dat accountant_write_holes.sql terecht wilde dichten) en document_id
-- (de koppeling naar het bewijs; geen boekhouderspad schrijft hem).
-- Alle namen zijn geverifieerd tegen het schema.
--
-- Idempotent en veilig ongeacht of accountant_write_holes.sql al is toegepast:
-- CREATE OR REPLACE zet simpelweg de juiste body neer. accountant_write_holes.sql
-- zelf is ook gecorrigeerd, zodat een VERSE deploy de kapotte versie nooit
-- installeert; deze migratie is er voor omgevingen die hem al draaiden.
--
-- APPLY: draaien in de Supabase SQL-editor. Geen data gewijzigd.
-- =====================================================================

BEGIN;

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
  -- [SEC-GUARD-FIX] Deze lijst is de ORIGINELE uit invoice_accountant_write_guard.sql,
  -- ongewijzigd, plus de drie die hier bij horen. Een eerdere versie van dit blok noemde
  -- vijf kolommen die niet op public.invoices bestaan (subtotal_excl_btw, btw_rate,
  -- paid_at, paid_amount, vendor_name). plpgsql bindt veldnamen pas bij UITVOERING, dus
  -- CREATE OR REPLACE slikte dat — en elke boekhouder die daarna op 'Verwerkt' klikte
  -- kreeg 42703 (record "new" has no field ...). Diezelfde herschrijving liet bovendien
  -- zes ECHTE kolommen vallen die de vorige versie wél beschermde: total_ex_btw,
  -- amount_paid, payment_method, payment_date, marked_paid_at en payment_prepared_at.
  -- Alle namen hieronder zijn geverifieerd tegen het schema.
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
     -- Geen enkel boekhouderspad schrijft hem (de UI zet alleen accountant_status/-note).
     (NEW.document_id          IS DISTINCT FROM OLD.document_id)          OR
     -- [SEC] Hieronder de twee die ontbraken. vendor_iban is het nummer dat de klant
     -- overtikt in zijn bank (IncomingManageClient.tsx:1354-1361); payment_reference is
     -- het kenmerk dat bij die overboeking hoort. Een boekhouder die deze twee kan
     -- verzetten, kan geld omleiden.
     (NEW.vendor_iban          IS DISTINCT FROM OLD.vendor_iban)          OR
     (NEW.payment_reference    IS DISTINCT FROM OLD.payment_reference)         OR
     -- [VRIJGESTELD] vat_deduction verzet rubriek 5b van de klant met het volledige btw_amount van
     -- de factuur: 'direct_exempt' schuift de voorbelasting van aftrekbaar naar geblokkeerd, en
     -- andersom net zo makkelijk. Hij stond in GEEN enkele versie van deze lijst. Hij staat in élke
     -- herdefinitie omdat in deze map niet vast te stellen is welke als laatste draait — één oude
     -- die na de nieuwe draait zou hem anders weer uit de bescherming halen.
     (NEW.vat_deduction       IS DISTINCT FROM OLD.vat_deduction)
  THEN
    RAISE EXCEPTION
      'Permission denied: een boekhouder mag alleen accountant_status en accountant_note wijzigen (invoice_id: %)',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$;
COMMIT;

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen)
--
--   select p.proname,
--          (position('subtotal_excl_btw' in pg_get_functiondef(p.oid)) > 0) as heeft_spookkolom,
--          (position('amount_paid'       in pg_get_functiondef(p.oid)) > 0) as beschermt_amount_paid,
--          (position('vendor_iban'       in pg_get_functiondef(p.oid)) > 0) as beschermt_iban
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'prevent_accountant_amount_changes';
--
-- Verwacht: heeft_spookkolom = false, beschermt_amount_paid = true,
--           beschermt_iban = true.
--
-- En de echte test: laat een gekoppelde boekhouder een factuur op 'verwerkt'
-- zetten. Dat moet SLAGEN. Laat hem daarna total_inc_btw of amount_paid
-- proberen te wijzigen — dat moet worden GEWEIGERD met de permission-melding,
-- niet met 42703.
-- =====================================================================
