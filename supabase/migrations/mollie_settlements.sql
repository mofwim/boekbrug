-- [MOLLIE-AFREKENING] Wat een Mollie-uitbetaling IS: de betalingen, de kosten, de bankregel.
-- BoekBrug · september 2026
--
-- WAAROM
-- Een Mollie-uitbetaling is een gesaldeerde afrekening: de betalingen die Mollie voor de
-- ondernemer inde, minus Mollie's eigen kosten (21% btw), in één bankbijschrijving. De
-- betalingen stonden al in de boeken (de webhook zet de factuur op betaald), de KOSTEN nergens
-- (Mollie's maandfactuur las geen enkel pad), en de bankregel bleef ongecodeerd omdat geen
-- factuur erop paste ([MOLLIE-UITBETALING]). De Settlements API zegt alle drie, per afrekening,
-- op de cent.
--
-- WAT DIT WEL IS
-- Eén rij per verwerkte afrekening: de bedragen zoals Mollie ze meldde, de kostenfactuur die
-- ervan gemaakt is, de bankregel die eraan gekoppeld is, en de reden als er NIET geboekt werd.
-- Plus één kolom op mollie_payment_links: het betaling-id (tr_…) waarmee een link van ons aan
-- een betaling in een afrekening te knopen is.
--
-- WAT DIT NADRUKKELIJK NIET IS
-- Geen omzetboeking. Een betaling die niet bij een BoekBrug-factuur hoort (de eigen webshop)
-- wordt GENOEMD in unlinked_gross en door de eigenaar geboekt — nooit geraden.
--
-- SCHIPT DONKER
-- Zonder Mollie-koppeling gebeurt er niets; de cron leest alleen actieve koppelingen.
--
-- APPLY: draaien in de Supabase SQL editor. Verwijdert niets. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mollie_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Mollie's settlement id (stl_…) and the bank reference printed on the transfer.
  settlement_id text NOT NULL,
  reference text,
  settled_on date,
  -- Cents-exact figures as Mollie reported them, in euros.
  revenue_gross numeric(12,2),
  costs_net numeric(12,2),
  costs_vat numeric(12,2),
  costs_gross numeric(12,2),
  payout numeric(12,2),
  -- The split of the settlement's payments: ours (a BoekBrug invoice) and not ours.
  linked_gross numeric(12,2),
  unlinked_gross numeric(12,2),
  unlinked_count integer,
  -- What was booked from it, when it was.
  fee_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  payout_tx_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  -- 'booked' | 'held' (payments not ours, a refund/chargeback inside, the payout line not found or
  -- not coded, or the fee not yet settled — see mollie_settlements_fee_paid.sql) | 'refused' (did not reconcile)
  status text NOT NULL DEFAULT 'held',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mollie_settlements_user_settlement_uidx UNIQUE (user_id, settlement_id),
  CONSTRAINT mollie_settlements_status_check CHECK (status IN ('booked', 'held', 'refused'))
);

CREATE INDEX IF NOT EXISTS mollie_settlements_user_settled_idx
  ON public.mollie_settlements (user_id, settled_on DESC);

ALTER TABLE public.mollie_settlements ENABLE ROW LEVEL SECURITY;
-- The owner may READ what was booked on their behalf; writing is the cron's (service_role).
DROP POLICY IF EXISTS mollie_settlements_select_own ON public.mollie_settlements;
CREATE POLICY mollie_settlements_select_own ON public.mollie_settlements
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

-- The Mollie payment (tr_…) behind a paid link, learned from the Payment Links API.
ALTER TABLE public.mollie_payment_links ADD COLUMN IF NOT EXISTS payment_id text;
CREATE INDEX IF NOT EXISTS mollie_payment_links_payment_idx
  ON public.mollie_payment_links (payment_id) WHERE payment_id IS NOT NULL;

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'mollie_settlements';  → true
-- SELECT COUNT(*) FROM pg_policies WHERE tablename = 'mollie_settlements';           → 1
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'mollie_payment_links' AND column_name = 'payment_id';          → 1 rij
