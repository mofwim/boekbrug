-- supabase/migrations/mollie.sql
-- [MOLLIE] iDEAL-betaallinks op de betaalpagina — augustus 2026
--
-- Twee tabellen, allebei uitsluitend via service_role beschreven:
--
--   · mollie_connections: de koppeling van een eigenaar met zijn EIGEN Mollie-account.
--     De API-sleutel is een langlevend geheim met geldwaarde en gaat door dezelfde deur
--     als de SnelStart-maatwerksleutel: Supabase Vault, alleen de secret-id in de tabel
--     (zie snelstart_connection.sql en mollie-connection.ts — de ENIGE lezer/schrijver).
--
--   · mollie_payment_links: één rij per aangemaakte betaallink. De rij is drie dingen
--     tegelijk: het bewijs welk bedrag aan de klant is gevraagd, de sleutel waarmee de
--     webhook de link bij Mollie zélf naleest (het POST-lichaam van een webhook is een
--     deurbel, nooit een bewijs), en — via zijn id als p_client_key van
--     apply_manual_payment — het idempotentie-slot dat een dubbel afgeleverde webhook
--     onschadelijk maakt.

CREATE TABLE IF NOT EXISTS public.mollie_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  api_key_secret_id uuid,
  status text NOT NULL DEFAULT 'active',
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  CONSTRAINT mollie_connections_pkey PRIMARY KEY (id),
  CONSTRAINT mollie_connections_user_uidx UNIQUE (user_id),
  CONSTRAINT mollie_connections_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

ALTER TABLE public.mollie_connections ENABLE ROW LEVEL SECURITY;

-- De eigenaar mag de STATUS van zijn koppeling zien (de instellingenkaart toont
-- "gekoppeld sinds …"); de sleutel zelf staat hier niet, alleen de Vault-verwijzing —
-- en Vault-RPC's zijn al niet voor authenticated aanroepbaar. Schrijven doet alleen
-- de connect-route met service_role, na validatie van de sleutel bij Mollie.
DROP POLICY IF EXISTS mollie_connections_select_own ON public.mollie_connections;
CREATE POLICY mollie_connections_select_own ON public.mollie_connections
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.mollie_payment_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  -- Mollie's eigen id (pl_…) en de checkout-URL die de klant kreeg.
  link_id text NOT NULL,
  checkout_url text NOT NULL,
  -- Het gevraagde bedrag zoals naar Mollie gestuurd ("300.00") — bewijs, en het bedrag
  -- waartegen de webhook Mollie's antwoord verifieert. Een deelbetaling die het open
  -- bedrag verandert maakt deze link 'superseded'; de betaalpagina maakt dan een nieuwe.
  amount_value text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  marked_at timestamptz,
  last_error text,
  CONSTRAINT mollie_payment_links_pkey PRIMARY KEY (id),
  CONSTRAINT mollie_payment_links_link_uidx UNIQUE (link_id),
  CONSTRAINT mollie_payment_links_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT mollie_payment_links_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE
);

-- Hooguit ÉÉN open link per factuur: de betaalpagina hergebruikt hem zolang het bedrag
-- klopt, en vervangt hem (status 'superseded') zodra het open bedrag is veranderd.
CREATE UNIQUE INDEX IF NOT EXISTS mollie_payment_links_open_uidx
  ON public.mollie_payment_links (invoice_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS mollie_payment_links_user_created_idx
  ON public.mollie_payment_links (user_id, created_at DESC);

ALTER TABLE public.mollie_payment_links ENABLE ROW LEVEL SECURITY;

-- Geen policies: alleen service_role (de betaalpagina-route en de webhook) leest en
-- schrijft hier. De eigenaar ziet de uitkomst op de factuur zelf (status 'paid'), niet
-- via deze tabel.

-- ── CONTROLE ──
-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('mollie_connections', 'mollie_payment_links');
-- → beide relrowsecurity = true.
-- SELECT COUNT(*) FROM pg_policies WHERE tablename = 'mollie_payment_links';
-- → 0 (bewust: service_role-only).
