-- [AANSLAG] Een brief van de Belastingdienst is nooit een kost.
-- BoekBrug · september 2026
--
-- WAAROM
-- Een voorlopige aanslag inkomstenbelasting, een Zvw-aanslag, een btw-naheffing of een brief
-- motorrijtuigenbelasting heeft alles wat de lezer in een factuur zoekt: een afzender, een
-- bedrag, een IBAN, een betaalkenmerk en een vervaldatum. Gefotografeerd en bevestigd landde zo'n
-- brief in de kosten van het jaar — het resultaat was dan fout met precies de eigen
-- inkomstenbelasting van de ondernemer. Gemeten op de levende administratie: nog geen enkele rij,
-- dus nog niets fout. Het is één upload verwijderd.
--
-- WAT DIT WEL IS
-- Eén kolom op invoices: de SOORT belasting die de brief noemt. De rekenregel staat in
-- src/lib/tax-letter.ts: inkomstenbelasting en Zvw zijn privé, omzetbelasting is een afdracht,
-- alleen motorrijtuigenbelasting is een kost. Een brief zonder soort van een afzender die
-- "Belastingdienst" heet, wordt ingehouden uit de kosten en genoemd.
--
-- WAT DIT NADRUKKELIJK NIET IS
-- Geen nieuwe status, geen aparte tabel: de brief blijft een te betalen post, dus de vervaldatum
-- bereikt het betaalscherm en de vooruitblik, en de bankregel die hem betaalt koppelt als altijd.
--
-- SCHIPT DONKER
-- NULL op elke bestaande rij: niets verandert tot de lezer of de eigenaar een soort noemt.
--
-- APPLY: draaien in de Supabase SQL editor. Verwijdert niets. Idempotent.

BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tax_kind text;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_tax_kind_known;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_tax_kind_known CHECK (
    tax_kind IS NULL OR tax_kind IN (
      'inkomstenbelasting', 'zorgverzekeringswet', 'omzetbelasting', 'motorrijtuigenbelasting', 'overig'
    )
  );

COMMENT ON COLUMN public.invoices.tax_kind IS
  '[AANSLAG] Which tax a Belastingdienst letter concerns. NULL for an ordinary invoice. See src/lib/tax-letter.ts.';

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- Verwacht: 1 rij, data_type = text; 1 constraint.
--
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'tax_kind';
-- SELECT conname FROM pg_constraint WHERE conname = 'invoices_tax_kind_known';
