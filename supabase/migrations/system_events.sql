-- =====================================================================
-- [STORINGSBEELD] system_events — wat er de laatste dagen misging, zonder één klantgegeven
-- BoekBrug · augustus 2026
-- =====================================================================
-- WAAROM: reportHandledFailure() meldt elke afgevangen storing aan Sentry en aan de serverlog.
-- Allebei buiten de app: je moet ergens anders inloggen om te zien of er iets aan de hand is, en
-- daarom kijkt niemand. De beheerder had geen enkele plek waar hij "wat gaat er de laatste week mis"
-- kon aflezen.
--
-- ── WAT HIER MET OPZET NIET IN STAAT ──
-- Geen message. Geen context. Geen user_id, geen bedrag, geen factuurnummer, geen leveranciersnaam.
--
-- Dat is geen voorzichtigheid maar de ENIGE veilige vorm. Een storingslogboek met vrije tekst is
-- een achterdeur naar de boeken van élke klant: de context die een ontwikkelaar handig vindt
-- ("invoiceId, bedrag, leverancier") is exact de inhoud die dit product belooft nooit op één hoop
-- te leggen. Een schrubber ernaast helpt niet — die moet je vertrouwen, en één onoplettende
-- toevoeging is genoeg.
--
-- Drie kolommen kunnen niets lekken. De vraag die deze tabel beantwoordt — "welke storing, hoe
-- vaak, wanneer voor het laatst" — heeft de tekst ook niet nodig. Wie de zin wil, leest de
-- serverlog of Sentry; daar hoort hij, met de toegang die daarbij past.
--
-- ── GEEN ENKELE POLICY ──
-- RLS staat aan en er is GEEN policy. Dat betekent: geen sessie ter wereld kan deze tabel lezen of
-- schrijven. Alleen service_role komt erbij — de schrijver (reportHandledFailure) en de
-- beheerpagina, die daar pas na de isBeheerder-poort aankomt. Toegang is dus code, niet beleid, en
-- er is geen policy die per ongeluk te ruim kan worden gezet.
--
-- Veilig om meer dan één keer te draaien.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.system_events (
  id       bigserial PRIMARY KEY,
  -- De marker uit de logregel: 'PARTIAL-PAY', 'CASH-SETTLE', 'MOLLIE'. Een gesloten vocabulaire dat
  -- de codebase zelf al voert, en dat precies genoeg zegt om te weten wélke storing dit is.
  tag      text NOT NULL,
  -- 'gate-unavailable' | 'data-integrity' | … — zie report-handled.ts. Vrij gelaten in het schema:
  -- een CHECK hier zou betekenen dat een nieuwe ernstgraad de MELDING laat falen, en een logboek
  -- mag nooit de oorzaak van een tweede storing zijn.
  severity text NOT NULL,
  at       timestamptz NOT NULL DEFAULT now()
);

-- De enige vraag die deze tabel krijgt: "wat ging er de laatste dagen mis?"
CREATE INDEX IF NOT EXISTS system_events_at_idx ON public.system_events (at DESC);

ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;
-- Zie de kop: bewust GEEN policy. Geen sessie komt erbij; alleen service_role, achter de poort.

COMMENT ON TABLE public.system_events IS
  '[STORINGSBEELD] Afgevangen storingen als tag + ernst + tijd. Met opzet ZONDER message en ZONDER context: drie kolommen kunnen geen klantgegeven lekken, en de vraag "welke storing, hoe vaak, wanneer" heeft de tekst niet nodig. De zin staat in de serverlog en in Sentry.';

-- ── CONTROLE ─────────────────────────────────────────────────────────
--   SELECT 'tabel' AS wat,
--          EXISTS (SELECT 1 FROM information_schema.tables
--                   WHERE table_schema='public' AND table_name='system_events') AS ok
--   UNION ALL
--   SELECT 'geen vrije tekst',
--          NOT EXISTS (SELECT 1 FROM information_schema.columns
--                       WHERE table_schema='public' AND table_name='system_events'
--                         AND column_name IN ('message','context','detail','user_id','payload'))
--   UNION ALL
--   SELECT 'geen enkele policy',
--          NOT EXISTS (SELECT 1 FROM pg_policies
--                       WHERE schemaname='public' AND tablename='system_events');
-- =====================================================================
