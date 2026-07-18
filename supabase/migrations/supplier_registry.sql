-- [SUPPLIER-REGISTRY] A canonical supplier (leverancier) entity for INCOMING invoices.
--
-- Problem this fixes: incoming supplier invoices stored only a free-text snapshot in
-- invoices.client_name — whatever name the AI happened to read off that particular PDF.
-- The same company therefore appeared under many spellings ("Silifke / Hocaoglu",
-- "Hocaoglu", "M.H. BAL GROOTHANDEL VOF" …), with no way to see one supplier's history
-- and no reliable key. The customer side already got this fix (crm_backbone: clients +
-- invoices.client_id); suppliers were left on the fragile-name-string model. This adds the
-- mirror for the supplier side.
--
-- Identity key, most reliable first:
--   1. IBAN  — the account you PAY. Unique per supplier, stable across name spellings.
--   2. normalized name key (vendorCoreKey: lowercased, legal suffixes bv/nv/vof/… + punctuation
--      stripped) — the fallback when no IBAN is printed.
--
-- Non-breaking: NULLABLE invoices.supplier_id + ON DELETE SET NULL, so deleting a supplier
-- never deletes or orphans an invoice (the client_name snapshot preserves history). Legacy
-- invoices keep supplier_id NULL and still render by client_name.

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- The canonical display name — the first reliable name we saw for this supplier. Later
  -- invoices whose printed name differs are linked to THIS record and adopt this name, so the
  -- crediteuren list shows one consistent supplier instead of many spellings.
  name text NOT NULL,
  -- Normalized match key (vendorCoreKey). Used for name-based resolution when no IBAN is known.
  name_key text,
  iban text,
  kvk_number text,
  btw_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_pkey PRIMARY KEY (id),
  CONSTRAINT suppliers_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- One supplier per IBAN per user — the strong identity. Partial (IBAN present) so the many
-- suppliers without a known IBAN are not collapsed into a single NULL row. The resolver inserts
-- plainly and catches the unique violation (23505) on a concurrent-sync race — it does NOT use
-- ON CONFLICT, because PostgREST cannot carry this partial index's WHERE predicate into an
-- ON CONFLICT arbiter.
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_user_iban_uidx
  ON public.suppliers (user_id, iban) WHERE iban IS NOT NULL;

-- Fast name-key lookup for the no-IBAN fallback path.
CREATE INDEX IF NOT EXISTS suppliers_user_name_key_idx
  ON public.suppliers (user_id, name_key) WHERE name_key IS NOT NULL;

-- Trigram index so a future "search suppliers" surface stays cheap.
CREATE INDEX IF NOT EXISTS suppliers_name_trgm
  ON public.suppliers USING gin (name gin_trgm_ops);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_select_own ON public.suppliers;
CREATE POLICY suppliers_select_own ON public.suppliers
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS suppliers_insert_own ON public.suppliers;
CREATE POLICY suppliers_insert_own ON public.suppliers
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS suppliers_update_own ON public.suppliers;
CREATE POLICY suppliers_update_own ON public.suppliers
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS suppliers_delete_own ON public.suppliers;
CREATE POLICY suppliers_delete_own ON public.suppliers
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- The link. NULLABLE + SET NULL: a supplier delete never touches invoice history.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id
  ON public.invoices (supplier_id) WHERE supplier_id IS NOT NULL;
