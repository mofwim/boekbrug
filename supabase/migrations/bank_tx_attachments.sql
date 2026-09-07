-- [BIJLAGE-BIJ-REGEL] Een bestand bij een bankregel — zonder er een factuur van te maken.
-- BoekBrug · september 2026
--
-- WAAROM
-- De enige "upload" op /bank was attach-invoice: die leest het bestand als factuur, maakt er een
-- betaalde inkoop- of verkoopfactuur van en hangt de regel eraan. Wat de ondernemer óók heeft is
-- een bon, een betaalbewijs van een klant, een brief bij een storno, een screenshot van de
-- betaalapp — bewijs BIJ een regel dat geen factuur is, en dat hij later terug wil vinden vanaf
-- diezelfde regel. Daar bestond geen plek voor. Nu wel: een koppeltabel tussen de bankregel en
-- een documents-rij, meerdere per regel, verwijderd met de regel of met het document.
--
-- WAT HET NIET IS
-- Geen boeking. Een bijlage verandert niets aan categorie, factuur, bedrag of status van de regel.
--
-- RLS: de eigenaar leest zijn eigen bijlagen; schrijven gebeurt door de routes met de service role
-- na de eigen controles (eigenaarschap van regel én document).
--
-- APPLY: draaien in de Supabase SQL editor. Verwijdert niets. Idempotent.

CREATE TABLE IF NOT EXISTS public.bank_tx_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_tx_attachments_unique UNIQUE (transaction_id, document_id)
);
CREATE INDEX IF NOT EXISTS bank_tx_attachments_tx_idx ON public.bank_tx_attachments (transaction_id);
CREATE INDEX IF NOT EXISTS bank_tx_attachments_user_idx ON public.bank_tx_attachments (user_id, created_at DESC);

ALTER TABLE public.bank_tx_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_tx_attachments_owner_read ON public.bank_tx_attachments;
CREATE POLICY bank_tx_attachments_owner_read ON public.bank_tx_attachments
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'bank_tx_attachments';   → true
-- SELECT COUNT(*) FROM pg_policies WHERE tablename = 'bank_tx_attachments';             → 1
