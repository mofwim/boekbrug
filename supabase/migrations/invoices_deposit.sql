-- [AANBETALING] A deposit invoice on an offerte.
--
-- Bouw and installatie bill part of an accepted offerte up front. The deposit is an ordinary
-- factuur (a number, its own btw — Art. 35, factuurstelsel), so nothing changes on the aangifte
-- side; what the app must remember is WHICH offerte it is a deposit on, so the final invoice
-- from that offerte settles it with a credit line instead of billing the whole amount again.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS deposit_on_offerte_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_deposit_on_offerte_idx ON public.invoices(deposit_on_offerte_id) WHERE deposit_on_offerte_id IS NOT NULL;
COMMENT ON COLUMN public.invoices.deposit_on_offerte_id IS
  '[AANBETALING] Set on a deposit invoice: the offerte it is a deposit on. The final invoice from that offerte settles every issued deposit with a credit line.';
