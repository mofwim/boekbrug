-- =====================================================================
-- [SEC] Twee schrijfgaten in de boekhoudersgrens dichten + de ontbrekende
-- invoices-indexen. BoekBrug · juli 2026
-- =====================================================================
-- Gevonden bij een audit van de brug-grens. BEIDE zijn bevestigd in de code, en
-- beide zijn alleen via de database te dichten: de routes ervóór doen het al goed,
-- maar de browser praat met de POLICY, niet met de route.
--
-- ── GAT 1: acc_status_owner_all — inhoudsinjectie in het dashboard van een vreemde ──
--
-- accountant_subject_status.sql:37-41 zet:
--     FOR ALL USING (accountant_id = auth.uid()) WITH CHECK (accountant_id = auth.uid())
--
-- Er staat GEEN koppelingseis en GEEN eigendomseis op het subject. Dus élke ingelogde
-- gebruiker — geen boekhoudersrol nodig, geen accountant_clients-koppeling nodig — kan
-- met de publieke anon-sleutel dit doen:
--
--     insert into accountant_subject_status
--       (accountant_id, subject_type, subject_id, status, vraag_text)
--     values (auth.uid(), 'document', '<willekeurige document-uuid>', 'vraag', '<tekst>');
--
-- en de zusterpolicy acc_status_client_read_document (:45-56) toont die rij vervolgens
-- aan de EIGENAAR van dat document — als een vraag van zijn boekhouder. Willekeurige
-- tekst, in het dashboard van een vreemde, met andermans naam eronder.
--
-- De route /api/accountant/subject-status controleert de koppeling wél. Dat helpt niet:
-- de anon-sleutel staat in elke browser en RLS is de enige grens die telt.
--
-- ⚠️ De SELECT blijft ONGEWIJZIGD ruim, en dat is opzet. AV §7.4 belooft in de alinea
-- over het verbreken van de koppeling: "Reeds verwerkte data blijft beschikbaar voor
-- accountant in archief (verplicht voor compliance)." Deze rijen ZIJN zijn administratie
-- van wat hij verwerkt heeft, en zij lekken geen klantinhoud (subject_id is een kale
-- uuid). Alleen SCHRIJVEN wordt beperkt.
--
-- ── GAT 2: het IBAN dat de boekhouder mag herschrijven ──
--
-- prevent_accountant_amount_changes beschermt 17 kolommen, waaronder pay_token, maar
-- NIET vendor_iban en NIET payment_reference — allebei echte kolommen op invoices. En
-- invoices_accountant_update_v2 is niet kolom-beperkt. Een 'received' inkoopfactuur is
-- `shared`, dus zij valt binnen die policy.
--
-- Gevolg: een gekoppelde boekhouder kan het IBAN op een openstaande inkoopfactuur van
-- zijn klant wijzigen, en de klant kopieert dat nummer naar zijn bank
-- (IncomingManageClient.tsx:1354-1361). Dit is een geldpad.
--
-- Waarom een DENY-lijst en geen ALLOW-lijst: in een BEFORE UPDATE plpgsql-trigger is een
-- allow-lijst alleen uit te drukken als jsonb-diff (`to_jsonb(NEW) - 'accountant_status'
-- - ... IS DISTINCT FROM to_jsonb(OLD) - ...`). Die vuurt dan óók op updated_at,
-- search_vector en elke kolom die een toekomstige trigger in hetzelfde statement aanraakt
-- — een gerichte grens wordt zo een app-brede schrijfblokkade.
--
-- ── EN DE VIER ONTBREKENDE INDEXEN ──
-- Elke query op het boekhoudersoppervlak filtert op sender_id / receiver_id / shared /
-- invoice_date, en op géén van vieren bestaat een index. De kosten van de boekhouder
-- schalen daardoor met het TOTAAL aantal rijen op het platform in plaats van met zijn
-- eigen klantenaantal.
--
-- TOEPASSEN: Supabase SQL-editor. Verwijdert niets. Idempotent.
-- =====================================================================

BEGIN;

-- ── 1. Het schrijfgat op accountant_subject_status ────────────────────

DROP POLICY IF EXISTS acc_status_owner_all ON public.accountant_subject_status;

-- Lezen: ongewijzigd ruim (AV §7.4 — het archief van de boekhouder blijft van hem).
DROP POLICY IF EXISTS acc_status_owner_read ON public.accountant_subject_status;
CREATE POLICY acc_status_owner_read ON public.accountant_subject_status
  FOR SELECT
  USING (accountant_id = auth.uid());

-- Schrijven: alleen over een subject dat toebehoort aan een klant met wie deze
-- boekhouder een BEVESTIGDE koppeling heeft. is_my_accountant_client() is de bestaande
-- STABLE SECURITY DEFINER-helper die documents_accountant_read ook gebruikt.
--
-- Voor een factuur geldt bovendien `shared = true`: de boekhouder mag geen status hangen
-- aan een concept dat hij volgens AV §7.3 niet eens hoort te zien.
DROP POLICY IF EXISTS acc_status_owner_write ON public.accountant_subject_status;
CREATE POLICY acc_status_owner_write ON public.accountant_subject_status
  FOR ALL
  USING (
    accountant_id = auth.uid()
    AND (
      CASE
        WHEN subject_type = 'document' THEN EXISTS (
          SELECT 1 FROM public.documents d
          WHERE d.id = accountant_subject_status.subject_id
            AND public.is_my_accountant_client(d.user_id)
        )
        WHEN subject_type = 'invoice' THEN EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.id = accountant_subject_status.subject_id
            AND i.shared = true
            AND (
              public.is_my_accountant_client(i.sender_id)
              OR public.is_my_accountant_client(i.receiver_id)
            )
        )
        ELSE false
      END
    )
  )
  WITH CHECK (
    accountant_id = auth.uid()
    AND (
      CASE
        WHEN subject_type = 'document' THEN EXISTS (
          SELECT 1 FROM public.documents d
          WHERE d.id = accountant_subject_status.subject_id
            AND public.is_my_accountant_client(d.user_id)
        )
        WHEN subject_type = 'invoice' THEN EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.id = accountant_subject_status.subject_id
            AND i.shared = true
            AND (
              public.is_my_accountant_client(i.sender_id)
              OR public.is_my_accountant_client(i.receiver_id)
            )
        )
        ELSE false
      END
    )
  );

COMMENT ON POLICY acc_status_owner_write ON public.accountant_subject_status IS
  '[SEC] Schrijven alleen over subjects van een BEVESTIGDE klant. De vorige versie was FOR ALL zonder koppelingseis: elke ingelogde gebruiker kon een "vraag" injecteren in het dashboard van een vreemde, ogenschijnlijk van diens boekhouder.';

-- ── 2. Het IBAN-gat in de factuurgrens ───────────────────────────────
-- Twee regels erbij in dezelfde IS DISTINCT FROM-ketting. De functie wordt in haar
-- geheel herschreven omdat CREATE OR REPLACE geen gedeeltelijke wijziging kent; de rest
-- is letterlijk ongewijzigd overgenomen uit invoice_accountant_write_guard.sql.
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
  IF (NEW.total_inc_btw        IS DISTINCT FROM OLD.total_inc_btw)        OR
     (NEW.subtotal_excl_btw    IS DISTINCT FROM OLD.subtotal_excl_btw)    OR
     (NEW.btw_amount           IS DISTINCT FROM OLD.btw_amount)           OR
     (NEW.btw_rate             IS DISTINCT FROM OLD.btw_rate)             OR
     (NEW.invoice_number       IS DISTINCT FROM OLD.invoice_number)       OR
     (NEW.invoice_date         IS DISTINCT FROM OLD.invoice_date)         OR
     (NEW.due_date             IS DISTINCT FROM OLD.due_date)             OR
     (NEW.status               IS DISTINCT FROM OLD.status)               OR
     (NEW.invoice_type         IS DISTINCT FROM OLD.invoice_type)         OR
     (NEW.sender_id            IS DISTINCT FROM OLD.sender_id)            OR
     (NEW.receiver_id          IS DISTINCT FROM OLD.receiver_id)          OR
     (NEW.direction            IS DISTINCT FROM OLD.direction)            OR
     (NEW.paid_at              IS DISTINCT FROM OLD.paid_at)              OR
     (NEW.paid_amount          IS DISTINCT FROM OLD.paid_amount)          OR
     (NEW.pay_token            IS DISTINCT FROM OLD.pay_token)            OR
     (NEW.document_id          IS DISTINCT FROM OLD.document_id)          OR
     (NEW.vendor_name          IS DISTINCT FROM OLD.vendor_name)          OR
     -- [SEC] Hieronder de twee die ontbraken. vendor_iban is het nummer dat de klant
     -- overtikt in zijn bank (IncomingManageClient.tsx:1354-1361); payment_reference is
     -- het kenmerk dat bij die overboeking hoort. Een boekhouder die deze twee kan
     -- verzetten, kan geld omleiden.
     (NEW.vendor_iban          IS DISTINCT FROM OLD.vendor_iban)          OR
     (NEW.payment_reference    IS DISTINCT FROM OLD.payment_reference)
  THEN
    RAISE EXCEPTION
      'Permission denied: een boekhouder mag alleen accountant_status en accountant_note wijzigen (invoice_id: %)',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. De vier ontbrekende indexen op invoices ───────────────────────
-- Elke boekhoudersquery is van de vorm
--   .or(sender_id.eq.X,receiver_id.eq.X).eq('shared',true).gte('invoice_date',…)
-- en geen van deze vier kolommen was geïndexeerd.
CREATE INDEX IF NOT EXISTS idx_invoices_sender_id    ON public.invoices (sender_id);
CREATE INDEX IF NOT EXISTS idx_invoices_receiver_id  ON public.invoices (receiver_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON public.invoices (invoice_date);
-- Partieel: alleen gedeelde rijen worden hierop gefilterd, en dat is de minderheid.
CREATE INDEX IF NOT EXISTS idx_invoices_shared       ON public.invoices (shared) WHERE shared = true;

COMMIT;

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen):
--
--   -- 1. De policies staan er, en de FOR ALL zonder koppelingseis is weg.
--   select policyname, cmd from pg_policies
--    where schemaname='public' and tablename='accountant_subject_status'
--    order by policyname;
--   -- Verwacht: acc_status_client_read_document (SELECT) · acc_status_owner_read (SELECT)
--   --           · acc_status_owner_write (ALL). GEEN acc_status_owner_all.
--
--   -- 2. Het IBAN staat nu in de grens.
--   select pg_get_functiondef(oid) ilike '%vendor_iban%' as iban_beschermd
--     from pg_proc where proname = 'prevent_accountant_amount_changes';
--   -- Verwacht: true
--
--   -- 3. De vier indexen.
--   select indexname from pg_indexes
--    where tablename='invoices'
--      and indexname in ('idx_invoices_sender_id','idx_invoices_receiver_id',
--                        'idx_invoices_invoice_date','idx_invoices_shared')
--    order by indexname;
--   -- Verwacht: 4 rijen
--
-- ── De injectie die dit dicht, met de hand nagespeeld ──
-- Als een INGELOGDE gebruiker (niet in de SQL-editor — die is service_role en gaat er
-- terecht doorheen), met een document-uuid van iemand met wie je GEEN koppeling hebt:
--
--   insert into public.accountant_subject_status
--     (accountant_id, subject_type, subject_id, status, vraag_text)
--   values (auth.uid(), 'document', '<uuid van een vreemde>', 'vraag', 'test');
--
-- Verwacht NA deze migratie: new row violates row-level security policy.
-- Vóór deze migratie: de rij werd aangemaakt en verscheen in het dashboard van de eigenaar.
-- =====================================================================
