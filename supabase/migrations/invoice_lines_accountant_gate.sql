-- =====================================================================
-- [BRUG] De factuurregels gelijktrekken met de factuurkop.
-- BoekBrug · juli 2026
-- =====================================================================
-- Eén factuur, twee grenzen — en de regels stonden strenger dan de kop.
--
-- De KOP (invoices) is voor de boekhouder zichtbaar volgens de gegenereerde kolom
-- `shared` (status IN verstuurd/ontvangen/betaald), in BEIDE richtingen.
--
-- De REGELS (invoice_lines) stonden op:
--     i.status = 'paid' AND ac.zzper_id = i.sender_id
--
-- Twee keer strenger dus: alleen BETAALDE facturen, en alleen UITGAANDE. Gevolg voor de
-- boekhouder:
--   · een verstuurde verkoopfactuur van EUR 12.000 toont een LEGE regelset — de kop staat er,
--     de inhoud niet, en niets legt uit waarom;
--   · van een inkoopfactuur ziet hij nooit één regel, in geen enkele status.
--
-- Vandaag valt dat nog niet op omdat geen scherm de regels rendert. Dat is precies waarom
-- het nu gerepareerd moet worden: het is een stille grens die elke volgende functie
-- (regelniveau-export, een boekingsvoorstel, controle van het btw-tarief per regel) zou
-- laten stuklopen op een lege array in plaats van op een foutmelding.
--
-- De regel wordt: exact dezelfde als de kop. Ziet hij de factuur, dan ziet hij haar regels.
-- Niets ruimer — `shared` blijft de grens, dus concepten en ongecontroleerde inkoopfacturen
-- blijven onzichtbaar (AV §7.3).
--
-- TOEPASSEN: Supabase SQL-editor. Verwijdert niets. Idempotent.
-- =====================================================================

BEGIN;

DROP POLICY IF EXISTS invoice_lines_select_accountant ON public.invoice_lines;

CREATE POLICY invoice_lines_select_accountant ON public.invoice_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        -- Dezelfde grens als de kop: de gegenereerde kolom, niet een losse statuslijst.
        -- Zo kan deze policy niet uit de pas lopen als de statusset ooit verandert.
        AND i.shared = true
        AND (
          public.is_my_accountant_client(i.sender_id)
          OR public.is_my_accountant_client(i.receiver_id)
        )
    )
  );

COMMENT ON POLICY invoice_lines_select_accountant ON public.invoice_lines IS
  '[BRUG] Gelijk aan de zichtbaarheid van de factuurkop: shared = true, beide richtingen. De vorige versie eiste status=paid EN uitgaand, waardoor een verstuurde factuur een lege regelset toonde.';

COMMIT;

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen)
--
-- Leest de catalogus, dus werkt gewoon in de Supabase SQL-editor (service_role).
--
--   select policyname,
--          qual ilike '%shared%' as gebruikt_shared,
--          qual ilike '%paid%'   as gebruikt_nog_paid
--     from pg_policies
--    where schemaname = 'public'
--      and tablename  = 'invoice_lines'
--      and policyname = 'invoice_lines_select_accountant';
--
--   VOORAF : gebruikt_shared = false, gebruikt_nog_paid = true   ← de te strenge grens
--   ACHTERAF: gebruikt_shared = true,  gebruikt_nog_paid = false
-- =====================================================================
