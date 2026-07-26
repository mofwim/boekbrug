-- [SEARCH] Zoek-indexen voor bank & kas — het vervolg op search_engine.sql.
--
-- Probleem: de bank- en kaspagina's laten de gebruiker zoeken op tegenpartij,
-- omschrijving, IBAN, referentie en bedrag, maar bank_transactions en cash_entries
-- hadden GEEN enkele trigram-index. Elke ILIKE '%term%' (leading wildcard) over die
-- tabellen was daardoor een sequential scan, en zodra de globale Cmd+K-zoek deze
-- tabellen ook gaat dekken (fase 2) zou dat per toetsaanslag een volledige scan zijn.
--
-- Oplossing: pg_trgm + GIN-trigram-indexen op precies de kolommen die de zoekcode
-- doorzoekt — identiek patroon als search_engine.sql. gin_trgm_ops maakt zowel
-- ILIKE-substring als fuzzy-match index-gedekt.
--
-- Non-breaking & idempotent: alleen CREATE EXTENSION/INDEX IF NOT EXISTS. Geen
-- schema-, data- of gedragswijziging — puur zoeksnelheid.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── bank_transactions (counterpart_name / description / reference / counterpart_iban) ──
CREATE INDEX IF NOT EXISTS bank_transactions_counterpart_name_trgm
  ON public.bank_transactions USING gin (counterpart_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bank_transactions_description_trgm
  ON public.bank_transactions USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bank_transactions_reference_trgm
  ON public.bank_transactions USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bank_transactions_counterpart_iban_trgm
  ON public.bank_transactions USING gin (counterpart_iban gin_trgm_ops);

-- ── cash_entries (description / category) ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS cash_entries_description_trgm
  ON public.cash_entries USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cash_entries_category_trgm
  ON public.cash_entries USING gin (category gin_trgm_ops);
