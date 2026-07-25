-- [SNELSTART] Live koppeling met SnelStart (B2B-API v2) — juli 2026
--
-- Waarom: SnelStart is het pakket dat onze doelgroep (kleine handelaren en hun
-- boekhouders) het meest gebruikt. Tot nu toe eindigde BoekBrug bij een export-bestand
-- dat iemand handmatig moest importeren. Deze migratie legt de basis voor een ONLINE
-- koppeling: boekingen gaan rechtstreeks als inkoop-/verkoopboeking naar de administratie.
--
-- Twee tabellen:
--   1. snelstart_connections — één koppeling per gebruiker. De maatwerksleutel
--      (clientkey) is een LANGLEVEND geheim dat volledige toegang tot de administratie
--      geeft; die staat daarom NOOIT in een gewone kolom maar in Supabase Vault, precies
--      zoals de e-mail OAuth-tokens (zie email_connections.access_token_secret_id).
--      De kolom hier bewaart alleen de Vault secret-id (nutteloos zonder service_role,
--      want vault_read_secret is service_role-only).
--   2. snelstart_exports — het duw-logboek: welke factuur is als welke boeking in
--      SnelStart terechtgekomen. Dit is de idempotentie-sleutel én het bewijs: zonder
--      dit logboek zou een tweede "stuur kwartaal door" dezelfde factuur nogmaals boeken
--      (dubbele kosten, verkeerde BTW-aangifte).

CREATE TABLE IF NOT EXISTS public.snelstart_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- Vault-referentie naar de maatwerksleutel. Nooit de sleutel zelf.
  client_key_secret_id uuid,
  key_stored_at timestamptz,
  -- Vrij label van de gebruiker ("Administratie 2026"). Puur cosmetisch: de sleutel
  -- bepaalt welke administratie geraakt wordt, niet dit label.
  administration_label text,
  -- Standaard grootboekrekeningen in SnelStart (uuid's uit /v2/grootboeken).
  -- Zonder deze twee kan er niets geboekt worden — een boekingsregel eist een grootboek.
  inkoop_grootboek_id uuid,
  verkoop_grootboek_id uuid,
  -- 'active'        → sleutel werkt
  -- 'needs_reauth'  → SnelStart gaf 401/403; gebruiker moet een nieuwe maatwerksleutel plakken
  status text NOT NULL DEFAULT 'active'
    CHECK (status = ANY (ARRAY['active'::text, 'needs_reauth'::text])),
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_push_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT snelstart_connections_pkey PRIMARY KEY (id),
  CONSTRAINT snelstart_connections_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Eén koppeling per gebruiker: opnieuw verbinden vervangt de bestaande rij (upsert),
  -- zodat er nooit twee sleutels naast elkaar leven en "welke is de echte?" ontstaat.
  CONSTRAINT snelstart_connections_user_unique UNIQUE (user_id)
);

ALTER TABLE public.snelstart_connections ENABLE ROW LEVEL SECURITY;

-- Lezen mag de eigenaar (de UI toont status/laatste fout). Schrijven gebeurt UITSLUITEND
-- via de server-routes met service_role: een client die zelf status='active' of een
-- secret-id zou kunnen zetten, kan de koppeling van zijn eigen account kapen of
-- vervalsen. Er is dus bewust geen insert/update/delete policy voor authenticated.
DROP POLICY IF EXISTS snelstart_connections_select_own ON public.snelstart_connections;
CREATE POLICY snelstart_connections_select_own ON public.snelstart_connections
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.snelstart_exports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  direction text NOT NULL
    CHECK (direction = ANY (ARRAY['incoming'::text, 'outgoing'::text])),
  boeking_type text NOT NULL
    CHECK (boeking_type = ANY (ARRAY['inkoopboeking'::text, 'verkoopboeking'::text])),
  -- Id's die SnelStart teruggeeft. Bewaard zodat een mens de boeking daar kan terugvinden
  -- (en een latere "haal terug"-functie de brug kan sluiten).
  snelstart_id uuid,
  snelstart_relatie_id uuid,
  status text NOT NULL
    CHECK (status = ANY (ARRAY['pushed'::text, 'failed'::text])),
  error_code text,
  error_message text,
  -- Het factuurbedrag zoals VERSTUURD (incl. BTW, negatief bij creditnota). Bewijs van wat
  -- SnelStart ontving — niet wat de factuur vandaag toevallig zegt.
  amount numeric,
  pushed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT snelstart_exports_pkey PRIMARY KEY (id),
  CONSTRAINT snelstart_exports_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT snelstart_exports_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE
);

-- Idempotentie-slot: een factuur kan hooguit ÉÉN geslaagde boeking in SnelStart hebben.
-- Partieel (alleen status='pushed'), zodat een mislukte poging opnieuw geprobeerd mag
-- worden en de mislukking als spoor bewaard blijft.
CREATE UNIQUE INDEX IF NOT EXISTS snelstart_exports_user_invoice_pushed_uidx
  ON public.snelstart_exports (user_id, invoice_id) WHERE status = 'pushed';

CREATE INDEX IF NOT EXISTS snelstart_exports_user_pushed_at_idx
  ON public.snelstart_exports (user_id, pushed_at DESC);

ALTER TABLE public.snelstart_exports ENABLE ROW LEVEL SECURITY;

-- Zelfde redenering: lezen mag de eigenaar (de UI toont "23 doorgestuurd, 2 mislukt"),
-- schrijven doet alleen de push-route met service_role. Anders kon een client een
-- 'pushed'-rij verzinnen en daarmee een factuur permanent uit de doorstuurlijst laten
-- verdwijnen zonder dat die ooit in SnelStart is geboekt.
DROP POLICY IF EXISTS snelstart_exports_select_own ON public.snelstart_exports;
CREATE POLICY snelstart_exports_select_own ON public.snelstart_exports
  FOR SELECT TO authenticated USING (user_id = auth.uid());
