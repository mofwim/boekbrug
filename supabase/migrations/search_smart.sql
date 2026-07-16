-- [SEARCH] Fuzzy (typo-tolerant) zoeken via pg_trgm-similariteit.
--
-- Deze functies vullen de globale zoek-API aan wanneer exacte/substring-resultaten
-- schaars zijn ("bedoelde je …?"). Ze gebruiken de trigram-operator `%` (index-gedekt
-- door search_engine.sql) zodat "mohamd" nog steeds "Mohamed" vindt.
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
    AND (i.client_name % q OR i.invoice_number % q)
  ORDER BY GREATEST(
      similarity(coalesce(i.client_name, ''), q),
      similarity(coalesce(i.invoice_number, ''), q)
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
    AND (c.name % q OR coalesce(c.email, '') % q)
  ORDER BY GREATEST(
      similarity(coalesce(c.name, ''), q),
      similarity(coalesce(c.email, ''), q)
    ) DESC
  LIMIT 5;
$$;

-- Aanroepbaar voor ingelogde gebruikers; RLS bepaalt nog steeds welke rijen terugkomen.
GRANT EXECUTE ON FUNCTION public.search_invoices_fuzzy(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_clients_fuzzy(text)  TO authenticated;
