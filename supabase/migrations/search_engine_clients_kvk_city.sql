-- [SEARCH] Aanvulling op search_engine.sql — de twee ontbrekende clients-indexen.
--
-- Probleem: de globale zoek-API doorzoekt het klantenregister op VIER kolommen —
-- buildOr(["name", "email", "kvk_number", "city"], terms) in
-- src/app/api/search/route.ts — maar search_engine.sql legde alleen een
-- trigram-index op name en email. Zoeken op KVK-nummer of plaats viel daardoor
-- terug op een scan, wat het eigen contract van dat bestand ("elke ILIKE
-- index-gedekt") tegensprak.
--
-- De impact was begrensd omdat die query altijd .eq(user_id) is (dus een per-tenant
-- gefilterde scan), maar bij een groot klantenregister loont de index alsnog.
--
-- Bewust NIET toegevoegd: profiles.kvk_number. Die query is .in(<kleine id-lijst>)-
-- begrensd tot de gekoppelde klanten van één accountant, dus de planner zou een
-- trigram-index daar praktisch nooit kiezen — puur cosmetische parity, geen winst.
--
-- Non-breaking & idempotent: alleen CREATE INDEX IF NOT EXISTS. Geen schema-,
-- data- of gedragswijziging — puur snelheid.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── clients (zzper doorzoekt eigen klantenregister) ─────────────────────────
CREATE INDEX IF NOT EXISTS clients_kvk_number_trgm
  ON public.clients USING gin (kvk_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_city_trgm
  ON public.clients USING gin (city gin_trgm_ops);
