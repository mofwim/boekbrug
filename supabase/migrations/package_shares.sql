-- [PAKKET-LINK] De overdracht naar een boekhouder die GEEN account heeft.
--
-- Het product belooft: "aan het eind van het kwartaal staat alles klaar voor je boekhouder."
-- Die belofte werd tot nu toe alleen waargemaakt als de boekhouder zich registreerde en zich
-- liet koppelen — de kwartaal-cron loopt over accountant_clients, en de downloadlink in die mail
-- wijst naar een route die inloggen eist. Voor de meest voorkomende Nederlandse situatie (een
-- kantoor dat al tien jaar op Exact of Twinfield draait en zich nooit ergens registreert) werd de
-- kernbelofte dus NIET geleverd: de ondernemer moest zelf een ZIP downloaden, een mail openen,
-- hem eraan hangen en er iets bij typen — precies het handwerk dat dit product wegneemt.
--
-- Deze tabel is die overdracht: de eigenaar maakt een deel-link voor één kwartaal, en de mail
-- draagt hem. Het token IS de sleutel (zelfde vorm als invoices.pay_token) — onraadbaar, per
-- mail verstuurd, en het opent NIETS anders dan het ene kwartaal waarvoor het gemaakt is.
--
-- Drie eigenschappen die het van "een openbare link" onderscheiden, en waarom ze er zijn:
--   · expires_at — een boekhandeling is klaar in weken, niet in jaren. Een link die eeuwig leeft
--     is een lek dat op zijn eigen tempo wacht.
--   · revoked_at — verkeerd adres ingetikt is de helft van alle vergissingen; intrekken moet
--     kunnen zonder een nieuw kwartaal te hoeven verzinnen.
--   · last_downloaded_at — de eigenaar hoort te kunnen zien DAT zijn boekhouder het ophaalde.
--     Dit is hetzelfde argument als [BEWIJS] op de ingelogde route: het verschil met een gedeelde
--     map bestaat pas als de overdracht aantoonbaar is.

CREATE TABLE IF NOT EXISTS public.package_shares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year          int  NOT NULL,
  quarter       int  NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  -- Onraadbaar, en door de DATABASE gezet: geen client bepaalt ooit zijn eigen sleutel.
  token         uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  -- Waar hij heen is gestuurd. Puur voor de eigenaar: "naar wie heb ik mijn boeken gestuurd?"
  sent_to_email text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_downloaded_at timestamptz,
  download_count int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_package_shares_user ON public.package_shares (user_id, created_at DESC);

ALTER TABLE public.package_shares ENABLE ROW LEVEL SECURITY;

-- De eigenaar ziet en maakt zijn eigen links, en mag ze intrekken. Verder niemand: de PUBLIEKE
-- download draait op service_role en vindt de rij op het TOKEN — RLS is daar niet de grens, het
-- token is dat ([RLS-UIT], reden 4: "het token is de credential").
DROP POLICY IF EXISTS package_shares_select_own ON public.package_shares;
CREATE POLICY package_shares_select_own ON public.package_shares
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS package_shares_insert_own ON public.package_shares;
CREATE POLICY package_shares_insert_own ON public.package_shares
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS package_shares_update_own ON public.package_shares;
CREATE POLICY package_shares_update_own ON public.package_shares
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.package_shares IS
  '[PAKKET-LINK] Deel-links waarmee een ondernemer zijn kwartaalpakket overhandigt aan een boekhouder ZONDER account. Het token is de sleutel; de link verloopt, is intrekbaar, en registreert of hij is opgehaald.';
