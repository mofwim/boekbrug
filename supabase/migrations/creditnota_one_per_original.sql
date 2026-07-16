-- [IN1] One creditnota per original invoice — enforced at the DB.
--
-- The /api/invoice/creditnota route guarded duplicates with a SELECT-then-INSERT ("does a
-- creditnota already exist for this invoice?"). That is a TOCTOU race: two quick clicks (or
-- two tabs) both pass the SELECT and both INSERT, producing TWO creditnotas for the same
-- invoice with distinct valid CR-numbers — so nothing flags them and the BTW/omzet is
-- corrected TWICE. Crediting is a legal document; a double credit is a real filing error.
--
-- This partial unique index makes the second insert fail with SQLSTATE 23505, which the route
-- now catches and turns into a clean 409 ("Er bestaat al een creditnota voor deze factuur").
--
-- DEPLOY NOTE: if any owner already has TWO creditnotas pointing at the same original invoice,
-- CREATE UNIQUE INDEX will fail until those duplicates are resolved. Check first:
--   SELECT sender_id, original_invoice_id, count(*)
--   FROM invoices WHERE invoice_type = 'creditnota' AND original_invoice_id IS NOT NULL
--   GROUP BY 1,2 HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_creditnota_per_original
  ON invoices (sender_id, original_invoice_id)
  WHERE invoice_type = 'creditnota' AND original_invoice_id IS NOT NULL;
