-- supabase/migrations/company_members_sales_role.sql
-- [NAMENS] Eén extra rol: een verkoopmedewerker die facturen maakt en verstuurt VOOR zijn baas.
--
-- WAT DIT WEL IS
-- Een koppeltabel plus twee kolommen. De medewerker BEZIT niets: hij handelt NAMENS de eigenaar.
-- Alles wat de boekhouding raakt — het factuurnummer, sender_id, het PDF-pad, de eerlijk-
-- gebruikteller — blijft aan de eigenaar hangen. Wie er achter het toetsenbord zat komt in
-- created_by: een spoor, nooit een eigendom. Zie src/lib/acting-for.ts voor de volledige redenering.
--
-- WAAROM DAT ZO MOET
-- invoice-numbering.ts alloceert per user_id. Kreeg een medewerker gewoon een eigen account, dan
-- liepen er TWEE nummerreeksen onder één BTW-nummer. Art. 35 Wet OB eist doorlopende nummering
-- zonder gaten, forward-only — een uitgegeven nummer is niet terug te draaien. Dit is dus geen
-- ontwerpvoorkeur maar de enige inrichting die bij een controle overeind blijft.
--
-- WAT DIT NADRUKKELIJK NIET IS
-- Geen rollensysteem. Er zijn 131 RLS-policies en 184 keer auth.uid() in dit product; die
-- verbouwen tot "mag deze actor dit doen" is een nieuw fundament, geen functie. GEEN ENKELE
-- BESTAANDE POLICY WORDT HIER GEWIJZIGD. Alles hieronder is nieuw en additief, en elke nieuwe
-- policy is zo smal mogelijk: alleen de rijen die de medewerker zelf heeft aangemaakt.
--
-- Idempotent. Draait veilig meerdere keren.

-- ── 1. Wie hoort bij welk bedrijf ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Bewust één waarde. Een nieuwe rol toevoegen hoort een bewuste handeling te zijn: zowel deze
  -- CHECK als de gesloten lijst in acting-for.ts moet dan mee. Een onbekende rol verleent daar
  -- NIETS, zodat een half toegevoegde rol nooit stilzwijgend de rechten van 'verkoop' erft.
  role       text NOT NULL DEFAULT 'verkoop' CHECK (role IN ('verkoop')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Intrekken is een tijdstip, geen DELETE: de facturen die dit lid maakte blijven bestaan en
  -- moeten toewijsbaar blijven aan een mens. Weggooien van de koppeling zou het spoor breken.
  revoked_at timestamptz,
  -- Niemand is lid van zijn eigen bedrijf. Dat zou iemand met de LEESFILTER van een medewerker
  -- naar zijn eigen boekhouding laten kijken — hij raakt dan zijn oudere facturen kwijt.
  CONSTRAINT company_members_no_self CHECK (owner_id <> member_id)
);

-- Eén koppeling per paar. Twee rijen voor hetzelfde paar (één ingetrokken, één actief) maken de
-- vraag "mag dit lid nog?" afhankelijk van welke rij je toevallig las.
CREATE UNIQUE INDEX IF NOT EXISTS company_members_pair_uidx
  ON public.company_members (owner_id, member_id);

-- De lookup die bij ELK verzoek van een medewerker draait.
CREATE INDEX IF NOT EXISTS company_members_member_idx
  ON public.company_members (member_id) WHERE revoked_at IS NULL;

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- Beide partijen mogen de koppeling ZIEN — de eigenaar zijn team, het lid voor wie hij werkt.
-- Niemand mag hem via een gebruikerssessie AANMAKEN: dat gebeurt alleen op de accept-route via
-- service_role, na een uitnodiging op e-mail. Exact de les uit accountant_clients_insert_consent:
-- een self-service INSERT-policy waar je alleen jezelf hoeft te noemen, IS de achterdeur.
DROP POLICY IF EXISTS company_members_read ON public.company_members;
CREATE POLICY company_members_read ON public.company_members
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR member_id = auth.uid());

-- Intrekken mag de eigenaar zelf, en het lid mag zelf weglopen.
DROP POLICY IF EXISTS company_members_revoke ON public.company_members;
CREATE POLICY company_members_revoke ON public.company_members
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR member_id = auth.uid())
  WITH CHECK (owner_id = auth.uid() OR member_id = auth.uid());

-- ── 2. De uitnodiging ─────────────────────────────────────────────────────────────────────────
-- Aparte tabel, GEEN uitbreiding van public.invitations. Die tabel is in zijn kolomnamen
-- boekhouder-specifiek (accountant_email, zzper_id) en zijn accept-route is het gevoeligste pad
-- in de codebase. Daar een tweede soort doorheen vlechten is precies hoe zo'n pad een gat krijgt.
CREATE TABLE IF NOT EXISTS public.company_member_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text NOT NULL DEFAULT 'verkoop' CHECK (role IN ('verkoop')),
  token        uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Een uitnodiging die eeuwig geldig blijft is een sleutel die eeuwig in een mailbox ligt.
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '14 days'
);

CREATE INDEX IF NOT EXISTS company_member_invites_owner_idx
  ON public.company_member_invites (owner_id, status);

ALTER TABLE public.company_member_invites ENABLE ROW LEVEL SECURITY;

-- Alleen de eigenaar ziet en beheert zijn eigen uitnodigingen. De genodigde ziet hem NIET via
-- deze tabel — hij komt binnen met de token op de accept-route, die via service_role leest.
-- Zou de genodigde hier wél mogen lezen, dan was e-mail geen bewijs meer van iets.
DROP POLICY IF EXISTS company_member_invites_owner_all ON public.company_member_invites;
CREATE POLICY company_member_invites_owner_all ON public.company_member_invites
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ── 3. Het spoor: wie maakte deze rij? ────────────────────────────────────────────────────────
-- NULL voor alles wat er al staat, en dat blijft ook zo: bestaande facturen zijn van de eigenaar.
-- acting-for.ts rekent een factuur met created_by IS NULL nooit toe aan een medewerker.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.clients  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- De leesgrens van een medewerker loopt hierlangs, dus hij verdient een index.
CREATE INDEX IF NOT EXISTS invoices_created_by_idx ON public.invoices (sender_id, created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS clients_created_by_idx ON public.clients (user_id, created_by)
  WHERE created_by IS NOT NULL;

-- ── 4. De helper ──────────────────────────────────────────────────────────────────────────────
-- Zelfde vorm als is_my_accountant_client(): SECURITY DEFINER + vast search_path, zodat de policy
-- de koppeltabel kan lezen zonder dat de koppeltabel zelf een leespolicy voor iedereen nodig heeft.
CREATE OR REPLACE FUNCTION public.acting_for_owner()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT cm.owner_id
    FROM public.company_members cm
   WHERE cm.member_id = auth.uid()
     AND cm.role = 'verkoop'
     AND (cm.revoked_at IS NULL OR cm.revoked_at > now())
   LIMIT 1;
$$;

-- ── 5. Wat een medewerker via zijn EIGEN sessie mag ───────────────────────────────────────────
-- Smal met opzet: alleen rijen die hij zelf aanmaakte, binnen het bedrijf waarvoor hij werkt.
-- Hij ziet dus niet de omzet van zijn baas en niet de facturen van een collega.
--
-- LET OP wat hier NIET staat: geen INSERT-policy op invoices. Aanmaken loopt uitsluitend via
-- /api/invoice/draft met service_role, zodat sender_id en created_by door de server worden gezet
-- en niet door de browser. Een INSERT-policy zou de browser laten kiezen wie de eigenaar is.

DROP POLICY IF EXISTS invoices_member_read ON public.invoices;
CREATE POLICY invoices_member_read ON public.invoices
  FOR SELECT TO authenticated
  USING (sender_id = public.acting_for_owner() AND created_by = auth.uid());

-- Bijwerken alleen zolang het een CONCEPT is. Zodra de factuur verstuurd is, is het nummer
-- uitgegeven en is de factuur een wettelijk stuk — dan raakt niemand hem meer aan via deze weg.
DROP POLICY IF EXISTS invoices_member_update_draft ON public.invoices;
CREATE POLICY invoices_member_update_draft ON public.invoices
  FOR UPDATE TO authenticated
  USING (sender_id = public.acting_for_owner() AND created_by = auth.uid() AND status = 'draft')
  -- De WITH CHECK herhaalt de eigendomsvelden bewust: zonder dat kon een UPDATE sender_id of
  -- created_by wegschrijven en de rij daarmee uit zijn eigen grens tillen.
  WITH CHECK (sender_id = public.acting_for_owner() AND created_by = auth.uid() AND status = 'draft');

DROP POLICY IF EXISTS invoice_lines_member_read ON public.invoice_lines;
CREATE POLICY invoice_lines_member_read ON public.invoice_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.id = invoice_lines.invoice_id
       AND i.sender_id = public.acting_for_owner()
       AND i.created_by = auth.uid()
  ));

DROP POLICY IF EXISTS invoice_lines_member_write_draft ON public.invoice_lines;
CREATE POLICY invoice_lines_member_write_draft ON public.invoice_lines
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.id = invoice_lines.invoice_id
       AND i.sender_id = public.acting_for_owner()
       AND i.created_by = auth.uid()
       AND i.status = 'draft'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.id = invoice_lines.invoice_id
       AND i.sender_id = public.acting_for_owner()
       AND i.created_by = auth.uid()
       AND i.status = 'draft'
  ));

-- Klanten: alleen de klanten die hij zelf heeft ingevoerd.
--
-- ⚠️ BEWUSTE PRIJS: hij ziet het klantenbestand van het bedrijf dus NIET, en kan daardoor
-- dezelfde klant een tweede keer invoeren als een collega hem al had. Dat is de keuze die de
-- eigenaar maakte (een klantenlijst is zelf ook commerciële informatie). Wil je dat later
-- anders, dan is het één policy — niet een verbouwing.
DROP POLICY IF EXISTS clients_member_read ON public.clients;
CREATE POLICY clients_member_read ON public.clients
  FOR SELECT TO authenticated
  USING (user_id = public.acting_for_owner() AND created_by = auth.uid());

-- Een klant TOEVOEGEN mag hij ook, en dat is geen extraatje: zonder deze policy staat er op
-- /dashboard/klanten een knop die het niet doet, en dat is erger dan een knop die er niet is.
-- De WITH CHECK dwingt af dat hij hem onder de EIGENAAR zet en zichzelf als maker noteert —
-- de browser kan die twee velden dus niet zelf kiezen.
DROP POLICY IF EXISTS clients_member_insert ON public.clients;
CREATE POLICY clients_member_insert ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.acting_for_owner() AND created_by = auth.uid());

-- En bijwerken van wat hij zelf invoerde (een typefout in een adres).
DROP POLICY IF EXISTS clients_member_update ON public.clients;
CREATE POLICY clients_member_update ON public.clients
  FOR UPDATE TO authenticated
  USING (user_id = public.acting_for_owner() AND created_by = auth.uid())
  WITH CHECK (user_id = public.acting_for_owner() AND created_by = auth.uid());

-- ── 6. De nummerwacht, precies één streepje wijder ────────────────────────────────────────────
--
-- DIT IS HET SCHARNIER VAN DE HELE MIGRATIE.
--
-- next_invoice_seq() (uit factuur_b_numbering.sql) heeft een harde wacht:
--
--     IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RAISE ... 42501
--
-- Die doet twee dingen tegelijk, en beide moeten blijven:
--   1. service_role mag GEEN nummers slaan (auth.uid() IS NULL). Dat is de reden dat een
--      willekeurige serverroute er niet per ongeluk één kan uitgeven.
--   2. Niemand slaat een nummer in andermans reeks.
--
-- Punt 2 is precies wat een verkoopmedewerker WEL moet kunnen — en alleen dat. Dus wordt de
-- wacht niet opengezet maar één streepje verbreed: je mag ook alloceren voor p_user_id als je
-- op dit moment een niet-ingetrokken 'verkoop'-koppeling met die eigenaar hebt. auth.uid() IS
-- NULL blijft onvoorwaardelijk verboden, dus service_role kan nog steeds niets.
--
-- De rest van de functie is LETTERLIJK ongewijzigd overgenomen — zelfde atomaire
-- INSERT..ON CONFLICT, zelfde forward-only gedrag. Er verandert niets aan hoe een nummer
-- ontstaat, alleen aan wie erom mag vragen.
CREATE OR REPLACE FUNCTION public.next_invoice_seq(
  p_user_id uuid,
  p_year    int,
  p_type    text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq int;
BEGIN
  -- Caller identity guard. auth.uid() is request-scoped and still returns
  -- the CALLER's id inside SECURITY DEFINER. A service_role / anon context
  -- (auth.uid() IS NULL) may NOT mint numbers -- both real call sites use
  -- the authenticated session client.
  --
  -- [NAMENS] Uitzondering, en maar één: een actieve verkoopmedewerker mag alloceren in de reeks
  -- van ZIJN eigenaar. Dat is geen versoepeling maar de voorwaarde om er ÉÉN reeks van te maken
  -- in plaats van twee -- Art. 35 Wet OB eist doorlopende nummering zonder gaten.
  IF auth.uid() IS NULL
     OR ( auth.uid() <> p_user_id
          AND NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.member_id = auth.uid()
               AND cm.owner_id  = p_user_id
               AND cm.role      = 'verkoop'
               AND (cm.revoked_at IS NULL OR cm.revoked_at > now())
          )
     )
  THEN
    RAISE EXCEPTION
      '[FACTUUR-B] next_invoice_seq: caller % may not allocate for %',
      auth.uid(), p_user_id
      USING ERRCODE = '42501';   -- insufficient_privilege
  END IF;

  IF p_type NOT IN ('factuur','creditnota','pro_forma') THEN
    RAISE EXCEPTION '[FACTUUR-B] next_invoice_seq: invalid type %', p_type
      USING ERRCODE = '22023';   -- invalid_parameter_value
  END IF;

  IF p_year < 0 THEN
    RAISE EXCEPTION '[FACTUUR-B] next_invoice_seq: invalid year %', p_year
      USING ERRCODE = '22023';
  END IF;

  -- Atomic read+increment in a single statement. Concurrent callers
  -- serialize on the row lock taken by ON CONFLICT -- each gets a distinct
  -- last_seq. No SELECT-then-compute window. Forward-only by construction.
  INSERT INTO public.invoice_counters (user_id, year, type, last_seq)
  VALUES (p_user_id, p_year, p_type, 1)
  ON CONFLICT (user_id, year, type)
  DO UPDATE SET last_seq = public.invoice_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN v_seq;
END;
$$;

-- =====================================================================
-- CONTROLE — draai dit blok NA de migratie. Het is het verschil tussen
-- "toegepast" en "toegepast en gecontroleerd".
-- =====================================================================
-- 1) Staat alles er?
--    SELECT to_regclass('public.company_members')        AS leden,
--           to_regclass('public.company_member_invites') AS uitnodigingen,
--           (SELECT count(*) FROM information_schema.columns
--             WHERE table_schema='public' AND table_name='invoices' AND column_name='created_by') AS inv_created_by,
--           (SELECT count(*) FROM information_schema.columns
--             WHERE table_schema='public' AND table_name='clients'  AND column_name='created_by') AS cli_created_by;
--    Verwacht: alle vier gevuld / 1.
--
-- 2) De vijf nieuwe policies — en GEEN andere die is aangeraakt:
--    SELECT tablename, policyname FROM pg_policies
--     WHERE schemaname='public' AND policyname LIKE '%_member_%' ORDER BY 1,2;
--    Verwacht precies deze zeven: clients_member_insert, clients_member_read,
--              clients_member_update, invoice_lines_member_read,
--              invoice_lines_member_write_draft, invoices_member_read,
--              invoices_member_update_draft.
--    Staat er een ACHTSTE, dan is er ergens een policy bij gekomen die hier niet is besproken —
--    kijk daar naar, want dit is de enige plek waar een medewerker rechten krijgt.
--
-- 3) DE BELANGRIJKSTE: verleent de helper iets aan wie GEEN lid is?
--    SELECT public.acting_for_owner();
--    Verwacht als jij (de eigenaar) hem draait: NULL. Krijg je een uuid terug, dan staat er een
--    koppeling op jouw naam als LID en klopt er iets niet — kijk in company_members.
--
-- 4) En de sluitende: bestaat er een factuur die aan een medewerker wordt toegerekend zonder dat
--    hij hem maakte? Hoort leeg te zijn, altijd.
--    SELECT i.id, i.sender_id, i.created_by
--      FROM public.invoices i
--      JOIN public.company_members cm ON cm.member_id = i.created_by
--     WHERE i.sender_id <> cm.owner_id;
--    Verwacht: 0 rijen. Eén rij hier betekent dat een factuur onder het verkeerde bedrijf hangt.
--
-- 5) De nummerwacht: houdt hij service_role nog steeds buiten? Draai in de SQL-editor
--    (die draait als service_role, dus auth.uid() is daar NULL):
--      SELECT public.next_invoice_seq('00000000-0000-0000-0000-000000000000'::uuid, 2026, 'factuur');
--    Verwacht: FOUT 42501 "may not allocate for". Krijg je een GETAL terug, stop dan met
--    deployen — dan is de wacht weg en kan elke serverroute nummers uitgeven.
--
-- 6) En hij mag ook geen NIEUW nummer hebben weggegeven tijdens die test. Controleer:
--      SELECT * FROM public.invoice_counters
--       WHERE user_id = '00000000-0000-0000-0000-000000000000';
--    Verwacht: 0 rijen. (Bij een correcte 42501 komt de INSERT nooit toe.)
-- =====================================================================
