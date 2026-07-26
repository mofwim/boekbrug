-- [SUPPLIER-IDENTITY] Use the vendor's KVK (Chamber-of-Commerce number) as a strong supplier key.
-- The columns suppliers.kvk_number / btw_number already exist (supplier_registry.sql); this adds
-- the identity INDEX so the resolver can match/create by KVK.
--
-- KVK is the legal-entity id: it keeps two companies that share a printed name apart (they have
-- different KVK) and unites one company's differently-spelled invoices. One supplier per (user,
-- KVK) — partial (KVK present) so the many suppliers without a known KVK are not collapsed into a
-- single NULL row. The resolver inserts plainly and catches the unique violation (23505) on a
-- concurrent-sync race, exactly like the IBAN key (PostgREST can't carry a partial predicate into
-- an ON CONFLICT arbiter, so we never use ON CONFLICT here).

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_user_kvk_uidx
  ON public.suppliers (user_id, kvk_number) WHERE kvk_number IS NOT NULL;
