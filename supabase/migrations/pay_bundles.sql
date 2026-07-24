-- [BUNDEL-BETAALVERZOEK] One payment request for SEVERAL open invoices of the
-- same customer. A klant with three open facturen should not need three
-- transfers — the owner selects the invoices, BoekBrug mints ONE public pay
-- link (one QR, one amount = the sum of the open bedragen, all invoice numbers
-- in the payment reference), and the customer settles everything in a single
-- transfer.
--
-- The loop stays closed by the EXISTING machinery: the combined reference
-- carries every invoice number, bank-matching finds each number in the incoming
-- bank line, and book_bank_batch already books ONE transaction against SEVERAL
-- invoices (bank_tx_invoices records every pair). Nothing here moves money —
-- exactly like the single betaalverzoek, the customer pays from their own bank.
--
-- Model mirrors invoices.pay_token (betaalverzoek.sql): an unguessable uuid
-- token, resolved by a service-role API that returns a minimal projection.
-- The bundle tables themselves stay RLS-protected against anon.

CREATE TABLE IF NOT EXISTS public.pay_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now()
);

-- One token ↔ one bundle (the public /pay/[token] handle).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_bundles_token ON public.pay_bundles (token);
CREATE INDEX IF NOT EXISTS idx_pay_bundles_user ON public.pay_bundles (user_id);

-- The invoices a bundle covers. ON DELETE CASCADE on both FKs: deleting the
-- bundle or an invoice removes the link (a bundle that loses an invoice simply
-- renders without it; the public view recomputes the remaining sum live).
CREATE TABLE IF NOT EXISTS public.pay_bundle_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bundle_id uuid NOT NULL REFERENCES public.pay_bundles(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pay_bundle_invoices_unique_pair
  ON public.pay_bundle_invoices (bundle_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_bundle_invoices_bundle ON public.pay_bundle_invoices (bundle_id);
CREATE INDEX IF NOT EXISTS idx_pay_bundle_invoices_invoice ON public.pay_bundle_invoices (invoice_id);

ALTER TABLE public.pay_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_bundle_invoices ENABLE ROW LEVEL SECURITY;

-- Owner-only access for the authenticated app (create / list / revoke). The
-- anonymous customer NEVER reads these tables directly — only via the
-- service-role /api/pay/[token] projection.
DROP POLICY IF EXISTS pay_bundles_select_own ON public.pay_bundles;
CREATE POLICY pay_bundles_select_own ON public.pay_bundles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS pay_bundles_insert_own ON public.pay_bundles;
CREATE POLICY pay_bundles_insert_own ON public.pay_bundles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS pay_bundles_delete_own ON public.pay_bundles;
CREATE POLICY pay_bundles_delete_own ON public.pay_bundles
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS pay_bundle_invoices_select_own ON public.pay_bundle_invoices;
CREATE POLICY pay_bundle_invoices_select_own ON public.pay_bundle_invoices
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS pay_bundle_invoices_insert_own ON public.pay_bundle_invoices;
CREATE POLICY pay_bundle_invoices_insert_own ON public.pay_bundle_invoices
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS pay_bundle_invoices_delete_own ON public.pay_bundle_invoices;
CREATE POLICY pay_bundle_invoices_delete_own ON public.pay_bundle_invoices
  FOR DELETE TO authenticated USING (user_id = auth.uid());
