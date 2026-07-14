-- [KLANTEN] Deepen the customer registry into the mini-CRM backbone (gateway #2). The
-- registry is "the data root the other four gateways reference" — so the link from an
-- invoice to its customer must be ROBUST, not a fragile name string.
--
-- Today invoices store only client_name (a denormalized snapshot). The invoice form already
-- tracks the selected client's id but never saved it. This adds the real link so a
-- customer's history is stable across renames and duplicate names — the accumulation that
-- makes leaving mean re-entering every customer.
--
-- Non-breaking: NULLABLE column + ON DELETE SET NULL (deleting a client never deletes or
-- orphans an invoice — the client_name snapshot on the invoice preserves history). Legacy
-- invoices keep client_id NULL and are matched by name as a fallback in the app.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_client_id
  ON public.invoices (client_id) WHERE client_id IS NOT NULL;

-- A free-text CRM note per customer (the "deepen it" touch — context the owner keeps).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS notes text;
