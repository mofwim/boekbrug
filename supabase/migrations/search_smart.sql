-- [SEARCH] Fuzzy (typo-tolerant) zoeken via pg_trgm-similariteit.
--
-- Deze functies vullen de globale zoek-API aan wanneer exacte/substring-resultaten
-- schaars zijn ("bedoelde je …?"). Ze gebruiken de trigram-operator `%` (index-gedekt
-- door search_engine.sql) zodat "mohamd" nog steeds "Mohamed" vindt.
--
-- Drie signalen, want geen enkele vangt alle typefouten:
--   1. similarity()       — hele-string trigram-gelijkenis (drempel 0.2)
--   2. word_similarity()  — beste-woord/deel trigram-gelijkenis (drempel 0.4)
--   3. subsequence-LIKE   — de tekens van de query in volgorde met gaten ertussen
--      ("fmz" → '%f%m%z%'). Vangt WEGGELATEN letters/afkortingen waar trigrams falen:
--      "fmz" matcht "FAMZFOOD" (f…m…z) maar NIET "Doyum Food"/"Vars Foods" (geen f→m→z
--      in volgorde). Trigram (1&2) vangt vervang-typefouten; subsequence (3) vangt
--      weglaat-typefouten. Alleen vanaf 3 tekens (korter = te breed).
--
-- FUNCTIES i.p.v. operatoren % / <%, omdat Supabase `SET pg_trgm.*_threshold` in een
-- functie-definitie verbiedt ("permission denied to set parameter"). Kosten: de fuzzy-
-- WHERE is een seq scan, maar draait alleen bij schaarse resultaten over de door RLS
-- begrensde rijen van de gebruiker, met LIMIT — dus snel. De query `q` wordt voor de
-- LIKE-tak eerst tot [a-z0-9] gestript, dus geen wildcard-/regex-injectie.
--
-- Veiligheid: SECURITY INVOKER → de functie draait met de RLS-context van de aanroeper;
-- een gebruiker krijgt NOOIT rijen die hij niet sowieso al mag zien.
--
-- Idempotent: CREATE OR REPLACE. Vereist pg_trgm (zie search_engine.sql).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Typo-tolerante factuur-match op klantnaam of factuurnummer.
CREATE OR REPLACE FUNCTION public.search_invoices_fuzzy(q text)
RETURNS SETOF public.invoices
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT i.*
  FROM public.invoices i,
       LATERAL (
         SELECT regexp_replace(lower(q), '[^a-z0-9]', '', 'g') AS qs
       ) n,
       LATERAL (
         SELECT '%' || regexp_replace(n.qs, '(.)', '\1%', 'g') AS pat,
                length(n.qs) AS qlen
       ) p
  WHERE length(btrim(q)) >= 2
    AND (
      similarity(coalesce(i.client_name, ''), q) >= 0.2
      OR word_similarity(q, coalesce(i.client_name, '')) >= 0.4
      OR (p.qlen >= 3 AND lower(coalesce(i.client_name, '')) LIKE p.pat)
      OR similarity(coalesce(i.invoice_number, ''), q) >= 0.2
      OR word_similarity(q, coalesce(i.invoice_number, '')) >= 0.4
      OR (p.qlen >= 3 AND lower(coalesce(i.invoice_number, '')) LIKE p.pat)
    )
  ORDER BY GREATEST(
      similarity(coalesce(i.client_name, ''), q),
      word_similarity(q, coalesce(i.client_name, '')),
      similarity(coalesce(i.invoice_number, ''), q),
      word_similarity(q, coalesce(i.invoice_number, ''))
    ) DESC
  LIMIT 8;
$$;

-- Typo-tolerante klant-match (eigen klantenregister) op naam of e-mail.
CREATE OR REPLACE FUNCTION public.search_clients_fuzzy(q text)
RETURNS SETOF public.clients
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.*
  FROM public.clients c,
       LATERAL (
         SELECT regexp_replace(lower(q), '[^a-z0-9]', '', 'g') AS qs
       ) n,
       LATERAL (
         SELECT '%' || regexp_replace(n.qs, '(.)', '\1%', 'g') AS pat,
                length(n.qs) AS qlen
       ) p
  WHERE length(btrim(q)) >= 2
    AND (
      similarity(coalesce(c.name, ''), q) >= 0.2
      OR word_similarity(q, coalesce(c.name, '')) >= 0.4
      OR (p.qlen >= 3 AND lower(coalesce(c.name, '')) LIKE p.pat)
      OR similarity(coalesce(c.email, ''), q) >= 0.2
      OR word_similarity(q, coalesce(c.email, '')) >= 0.4
      OR (p.qlen >= 3 AND lower(coalesce(c.email, '')) LIKE p.pat)
    )
  ORDER BY GREATEST(
      similarity(coalesce(c.name, ''), q),
      word_similarity(q, coalesce(c.name, '')),
      similarity(coalesce(c.email, ''), q),
      word_similarity(q, coalesce(c.email, ''))
    ) DESC
  LIMIT 5;
$$;

-- Aanroepbaar voor ingelogde gebruikers; RLS bepaalt nog steeds welke rijen terugkomen.
GRANT EXECUTE ON FUNCTION public.search_invoices_fuzzy(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_clients_fuzzy(text)  TO authenticated;
