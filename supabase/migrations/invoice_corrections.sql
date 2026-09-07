-- [VOORSTEL] De boekhouder stelt een correctie voor; de klant beslist.
-- BoekBrug · september 2026
--
-- WAAROM
-- De bedragenbeveiliging (accountant_amount_guard) houdt een boekhouder weg van het geld op de
-- factuur van zijn klant, en terecht: art. 52 AWR laat de administratie bij de ondernemer. Maar de
-- boekhouder is degene die de verkeerde btw-splitsing ZIET, en zijn enige middel was een vraag in
-- vrije tekst die op WhatsApp eindigde.
--
-- WAT DIT WEL IS
-- Eén rij per voorstel: welke velden, wat ze waren (before) en wat ze zouden moeten worden
-- (proposed), waarom, en wat de klant ervan vond. Akkoord past de app toe via de eigen
-- correctiedeur van de KLANT (/api/invoice/[id]/amounts, in zijn sessie) — dezelfde controles,
-- dezelfde beveiliging, hetzelfde spoor als wanneer hij het zelf had ingetypt.
--
-- WAT DIT NADRUKKELIJK NIET IS
-- Geen schrijfrecht voor de boekhouder op invoices. Deze tabel verandert geen factuur; alleen de
-- klant doet dat, met één tik, en de rij bewaart dat hij het deed.
--
-- APPLY: draaien in de Supabase SQL editor. Verwijdert niets. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.invoice_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accountant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  -- The five proposable fields as they were when the proposal was written, and as proposed.
  before jsonb NOT NULL,
  proposed jsonb NOT NULL,
  -- The fields that actually differ, as [{field, from, to}] — what the client's card shows.
  changes jsonb NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT invoice_corrections_status_check CHECK (status IN ('open', 'accepted', 'declined', 'stale'))
);

-- One OPEN proposal per invoice: two open proposals on one invoice is two accountants disagreeing
-- in the client's face, and the second one should first see the first.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_corrections_open_uidx
  ON public.invoice_corrections (invoice_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS invoice_corrections_client_idx
  ON public.invoice_corrections (client_id, status);
CREATE INDEX IF NOT EXISTS invoice_corrections_accountant_idx
  ON public.invoice_corrections (accountant_id, created_at DESC);

ALTER TABLE public.invoice_corrections ENABLE ROW LEVEL SECURITY;

-- The accountant reads their own proposals; the client reads the ones about them. Nobody writes
-- through RLS: both routes write with the service role after their own checks (linkage, ownership,
-- status), so a proposal can neither be planted on an unlinked client nor decided by its author.
DROP POLICY IF EXISTS invoice_corrections_accountant_read ON public.invoice_corrections;
CREATE POLICY invoice_corrections_accountant_read ON public.invoice_corrections
  FOR SELECT TO authenticated USING (accountant_id = (select auth.uid()));
DROP POLICY IF EXISTS invoice_corrections_client_read ON public.invoice_corrections;
CREATE POLICY invoice_corrections_client_read ON public.invoice_corrections
  FOR SELECT TO authenticated USING (client_id = (select auth.uid()));

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'invoice_corrections';   → true
-- SELECT COUNT(*) FROM pg_policies WHERE tablename = 'invoice_corrections';             → 2
