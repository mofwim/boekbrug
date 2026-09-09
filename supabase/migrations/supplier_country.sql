-- supabase/migrations/supplier_country.sql
-- [LEVERANCIER-LAND] The supplier's country — what puts a purchase in rubriek 4a or 4b.
--
-- WHY
-- A zzp'er buys from Adobe (IE), AWS (LU), a UK contractor, OpenAI (US). On every one of those
-- invoices the btw is shifted to the buyer: owed in rubriek 4b (EU) or 4a (outside the EU) and,
-- with a right of deduction, taken back in 5b. This app could see the EU ones through the prefix
-- of the supplier's btw-nummer and listed them; a supplier without an EU prefix — every UK, US or
-- Swiss one — reached nothing at all. Under the KOR or a partial exemption that btw is genuinely
-- owed, and the concept declared nothing.
--
-- The country is the owner's statement about the supplier, made once. The prefix of an EU
-- btw-nummer still stands in for it where nothing was recorded, so today's EU suppliers need no
-- action. ISO 3166-1 alpha-2, upper case. NULL = not recorded, read as the Netherlands — which is
-- exactly what every existing row was before this column existed.
--
-- Additive and nullable. The app reads it in its own tolerant read and writes it in its own step,
-- so an installation behind on this file keeps its supplier list and its supplier edits.

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS country text
  CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');

COMMENT ON COLUMN public.suppliers.country IS
  '[LEVERANCIER-LAND] ISO 3166-1 alpha-2 (NL, DE, US). NULL = niet vastgelegd, gelezen als Nederland. Buiten NL: de btw op deze inkopen is naar de eigenaar verlegd (rubriek 4a/4b).';
