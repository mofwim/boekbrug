-- [SUPPLIER-ALIAS] "When a paper reads like THIS, it is that supplier."
--
-- The owner corrects the leverancier on an invoice — "Ozer food bv" becomes "Oz&er food" — and
-- until now that word went onto that one invoice row and nowhere else. Next month the same shop
-- sends the same paper, the reader makes the same mistake, and the owner corrects it again.
--
-- Renaming the suppliers row does not fix that, and this is the part that is easy to get wrong:
-- the NEXT invoice does not carry the corrected name. It carries what is printed, read by the same
-- reader that got it wrong. So what has to be stored is the LINK between the two spellings, keyed
-- on the one that will actually come back.
--
-- WHY IT MATTERS BEYOND A LABEL
-- invoices.client_name is not a display string in this app; it is the identity key four systems
-- use through supplierNameKey(): the IBAN-change check (the only thing between the owner and a
-- redirected payment), the incasso mandate, the creditnota signal, and the reading memory. A
-- corrected name that never reaches the registry silently moves the invoice out of its supplier's
-- history — and the fraud check then answers "no IBAN on record", which reads as a clean invoice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.supplier_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The normalized key of the spelling that appears ON THE PAPER (supplierNameKey of the name the
  -- reader produced). This is the lookup side: it is what next month's invoice will carry.
  alias_key text NOT NULL,
  -- Who it really is. ON DELETE CASCADE: an alias to a supplier that no longer exists is not a
  -- fact worth keeping, and a dangling one would resolve imports to nothing.
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  -- The spelling as it stood, unnormalized — so the owner can be shown what they taught the app,
  -- and so a wrong lesson can be recognised and removed by a human rather than by a key.
  printed_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_aliases_key_not_empty CHECK (length(btrim(alias_key)) > 0)
);

-- One meaning per spelling per owner. Without this a second correction of the same misread would
-- add a second row, and the import would resolve to whichever came back first — a supplier that
-- changes between imports for no visible reason.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_aliases_unique_key
  ON public.supplier_aliases (user_id, alias_key);
CREATE INDEX IF NOT EXISTS idx_supplier_aliases_supplier
  ON public.supplier_aliases (supplier_id);

ALTER TABLE public.supplier_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_aliases_select_own ON public.supplier_aliases;
CREATE POLICY supplier_aliases_select_own ON public.supplier_aliases
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS supplier_aliases_insert_own ON public.supplier_aliases;
CREATE POLICY supplier_aliases_insert_own ON public.supplier_aliases
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS supplier_aliases_update_own ON public.supplier_aliases;
CREATE POLICY supplier_aliases_update_own ON public.supplier_aliases
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS supplier_aliases_delete_own ON public.supplier_aliases;
CREATE POLICY supplier_aliases_delete_own ON public.supplier_aliases
  FOR DELETE TO authenticated USING (user_id = auth.uid());

COMMENT ON TABLE public.supplier_aliases IS
  '[SUPPLIER-ALIAS] Spelling-on-the-paper → the supplier it means, per owner. Written when the owner corrects a leverancier name; read by resolveSupplierForImport BEFORE it creates a new supplier, so the same misread stops producing a new island every month. Keyed on the PRINTED name because that is what the next invoice carries — the corrected one never appears on paper. See src/lib/supplier-alias.ts.';

COMMIT;
