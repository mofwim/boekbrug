-- [NEGEER-REDEN] Waarom is deze inkoopfactuur genegeerd, en wanneer?
--
-- Het tabblad Genegeerd was een lijst zonder geheugen: een bedrag, geen woord waarom het daar
-- stond. Bij de kwartaalafsluiting — of als de leverancier belt — moest de eigenaar de hele
-- afweging opnieuw maken, met minder informatie dan toen hij hem maakte.
--
-- Twee kolommen, allebei NULLABLE en zonder enige invloed op geld:
--
--   archive_reason  — 'dubbel' | 'niet_van_mij' | 'geen_factuur' | 'anders'  (zie
--                     src/lib/archive-reason.ts; die lijst is de bron, deze CHECK bewaakt hem)
--   archived_at     — wanneer er genegeerd werd. updated_at verandert bij ELKE wijziging en is
--                     dus geen antwoord op "wanneer heb ik dit weggezet"; deze kolom wel. Nodig
--                     voor de afzenderregel-suggestie ("drie keer genegeerd in de laatste
--                     negentig dagen"), die anders op een tijdstempel zou moeten leunen dat
--                     ondertussen door een heel andere handeling is opgeschoven.
--
-- Bewust GEEN NOT NULL en geen default: elke bestaande genegeerde factuur houdt NULL, en dat is
-- de eerlijke waarde — we weten het niet meer. Het scherm toont dan simpelweg geen label.
--
-- Bewust GEEN invloed op de status-machine: archiveren blijft archiveren, terugzetten blijft
-- werken, en geen enkele financiële query kijkt naar deze kolommen. Het is een notitie.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- De toegestane waarden — één plek waar de lijst hard staat, zodat een geknutselde client geen
-- vrije tekst in deze kolom kan schrijven. NULL blijft altijd toegestaan (oude rijen, en de
-- eigenaar die de vraag overslaat).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_archive_reason_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_archive_reason_check
      CHECK (archive_reason IS NULL OR archive_reason IN ('dubbel', 'niet_van_mij', 'geen_factuur', 'anders'));
  END IF;
END $$;

-- De index die de afzenderregel-suggestie draagt: "hoe vaak heeft deze gebruiker recent iets
-- genegeerd?" Partieel, want alleen genegeerde rijen zijn hier interessant — dat houdt de index
-- klein op een tabel waarvan de overgrote meerderheid nooit gearchiveerd wordt.
CREATE INDEX IF NOT EXISTS idx_invoices_archived_reason
  ON public.invoices (receiver_id, archived_at DESC)
  WHERE status = 'archived' AND direction = 'incoming';

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Beide kolommen bestaan, de CHECK staat er, en de index staat er. Alles moet true zijn.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'archive_reason')
    AS heeft_archive_reason,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'archived_at')
    AS heeft_archived_at,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_archive_reason_check')
    AS heeft_check,
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'idx_invoices_archived_reason')
    AS heeft_index;
