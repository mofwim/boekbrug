-- [LEVERANCIER-STANDAARD] What the owner decided ONCE for a supplier, remembered for the next time.
--
-- Two defaults, both nullable, both a statement by the owner and never a statistic:
--
-- 1. default_btw_rate — the rate this supplier charges. The app already infers a rate from a
--    supplier's own invoices (vendor-vat-rate.ts) and refuses to when the history blends or is
--    short. That inference stays; this column is what the owner SAYS, and it outranks it: a
--    wholesaler the owner knows charges 9 % gets the proposal from the first invoice, not the
--    fifth. It still only PROPOSES the split — the owner confirms every invoice, as before.
--
-- 2. default_category — where a bank line paying this supplier lands. The bank categoriser
--    already treats money leaving for a registered supplier as 'kosten'; this lets the owner say
--    otherwise for the ones that are not (a private subscription paid from the business account,
--    a transfer to their own other company). The same vocabulary as bank_transactions.category,
--    checked here so a typo cannot become a category the P&L does not know.
--
-- Neither column touches an invoice already in the books: an invoice keeps its own printed
-- amounts and its own bank line keeps the category the owner confirmed on it.
--
-- Additive and nullable, so the columns are safe to add ahead of the code and the code (which
-- reads them through explicit selects) ships only after they exist.

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS default_btw_rate smallint,
  ADD COLUMN IF NOT EXISTS default_category text;

ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_default_btw_rate_legal;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_default_btw_rate_legal
  CHECK (default_btw_rate IS NULL OR default_btw_rate IN (0, 9, 21));

ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_default_category_known;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_default_category_known
  CHECK (default_category IS NULL OR default_category IN ('omzet', 'pos_income', 'kosten', 'fee', 'prive', 'transfer', 'tax'));

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'suppliers' AND column_name IN ('default_btw_rate', 'default_category');
--   → 2 rows
