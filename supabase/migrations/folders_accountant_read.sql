-- folders_accountant_read.sql
-- [MAPPEN] De boekhouder mag de MAPNAMEN van zijn klant lezen. Zonder dit is zijn hele
-- documententabblad één platte hoop.
--
-- HET GAT, VAN BEGIN TOT EIND
--   1. /dashboard/brug haalt invoices + documents + folders op met de SESSIE-client.
--   2. Op `folders` staan vier policies, en alle vier zijn _own: select/insert/update/delete op
--      user_id = auth.uid(). Er is er geen voor de boekhouder.
--   3. Dus krijgt hij nul mappen terug, en bouwt buildBridgeTree() zijn folderMap uit een lege
--      lijst.
--   4. folderPath() vindt vervolgens niets voor doc.folder_id, geeft een leeg pad terug, en de
--      vangnetregel eronder doet de rest:
--          const finalBase = path.length > 0 ? path : [NODE.overig]
--
-- Uitkomst: ELK document van ELKE klant belandt in Klanten/<naam>/Overig. De ordening die de
-- ondernemer zelf heeft aangebracht — precies het werk waar hij zijn boekhouder mee wil helpen —
-- is aan de andere kant onzichtbaar. Er brak niets, er stond geen fout op het scherm, en dat is
-- waarom het zo lang kon blijven staan.
--
-- WAAROM DIT VEILIG IS
-- Een map is een NAAM en een ouder. Geen bedrag, geen bestand, geen persoonsgegeven van een derde.
-- Het lezen ervan geeft de boekhouder niets wat hij niet al mag zien — documents_accountant_read
-- geeft hem de bestanden zelf al — het geeft hem alleen de VOLGORDE terug waarin ze stonden.
--
-- WAAROM HET GEEN `shared`-hek heeft, en documents wel
-- documents_accountant_read eist `shared = true`, want een bestand is inhoud: de ondernemer
-- bepaalt per stuk wat hij deelt. Een map is dat niet; hij is de rubriek waaronder gedeelde
-- bestanden hangen. Zou de mapstructuur ook per stuk gedeeld moeten worden, dan zou een gedeeld
-- bestand in een niet-gedeelde map alsnog in Overig vallen — hetzelfde gat, alleen kleiner. De
-- koppeling is hier dus de grens, net als bij accountant_clients zelf.
--
-- ALLEEN SELECT. Een boekhouder mag de indeling van zijn klant LEZEN, nooit veranderen: mappen
-- verplaatsen in andermans administratie is iets wat je niet ongemerkt terugdraait.

DROP POLICY IF EXISTS folders_accountant_read ON public.folders;
CREATE POLICY folders_accountant_read ON public.folders
  FOR SELECT TO authenticated
  USING (public.is_my_accountant_client(user_id));

COMMENT ON POLICY folders_accountant_read ON public.folders IS
  '[MAPPEN] Een gekoppelde boekhouder leest de mapnamen van zijn klant, zodat buildBridgeTree() de documenten in hun eigen structuur kan tonen in plaats van allemaal in Overig. Alleen SELECT — de indeling blijft van de ondernemer.';

-- =====================================================================
-- CONTROLE — draai dit blok NA de migratie.
-- =====================================================================
-- 1) Staat de policy er, naast de vier bestaande?
--    SELECT policyname, cmd FROM pg_policies
--     WHERE schemaname='public' AND tablename='folders' ORDER BY 1;
--    Verwacht: folders_accountant_read (SELECT) + de vier _own-policies.
--
-- 2) Het echte bewijs staat op het scherm, niet in deze query: log in als boekhouder, open
--    /dashboard/brug en kijk of de mappen van een klant hun eigen namen dragen. Stond alles
--    daarvóór in Klanten/<naam>/Overig en nu niet meer, dan deed deze regel wat hij moest doen.
