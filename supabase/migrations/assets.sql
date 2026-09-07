-- [BEDRIJFSMIDDEL] Het register van bedrijfsmiddelen en hun afschrijving.
-- BoekBrug · september 2026
--
-- WAAROM
-- Een inkoop van € 450 of meer (ex btw als de btw aftrekbaar is) is een bedrijfsmiddel: die
-- schrijf je af over zijn gebruiksduur (max. 20% per jaar, met restwaarde, naar rato vanaf de
-- maand van ingebruikname — belastingdienst.nl, "Hoe berekent u het bedrag van de afschrijving?").
-- Tot vandaag landde zo'n factuur VOLLEDIG in de kosten van het jaar, en het jaarscherm zei dat
-- eerlijk ("afschrijvingen … staan hier als volledige kost of nog nergens"). Gemeten op de
-- levende administratie: één horeca-apparaat van € 756 (mei 2026) dat nu als kost staat.
--
-- WAT DIT WEL IS
-- Twee tabellen. `assets`: één rij per bedrijfsmiddel, met of zonder inkoopfactuur (een koeling
-- van vóór BoekBrug hoort er ook in). `asset_dismissals`: het antwoord "nee, dit is inkoop" op
-- een kandidaat, zodat dezelfde vraag nooit twee keer wordt gesteld.
--
-- WAT DIT NADRUKKELIJK NIET IS
-- Geen automatische classificatie: een bedrag alleen maakt niets tot bedrijfsmiddel (de
-- wekelijkse vleesfactuur van € 3.000 is voorraad). De eigenaar beslist; het rekenwerk staat in
-- src/lib/depreciation.ts. Geen willekeurige afschrijving, geen bedrijfspand, geen boekwinst bij
-- verkoop — die staan op het scherm als werk voor de boekhouder.
--
-- SCHIPT DONKER
-- Een eigenaar zonder rijen ziet precies het oude jaarcijfer: niets wordt uit de kosten gehaald
-- en er wordt niets afgeschreven. De boekhouder leest mee (is_my_accountant_client), schrijft niet:
-- een bedrijfsmiddel verplaatst het resultaat, en dat is de eigenaar zijn handtekening.
--
-- APPLY: draaien in de Supabase SQL editor. Verwijdert niets. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The purchase invoice this asset came from, when it came from one. One asset per invoice.
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  description text NOT NULL,
  -- Acquisition cost in euros: ex btw when the btw was deductible, incl btw when it was not.
  cost numeric(12,2) NOT NULL,
  residual_value numeric(12,2) NOT NULL DEFAULT 0,
  useful_life_years integer NOT NULL,
  -- First month of use; depreciation starts in this month (the day is irrelevant).
  in_use_from date NOT NULL,
  disposed_on date,
  disposal_note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT assets_cost_nonneg CHECK (cost >= 0),
  CONSTRAINT assets_residual_within_cost CHECK (residual_value >= 0 AND residual_value <= cost),
  -- The ordinary rule: at most 20% a year, so five years or more. Willekeurige afschrijving is
  -- a boekhouder's election outside this register — see the screen.
  CONSTRAINT assets_life_ordinary CHECK (useful_life_years BETWEEN 5 AND 50),
  CONSTRAINT assets_disposed_after_use CHECK (disposed_on IS NULL OR disposed_on >= in_use_from),
  CONSTRAINT assets_one_per_invoice UNIQUE (invoice_id)
);

CREATE TABLE IF NOT EXISTS public.asset_dismissals (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, invoice_id)
);

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assets_select_own ON public.assets;
CREATE POLICY assets_select_own ON public.assets
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
DROP POLICY IF EXISTS assets_insert_own ON public.assets;
CREATE POLICY assets_insert_own ON public.assets
  FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));
DROP POLICY IF EXISTS assets_update_own ON public.assets;
CREATE POLICY assets_update_own ON public.assets
  FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
DROP POLICY IF EXISTS assets_delete_own ON public.assets;
CREATE POLICY assets_delete_own ON public.assets
  FOR DELETE TO authenticated USING (user_id = (select auth.uid()));
-- The boekhouder reads the register of a linked client; writing stays with the owner.
DROP POLICY IF EXISTS assets_accountant_read ON public.assets;
CREATE POLICY assets_accountant_read ON public.assets
  FOR SELECT TO authenticated USING (public.is_my_accountant_client(user_id));

DROP POLICY IF EXISTS asset_dismissals_select_own ON public.asset_dismissals;
CREATE POLICY asset_dismissals_select_own ON public.asset_dismissals
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
DROP POLICY IF EXISTS asset_dismissals_insert_own ON public.asset_dismissals;
CREATE POLICY asset_dismissals_insert_own ON public.asset_dismissals
  FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));
DROP POLICY IF EXISTS asset_dismissals_delete_own ON public.asset_dismissals;
CREATE POLICY asset_dismissals_delete_own ON public.asset_dismissals
  FOR DELETE TO authenticated USING (user_id = (select auth.uid()));

CREATE INDEX IF NOT EXISTS idx_assets_user_in_use ON public.assets (user_id, in_use_from);

COMMENT ON TABLE public.assets IS '[BEDRIJFSMIDDEL] One row per business asset; the owner''s answer, never inferred from an amount. Depreciation is computed in src/lib/depreciation.ts (straight-line, months, restwaarde) and moves the year''s result: the purchase leaves the costs, the yearly depreciation enters them.';
COMMENT ON TABLE public.asset_dismissals IS '[BEDRIJFSMIDDEL] "Nee, dit is inkoop": a candidate the owner has answered, so it is not asked again.';

COMMIT;

-- ── CONTROLE ──
-- select count(*) from public.assets;                               -- 0 on a fresh apply
-- select policyname from pg_policies where tablename = 'assets';    -- five rows
-- select conname from pg_constraint where conrelid = 'public.assets'::regclass;
