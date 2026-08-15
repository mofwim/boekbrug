-- supabase/migrations/function_search_path.sql
-- [ZOEKPAD] De negen eigen functies krijgen een vast zoekpad.
--
-- ── WAT DIT WEL EN NIET IS ──
--
-- Dit is HYGIËNE, geen gat. Dat verschil hoort er eerlijk bij te staan, want een migratie die zich
-- voordoet als een noodreparatie maakt de volgende noodreparatie ongeloofwaardig.
--
-- De Supabase-linter meldt `function_search_path_mutable` op negen functies van ons. Die melding
-- gaat over deze aanval: een functie noemt een tabel zonder schema, de aanroeper zet een eigen
-- schema vóór `public` in zijn zoekpad, legt daar een tabel met dezelfde naam neer, en de functie
-- praat voortaan tegen die neptabel. Bij een `SECURITY DEFINER`-functie draait dat met de rechten
-- van de eigenaar, en dan is het een rechtenverhoging.
--
-- Nagemeten op de productiedatabase, niet aangenomen:
--
--   · geen van deze negen is SECURITY DEFINER — ze draaien allemaal met de rechten van de
--     aanroeper zelf, dus er valt niets te verhogen;
--   · `anon` noch `authenticated` heeft CREATE op ENIG schema (auth, extensions, graphql,
--     graphql_public, public, realtime, storage, vault — allemaal false). Er is dus geen plek waar
--     een neptabel neergezet kán worden.
--
-- Twee onafhankelijke redenen waarom dit vandaag niet uitbuitbaar is. Het wordt hier toch
-- vastgezet, om één reden: die twee redenen zijn omstandigheden, geen afspraken. Wie morgen één
-- van deze triggers `SECURITY DEFINER` maakt — een volstrekt normale wijziging — erft stilzwijgend
-- een echte kwetsbaarheid, en niets zou daarop wijzen. Het zoekpad vastzetten kost niets en haalt
-- die mogelijkheid weg.
--
-- ── WAAROM `public, pg_catalog, pg_temp` EN NIET `''` ──
--
-- Supabase raadt vaak `SET search_path = ''` aan, met alles volledig gekwalificeerd. Dat kan hier
-- niet zonder de functies te herschrijven: `get_accountant_for_zzper` noemt `accountant_clients`
-- zonder schema. Herschrijven is een grotere ingreep dan het probleem, en een herschreven
-- guard-trigger is precies het soort wijziging dat je niet ongemerkt wilt doen.
--
-- Wat de negen aanraken is nagelopen en past binnen dit pad:
--   · `auth.uid()` en `public.has_active_*` staan al mét schema in de broncode — die blijven kloppen;
--   · `to_tsvector()` en `now()` komen uit pg_catalog;
--   · `accountant_clients` staat in public.
--
-- `pg_temp` staat expliciet ACHTERAAN. Staat het er niet, dan zet Postgres het impliciet vooraan,
-- en dan is de tijdelijke sessie-schema van de aanroeper juist wél weer een plek om een naam te
-- kapen — precies wat deze migratie afsluit.
--
-- Alleen metadata; geen enkele functie wordt herschreven. Terugdraaien is één regel per functie:
--   ALTER FUNCTION public.<naam>() RESET search_path;
--
-- Idempotent. Draait veilig meerdere keren.

DO $$
DECLARE
  sig text;
BEGIN
  FOR sig IN
    SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         -- De vier bewakers. Deze staan vooraan omdat ze het meest te verliezen hebben: ze
         -- beschermen bedragen, betaalstatus en het abonnement tegen wijziging door iemand die er
         -- niet over gaat.
         'prevent_billing_self_grant',
         'prevent_accountant_amount_changes',
         'prevent_verwerkt_invoice_changes',
         'guard_paid_when_verwerkt',
         -- De rest: zoekvectoren en updated_at-stempels.
         'invoices_search_vector_update',
         'documents_search_vector_update',
         'set_updated_at',
         'touch_updated_at',
         'get_accountant_for_zzper'
       )
  LOOP
    -- Op handtekening, want een overladen functie zou anders half blijven staan.
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_catalog, pg_temp', sig);
  END LOOP;
END $$;

-- ── CONTROLE ───────────────────────────────────────────────────────────────────
-- Alle negen horen `search_path=public, pg_catalog, pg_temp` te tonen.
--
--   SELECT p.proname, coalesce(array_to_string(p.proconfig, ', '), '(geen)') AS config
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('prevent_billing_self_grant','prevent_accountant_amount_changes',
--                        'prevent_verwerkt_invoice_changes','guard_paid_when_verwerkt',
--                        'invoices_search_vector_update','documents_search_vector_update',
--                        'set_updated_at','touch_updated_at','get_accountant_for_zzper')
--    ORDER BY 1;
--
-- En of de bewakers nog bewaken — dat is wat er werkelijk toe doet. Alle vier horen te WEIGEREN,
-- als ingelogde gebruiker, niet via de server:
--   · een factuurbedrag wijzigen op een factuur van een ander            → prevent_accountant_amount_changes
--   · je eigen `subscription_plan` op 'plus' zetten                       → prevent_billing_self_grant
--   · een verwerkte factuur van bedrag veranderen                         → prevent_verwerkt_invoice_changes
--   · een verwerkte betaalde factuur terugzetten naar niet-betaald        → guard_paid_when_verwerkt
