-- supabase/migrations/rpc_anon_revoke.sql
-- [ANON-RPC] De geld-functies zijn niet langer aanroepbaar door een bezoeker zonder account.
--
-- ── WAT ER MIS WAS ──
--
-- Een reeks SECURITY DEFINER-functies bewaakt zichzelf zo:
--
--     IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
--       RAISE EXCEPTION '… caller % may not …';
--     END IF;
--
-- De redenering erachter staat er in het Nederlands bij en klopt op één punt na: "met de
-- sessieclient is auth.uid() de aanroeper en moet hij gelijk zijn aan p_user_id; met service_role
-- is hij NULL en is de aanroep alleen door p_user_id vastgelegd."
--
-- Service_role is inderdaad NULL. Maar `anon` óók.
--
-- En `anon` is niet "niemand": het is de rol die hoort bij de publieke sleutel die in elke
-- browserbundel meegaat. PostgREST zet elke functie in het `public`-schema op /rest/v1/rpc/, en de
-- rol had EXECUTE. De guard slaat dus over voor precies de partij waar hij tegen bedoeld was.
--
-- Nagekeken op de productiedatabase, niet aangenomen:
--
--     SET LOCAL ROLE anon;  SELECT auth.uid() IS NULL;   →  true
--     has_function_privilege('anon', …, 'EXECUTE')       →  true, voor alle functies hieronder
--
-- Wat dat betekent per functie verschilt, en het ergste is niet het grootste bedrag:
--
--   · seed_invoice_counter — GREATEST maakt de teller alleen-vooruit, dus verlagen kan niet. Maar
--     VERHOGEN wel, met een willekeurig getal. De nummerreeks van Art. 35 Wet OB is onomkeerbaar:
--     wie er 999999999 in zet, heeft de nummering van die ondernemer permanent kapot gemaakt. Er
--     bestaat geen herstelknop, in dit product niet en in de wet niet.
--   · apply_manual_payment / apply_bank_payment / allocate_bank_payment / book_bank_batch /
--     move_invoice_payment — betalingen boeken, verplaatsen en facturen op 'paid' zetten op een
--     administratie die niet van de aanroeper is.
--   · recompute_invoice_amount_paid, fair_use_consume, fair_use_release — de stand van andermans
--     boekhouding en tegoed herrekenen of opsouperen.
--   · confirm_bank_payment — kent geen enkele aanroeper meer in de code, en stond wél open.
--   · handle_new_user, assert_credit_within_original — triggerfuncties. Die horen sowieso geen
--     RPC te zijn.
--
-- ── WAAROM INTREKKEN, EN NIET DE GUARD AANSCHERPEN ──
--
-- Een rechtencontrole gebeurt vóór de body draait en is niet te omzeilen door SECURITY DEFINER.
-- Een extra IF in elke functie is dertien plekken waar het opnieuw vergeten kan worden; één
-- REVOKE is de grens zelf. De guards blijven staan — ze doen nog steeds hun werk tussen ingelogde
-- gebruikers onderling.
--
-- ── WAT DIT NIET RAAKT ──
--
-- Elke aanroep in deze app loopt via een serverroute met óf de sessieclient (`authenticated`) óf
-- de pipeline (`service_role`). Geen enkele aanroep gebeurt als `anon` — nagelopen op alle
-- call sites. Voor de zekerheid wordt service_role hieronder expliciet opnieuw gemachtigd, want
-- REVOKE … FROM PUBLIC haalt ook impliciete rechten weg.
--
-- De hulpfuncties die IN RLS-POLICIES worden aangeroepen (acting_for_owner,
-- is_my_accountant_client, has_active_invoice_mandate, has_active_confirm_mandate,
-- audit_row_is_about_me) blijven met opzet ONGEMOEID: een policy draait als de bevragende rol, en
-- daar rechten weghalen zou lezen breken in plaats van schrijven dichtzetten.
--
-- Idempotent. Draait veilig meerdere keren.

-- ── 1. Niemand zonder account, voor alles wat iets verandert ────────────────────
DO $$
DECLARE
  fn text;
  sig text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'seed_invoice_counter',
    'next_invoice_seq',
    'apply_manual_payment',
    'apply_bank_payment',
    'allocate_bank_payment',
    'confirm_bank_payment',
    'book_bank_batch',
    'move_invoice_payment',
    'recompute_invoice_amount_paid',
    'fair_use_consume',
    'fair_use_release',
    'handle_new_user',
    'assert_credit_within_original'
  ]
  LOOP
    -- Op HANDTEKENING, niet op naam: een functie kan overladen zijn, en dan laat een REVOKE op de
    -- ene variant de andere gewoon openstaan.
    FOR sig IN
      SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
      -- De server houdt zijn sleutel. Dit staat er ná de REVOKE FROM PUBLIC omdat die ook
      -- impliciete rechten weghaalt, en de pipeline elke van deze functies gebruikt.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    END LOOP;
  END LOOP;
END $$;

-- ── 2. En van de functies die ALLEEN de server aanroept, ook de ingelogde gebruiker ──
--
-- Deze staan in geen enkele call site met de sessieclient. Een ingelogde gebruiker kan ze
-- vandaag alleen nog op zijn EIGEN administratie richten (de guard vangt de rest), maar
-- "zijn eigen teller op 999999999 zetten" is geen functie die iemand hoort te hebben.
-- De functies die het scherm wél nodig heeft — next_invoice_seq, apply_manual_payment,
-- apply_bank_payment, allocate_bank_payment, book_bank_batch, move_invoice_payment —
-- staan hier met opzet NIET tussen.
DO $$
DECLARE
  fn text;
  sig text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'seed_invoice_counter',
    'recompute_invoice_amount_paid',
    'fair_use_consume',
    'fair_use_release',
    'confirm_bank_payment',
    'handle_new_user',
    'assert_credit_within_original'
  ]
  LOOP
    FOR sig IN
      SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    END LOOP;
  END LOOP;
END $$;

-- ── CONTROLE ───────────────────────────────────────────────────────────────────
-- Draai dit na afloop. Elke regel hoort anon=false te tonen, en service_role=true.
-- De kolom `authenticated` mag true zijn voor de zes functies die het scherm aanroept.
--
--   SELECT p.proname,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('seed_invoice_counter','next_invoice_seq','apply_manual_payment',
--                        'apply_bank_payment','allocate_bank_payment','confirm_bank_payment',
--                        'book_bank_batch','move_invoice_payment','recompute_invoice_amount_paid',
--                        'fair_use_consume','fair_use_release','handle_new_user',
--                        'assert_credit_within_original')
--    ORDER BY 1;
--
-- Werkt de app daarna nog? De vier wegen om het te zien, allemaal via een ingelogd scherm:
--   · een concept versturen        → next_invoice_seq
--   · een factuur op betaald zetten → apply_manual_payment
--   · een banktransactie koppelen   → apply_bank_payment / allocate_bank_payment
--   · /api/health                   → raakt niets hiervan, maar zegt of de rest nog staat
