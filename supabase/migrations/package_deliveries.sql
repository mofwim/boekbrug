-- =====================================================================
-- [PAKKET-AFDRUK] package_deliveries — WAT er is overhandigd, niet alleen DAT
-- BoekBrug · augustus 2026
-- =====================================================================
-- WAAROM: package_shares legt de handeling vast — naar wie de link ging, wanneer, hoe vaak hij is
-- opgehaald. Wat eruit KWAM legt niets vast, en de zip wordt bij elke download opnieuw gebouwd uit
-- de huidige tabellen ("Alles komt uit de RIJ. Geen URL-parameter raakt de inhoud"). Dus:
--
--   april  — de boekhouder haalt het pakket op: 47 facturen, € 12.400 aan kosten;
--   mei    — een late inkoopfactuur wordt bevestigd;
--   juni   — hij haalt DEZELFDE link nog eens op: 48 facturen, € 12.454,02.
--
-- Zelfde token, zelfde URL, ander pakket. En "waarom veranderde deze post van € 12.400 naar
-- € 12.454,02?" heeft dan geen antwoord dat verder komt dan "omdat de gegevens zijn veranderd".
--
-- WAAROM btw_filings DIT NIET DEKT: dat bevriest het KWARTAAL bij het INDIENEN, en meet de
-- divergentie daarna. Uitstekend, en een andere gebeurtenis. De boekhouder werkt uit het PAKKET,
-- vóór de aangifte. Beweegt het pakket tussen zijn lezing en zijn indiening, dan bestaat de
-- startwaarde waartegen btw_filings straks rekent niet meer.
--
-- DE VORM IS GELEEND VAN btw_filings, niet uitgevonden: een afdruk die NOOIT wordt herschreven, en
-- een vergelijking tegen de vorige. Eén rij per DOWNLOAD, want de boekhouder handelt naar wat hij
-- heeft opgehaald — niet naar wat er stond toen de link werd gemaakt.
--
-- Veilig om meer dan één keer te draaien.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.package_deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id     uuid NOT NULL REFERENCES public.package_shares(id) ON DELETE CASCADE,
  -- Meegeschreven, niet afgeleid: de eigenaar moet zijn eigen afdrukken kunnen lezen ook nadat de
  -- deel-link is ingetrokken, en een JOIN over een verwijderde rij levert dat niet.
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year         int  NOT NULL,
  quarter      int  NOT NULL CHECK (quarter BETWEEN 1 AND 4),

  delivered_at timestamptz NOT NULL DEFAULT now(),

  -- De afdruk van de INHOUD. Geen cryptografisch zegel — de rij staat in dezelfde database als de
  -- data — maar een gelijkheidssleutel, en een leesbare: hij wordt vergeleken, nooit geparsed.
  -- generatedAt zit er met opzet NIET in: dat verschilt bij elke download en zou elk pakket als
  -- "veranderd" aanmerken, wat hetzelfde is als niets zeggen.
  fingerprint  text NOT NULL,

  -- De telling zelf, zodat een verschil in mensentaal te noemen is ("2 inkoopfacturen erbij") en
  -- niet alleen als "de afdruk wijkt af".
  outgoing_count      int  NOT NULL,
  incoming_count      int  NOT NULL,
  files_included      int  NOT NULL,
  invoices_with_pdf   int  NOT NULL,
  bank_statement_included boolean NOT NULL,
  -- De namen en de codes: een telling die gelijk blijft terwijl de NAMEN verschillen betekent dat
  -- de ene bon binnenkwam en de andere wegviel — twee gebeurtenissen die elkaar in het getal
  -- opheffen en allebei het melden waard zijn.
  missing_evidence    text[] NOT NULL DEFAULT '{}',
  warning_codes       text[] NOT NULL DEFAULT '{}'
);

-- De vraag die deze tabel elke keer krijgt: "wat was de VORIGE aflevering van dit kwartaal?".
CREATE INDEX IF NOT EXISTS package_deliveries_quarter_idx
  ON public.package_deliveries (user_id, year, quarter, delivered_at DESC);

ALTER TABLE public.package_deliveries ENABLE ROW LEVEL SECURITY;

-- De eigenaar leest zijn eigen afdrukken. Verder niemand — en er is met opzet GEEN update- of
-- delete-policy: een afdruk die herschreven kan worden bewijst niets. Het schrijven gebeurt op de
-- publieke downloadroute, die op service_role draait en de rij op het TOKEN vindt ([RLS-UIT],
-- dezelfde reden als package_shares: "het token is de credential").
DROP POLICY IF EXISTS package_deliveries_select_own ON public.package_deliveries;
CREATE POLICY package_deliveries_select_own ON public.package_deliveries
  FOR SELECT USING (auth.uid() = user_id);

COMMENT ON TABLE public.package_deliveries IS
  '[PAKKET-AFDRUK] Eén rij per DOWNLOAD van een kwartaalpakket: de afdruk van wat er is overhandigd. Nooit herschreven — zo is achteraf te zien dat dezelfde link in juni iets anders gaf dan in april, en wat.';

-- ── CONTROLE ─────────────────────────────────────────────────────────
-- Draai dit na het toepassen; alle drie moeten 'true' teruggeven.
--
--   SELECT 'tabel' AS wat,
--          EXISTS (SELECT 1 FROM information_schema.tables
--                   WHERE table_schema='public' AND table_name='package_deliveries') AS ok
--   UNION ALL
--   SELECT 'index',
--          EXISTS (SELECT 1 FROM pg_indexes
--                   WHERE schemaname='public' AND indexname='package_deliveries_quarter_idx')
--   UNION ALL
--   SELECT 'geen update-policy',
--          NOT EXISTS (SELECT 1 FROM pg_policies
--                       WHERE schemaname='public' AND tablename='package_deliveries'
--                         AND cmd IN ('UPDATE','DELETE'));
-- =====================================================================
