-- supabase/migrations/revoke_execute_on_trigger_functions.sql
-- [POORT-NIET-RPC] Een triggerfunctie hoort niet aan de buitenkant te hangen.
-- BoekBrug · 1 september 2026 · TOEGEPAST op de productiedatabase.
--
-- PostgREST publiceert élke functie in `public` als /rest/v1/rpc/<naam>. Deze zes zijn bewakers:
-- ze horen te draaien wanneer de database een rij aanraakt, en nooit omdat iemand ze aanroept.
-- Rechtstreeks aanroepen levert sowieso een fout op ("can only be called as trigger"), dus dit
-- neemt niemand iets af — het haalt zes deuren uit de gevel die nergens heen leiden.
--
-- assert_credit_within_original stond al zo; dit brengt de rest naar dezelfde stand.
--
-- WAAROM DE TRIGGERS GEWOON BLIJVEN VUREN: Postgres controleert het EXECUTE-recht bij CREATE
-- TRIGGER, niet bij elke rij. Dat is hier niet aangenomen maar gemeten — na het intrekken is een
-- teruggedraaide proef gedraaid waarin de tariefpoort nog weigerde [23514], de bedragbewaker nog
-- weigerde, en een terechte creditregel en een gewone factuurregel gewoon door mochten.

REVOKE ALL ON FUNCTION public.assert_credit_within_rate()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_verwerkt_invoice_changes()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_accountant_amount_changes()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_paid_when_verwerkt()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_bookkeeping_date_sane()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoices_search_vector_update()      FROM PUBLIC, anon, authenticated;
