-- [BEVESTIG-DICHT] confirm_bank_payment mag weer door een ingelogde gebruiker worden aangeroepen.
-- BoekBrug · september 2026
--
-- WAAROM
-- rpc_anon_revoke.sql (18 augustus) trok EXECUTE voor `authenticated` in op confirm_bank_payment,
-- met als reden "kent geen enkele aanroeper meer in de code". Op 2 september kreeg
-- /api/bank/confirm (bank_confirm_atomic) die aanroeper wél terug — met de sessieclient, en via
-- een variabele naam die de [ANON-RPC]-poort niet zag. Sindsdien antwoordde elke gewone
-- "Bevestig" op /bank (zonder deelbedrag) met 42501 permission denied → 500 "payment_failed".
-- Alleen het pad met een bedrag (allocate_bank_payment, wél toegestaan) werkte.
--
-- De functie draagt dezelfde aanroepergarantie als apply_bank_payment / allocate_bank_payment /
-- book_bank_batch: auth.uid() moet gelijk zijn aan p_user_id (sessieclient), of NULL zijn
-- (service-role, vastgepind door p_user_id). Ze hoort dus in dezelfde groep als die drie.
--
-- APPLY: draaien in de Supabase SQL editor. Idempotent.

DO $$
DECLARE sig text;
BEGIN
  FOR sig IN
    SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'confirm_bank_payment'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
  END LOOP;
END $$;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- SELECT has_function_privilege('authenticated', 'public.confirm_bank_payment(uuid,uuid,uuid,date)', 'EXECUTE');  → true
-- SELECT has_function_privilege('anon',          'public.confirm_bank_payment(uuid,uuid,uuid,date)', 'EXECUTE');  → false
