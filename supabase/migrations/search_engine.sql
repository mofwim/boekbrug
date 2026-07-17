-- [SEARCH] Zoekmachine — trigram-indexen zodat elke ILIKE '%term%' index-gedekt is.
--
-- Probleem: de globale zoek-API (src/app/api/search/route.ts) en de bestanden-zoek
-- (src/lib/bestanden.ts) gebruiken ILIKE '%term%' (leading wildcard). B-tree-indexen
-- kunnen leading wildcards NIET gebruiken → elke zoekopdracht was een sequential scan,
-- en invoice_lines had zelfs geen enkele index (ook niet op de FK invoice_id).
--
-- Oplossing: pg_trgm + GIN-trigram-indexen op precies de kolommen die de zoekcode
-- doorzoekt. gin_trgm_ops maakt ILIKE-substring en fuzzy-match index-gedekt.
--
-- Non-breaking & idempotent: alleen CREATE EXTENSION/INDEX IF NOT EXISTS. Geen
-- schema-, data- of gedragswijziging — puur snelheid.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── invoices (invoice_number / client_name / client_email) ──────────────────
CREATE INDEX IF NOT EXISTS invoices_invoice_number_trgm
  ON public.invoices USING gin (invoice_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS invoices_client_name_trgm
  ON public.invoices USING gin (client_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS invoices_client_email_trgm
  ON public.invoices USING gin (client_email gin_trgm_ops);

-- ── invoice_lines (description) + FK invoice_id (was volledig ongeïndexeerd) ─
CREATE INDEX IF NOT EXISTS invoice_lines_description_trgm
  ON public.invoice_lines USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS invoice_lines_invoice_id_idx
  ON public.invoice_lines USING btree (invoice_id);

-- ── documents (file_name / doc_type / ai_doc_type / notes) ──────────────────
CREATE INDEX IF NOT EXISTS documents_file_name_trgm
  ON public.documents USING gin (file_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_doc_type_trgm
  ON public.documents USING gin (doc_type gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_ai_doc_type_trgm
  ON public.documents USING gin (ai_doc_type gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_notes_trgm
  ON public.documents USING gin (notes gin_trgm_ops);

-- ── profiles (accountant doorzoekt gekoppelde klanten) ──────────────────────
CREATE INDEX IF NOT EXISTS profiles_full_name_trgm
  ON public.profiles USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_company_name_trgm
  ON public.profiles USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_email_trgm
  ON public.profiles USING gin (email gin_trgm_ops);

-- ── clients (zzper doorzoekt eigen klantenregister) ─────────────────────────
CREATE INDEX IF NOT EXISTS clients_name_trgm
  ON public.clients USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_email_trgm
  ON public.clients USING gin (email gin_trgm_ops);
