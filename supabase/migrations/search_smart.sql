-- [SEARCH] Fuzzy (typo-tolerant) zoeken via pg_trgm-similariteit.
--
-- Deze functies vullen de globale zoek-API aan wanneer exacte/substring-resultaten
-- schaars zijn ("bedoelde je …?"). Ze gebruiken de trigram-operator `%` (index-gedekt
-- door search_engine.sql) zodat "mohamd" nog steeds "Mohamed" vindt.
--
-- Drempels: de default similarity-drempel (0.3) is te streng voor KORTE queries met
-- één weggevallen letter — similarity('fmz','famz') ≈ 0.286 < 0.3 → gemist. Bovendien
-- straft similarity() lengteverschil af, dus een typefout op één WOORD in een langere
-- naam ("famz" in "Famz Trading BV") scoort laag. Daarom matchen we met TWEE maten:
--   * similarity()      — hele-string-gelijkenis, drempel 0.2
--   * word_similarity() — beste-woord/deel-gelijkenis, drempel 0.4
--
-- We gebruiken de FUNCTIES (niet de operatoren % / <%) met expliciete drempels, omdat
-- Supabase het zetten van pg_trgm.similarity_threshold in een functie-SET verbiedt
-- ("permission denied to set parameter"). De functie-vorm heeft geen GUC nodig. Kosten:
-- de fuzzy-WHERE is niet index-gedekt (seq scan), maar draait alleen als de exacte/
-- substring-resultaten schaars zijn, over de door RLS begrensde rijen van de gebruiker,
-- met LIMIT — dus snel.
--
-- Veiligheid: SECURITY INVOKER (de default, hier expliciet) → de functie draait met
-- de RLS-context van de aanroeper. Een gebruiker krijgt dus NOOIT rijen die hij niet
-- sowieso al mag zien; RLS op invoices/clients blijft de grens. De query-parameter `q`
-- is een echte bind-parameter (geen string-interpolatie) → geen injectie.
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
  FROM public.invoices i
  WHERE length(btrim(q)) >= 2
    AND (
      similarity(coalesce(i.client_name, ''), q) >= 0.2
      OR word_similarity(q, coalesce(i.client_name, '')) >= 0.4
      OR similarity(coalesce(i.invoice_number, ''), q) >= 0.2
      OR word_similarity(q, coalesce(i.invoice_number, '')) >= 0.4
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
  FROM public.clients c
  WHERE length(btrim(q)) >= 2
    AND (
      similarity(coalesce(c.name, ''), q) >= 0.2
      OR word_similarity(q, coalesce(c.name, '')) >= 0.4
      OR similarity(coalesce(c.email, ''), q) >= 0.2
      OR word_similarity(q, coalesce(c.email, '')) >= 0.4
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
