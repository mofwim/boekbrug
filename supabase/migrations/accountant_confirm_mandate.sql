-- accountant_confirm_mandate.sql
-- [BEVESTIGEN] De tweede machtiging: de boekhouder mag een inkoopfactuur bevestigen.
--
-- HET PROBLEEM, EN HET IS EEN TEGENSPRAAK IN HET PRODUCT ZELF
--
--   closing-package.ts : "'processing' excluded — unverified must not reach the accountant"
--   readiness.ts       : unverifiedInvoiceCount houdt "klaar" tegen
--   en bevestigen kon   : ALLEEN de ondernemer (invoices_receiver_update + trigger-uitzondering 3)
--
-- Dus: het kwartaalpakket is gebouwd VOOR de boekhouder, het is pas compleet als alles bevestigd
-- is, en de enige die mag bevestigen is de ondernemer — de partij die in de praktijk juist op zijn
-- boekhouder leunt. De pakketten stonden dus te wachten op werk van iemand die dat werk niet doet.
--
-- WAAROM DIT EEN APARTE MACHTIGING IS EN GEEN ROL
--
-- Bij factureren gaf art. 35 lid 1 Wet OB dekking: een derde MAG de factuur uitreiken. Voor het
-- bevestigen van de administratie bestaat zo'n bepaling NIET, en art. 52 AWR laat de
-- administratieplicht onverkort bij de ondernemer. Een boekhouder die bevestigt, doet dus iets
-- waar de ondernemer aansprakelijk voor blijft — precies de vorm waarvoor het factuurmandaat is
-- gebouwd. Hetzelfde antwoord dus: uitdrukkelijk, intrekbaar, en met een spoor.
--
-- ÉÉN HUIS VOOR DE MACHTIGINGEN
--
-- Geen tweede tabel. accountant_invoice_mandates krijgt een `kind`, en alles wat er al staat wordt
-- 'facturen'. Twee tabellen met dezelfde vorm lopen na twee wijzigingen uit elkaar; één tabel met
-- een soort houdt de geschiedenis, de RLS en de intrekroute op één plek. De prijs is deze migratie,
-- en die is eenmalig.
--
-- WAT DE BOEKHOUDER HIERMEE NIET KAN
--
-- Bedragen wijzigen. Bevestigen is "deze lezing klopt, boek hem" — niet "ik maak er iets anders
-- van". Klopt het bedrag niet, dan bevestigt hij niet en vraagt hij het na (/dashboard/accountant/
-- opvragen). Dat is geen halve functie maar de juiste grens: de ondernemer blijft aansprakelijk
-- voor de cijfers, en een derde die ze mag herschrijven maakt die aansprakelijkheid fictie.

-- ── 1. De soort ──────────────────────────────────────────────────────────────
ALTER TABLE public.accountant_invoice_mandates
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'facturen';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accountant_invoice_mandates_kind_check'
  ) THEN
    ALTER TABLE public.accountant_invoice_mandates
      ADD CONSTRAINT accountant_invoice_mandates_kind_check
      CHECK (kind IN ('facturen', 'bevestigen'));
  END IF;
END $$;

COMMENT ON COLUMN public.accountant_invoice_mandates.kind IS
  '[MANDAAT] Welke machtiging: ''facturen'' = facturen uitreiken en herinneren namens de klant (art. 35 lid 1 Wet OB); ''bevestigen'' = inkoopfacturen bevestigen zodat het kwartaal kan sluiten. Twee losse besluiten van de klant, nooit één.';

-- De unieke index moet de soort meenemen, anders sluit een factuurmandaat een bevestigmandaat uit.
DROP INDEX IF EXISTS public.accountant_invoice_mandates_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS accountant_invoice_mandates_one_active_kind
  ON public.accountant_invoice_mandates (zzper_id, accountant_id, kind)
  WHERE revoked_at IS NULL;

-- ── 2. De bestaande vraag wordt scherper gesteld ─────────────────────────────
-- has_active_invoice_mandate() moet vanaf nu OP DE SOORT filteren. Zonder deze regel zou een
-- klant die alleen "bevestigen" aanzet er ongemerkt "factureren" bij geven — precies de stille
-- verbreding die dit hele ontwerp moet uitsluiten.
CREATE OR REPLACE FUNCTION public.has_active_invoice_mandate(
  p_accountant uuid,
  p_client     uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.accountant_invoice_mandates m
      JOIN public.accountant_clients ac
        ON ac.accountant_id = m.accountant_id
       AND ac.zzper_id      = m.zzper_id
     WHERE m.accountant_id = p_accountant
       AND m.zzper_id      = p_client
       AND m.kind          = 'facturen'
       AND m.revoked_at IS NULL
  );
$$;

-- En de nieuwe vraag, met dezelfde vorm en dezelfde koppelingseis.
CREATE OR REPLACE FUNCTION public.has_active_confirm_mandate(
  p_accountant uuid,
  p_client     uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.accountant_invoice_mandates m
      JOIN public.accountant_clients ac
        ON ac.accountant_id = m.accountant_id
       AND ac.zzper_id      = m.zzper_id
     WHERE m.accountant_id = p_accountant
       AND m.zzper_id      = p_client
       AND m.kind          = 'bevestigen'
       AND m.revoked_at IS NULL
  );
$$;

-- ── 3. Wie heeft bevestigd ───────────────────────────────────────────────────
-- Dit is de kern van de afspraak. De aansprakelijkheid VERHUIST niet naar de boekhouder — dat kan
-- niet, art. 52 AWR laat hem bij de ondernemer. Wat wel kan is hem ZICHTBAAR maken: bij elke
-- bevestigde regel staat wie hem heeft bevestigd, dus de ondernemer kan altijd zien wat er namens
-- hem is geboekt en door wie. Een machtiging zonder dat spoor is een machtiging die niemand kan
-- controleren.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.invoices.confirmed_by IS
  '[BEVESTIGEN] Wie deze inkoopfactuur heeft bevestigd (processing → received). NULL = de ondernemer zelf, of van vóór deze kolom. Gevuld zodra een gemachtigde boekhouder bevestigt — de aansprakelijkheid blijft bij de ondernemer (art. 52 AWR), dit maakt alleen zichtbaar wie het deed.';

CREATE INDEX IF NOT EXISTS invoices_confirmed_by_idx
  ON public.invoices (confirmed_by) WHERE confirmed_by IS NOT NULL;

-- ── 4. Zien wat er te bevestigen valt ────────────────────────────────────────
-- Dezelfde muur als bij het concept: alle boekhouderspolicies hangen aan `shared`, en dat is
-- GENERATED AS (status IN ('sent','received','paid')). Een inkoopfactuur in 'processing' is dus
-- onzichtbaar voor de boekhouder — hij kan letterlijk niet zien wat hij zou moeten bevestigen.
DROP POLICY IF EXISTS invoices_mandate_confirm_read ON public.invoices;
CREATE POLICY invoices_mandate_confirm_read ON public.invoices
  FOR SELECT TO authenticated
  USING (
    direction = 'incoming'
    AND status = 'processing'
    AND public.has_active_confirm_mandate(auth.uid(), receiver_id)
  );

-- En de bevestiging zelf. USING kijkt naar de OUDE rij (nog te bevestigen), WITH CHECK naar de
-- nieuwe — die is 'received' en dus niet meer 'processing', zodat de status daar niet in mag staan.
-- Wat er verder niet mag bewegen, bewaakt de trigger hieronder; deze policy zegt alleen WELKE rij.
DROP POLICY IF EXISTS invoices_mandate_confirm_write ON public.invoices;
CREATE POLICY invoices_mandate_confirm_write ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    direction = 'incoming'
    AND status = 'processing'
    AND public.has_active_confirm_mandate(auth.uid(), receiver_id)
  )
  WITH CHECK (
    direction = 'incoming'
    AND public.has_active_confirm_mandate(auth.uid(), receiver_id)
  );

-- ── 5. De trigger leert één zin bij, en niet meer ────────────────────────────
-- prevent_accountant_amount_changes() sluit een boekhouder af van elke financieel relevante kolom.
-- Bevestigen heeft er één nodig: `status`. Uitzondering 5 staat dus toe dat een gemachtigde
-- boekhouder een inkoopfactuur van 'processing' naar 'received' brengt — en verder NIETS. Alle
-- bedragen, data en betaalvelden blijven in de verbodslijst, ook voor hem, ook op dat moment.
--
-- Let op wat er expliciet in staat: NEW.status = 'received'. Zonder die vastlegging zou dezelfde
-- uitzondering hem toestaan om 'processing' naar 'paid' te zetten — een betaling verzinnen zonder
-- bankregel, zonder bedrag en zonder spoor.
CREATE OR REPLACE FUNCTION public.prevent_accountant_amount_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Exception 1: service_role / pipeline (auth.uid() = NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Exception 2: ZZP invoice owner (sender) may change anything
  IF OLD.sender_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  -- Exception 3: receiver of an incoming invoice (mark-as-paid)
  IF OLD.receiver_id = auth.uid() AND OLD.direction = 'incoming' THEN
    RETURN NEW;
  END IF;
  -- [MANDAAT] Exception 4: a mandated accountant issuing a draft THEY made for THIS client.
  IF OLD.status = 'draft'
     AND OLD.created_by = auth.uid()
     AND NEW.sender_id   IS NOT DISTINCT FROM OLD.sender_id
     AND NEW.receiver_id IS NOT DISTINCT FROM OLD.receiver_id
     AND NEW.direction   IS NOT DISTINCT FROM OLD.direction
     AND public.has_active_invoice_mandate(auth.uid(), OLD.sender_id)
  THEN
    RETURN NEW;
  END IF;
  -- [BEVESTIGEN] Exception 5: a mandated accountant confirming an incoming invoice — and ONLY
  -- moving it processing → received. Every financial column stays locked, including for them.
  IF OLD.direction = 'incoming'
     AND OLD.status = 'processing'
     AND NEW.status = 'received'
     AND NEW.receiver_id IS NOT DISTINCT FROM OLD.receiver_id
     AND NEW.sender_id   IS NOT DISTINCT FROM OLD.sender_id
     AND NEW.direction   IS NOT DISTINCT FROM OLD.direction
     AND NEW.total_ex_btw  IS NOT DISTINCT FROM OLD.total_ex_btw
     AND NEW.btw_amount    IS NOT DISTINCT FROM OLD.btw_amount
     AND NEW.total_inc_btw IS NOT DISTINCT FROM OLD.total_inc_btw
     AND NEW.invoice_date  IS NOT DISTINCT FROM OLD.invoice_date
     AND NEW.due_date      IS NOT DISTINCT FROM OLD.due_date
     AND NEW.amount_paid   IS NOT DISTINCT FROM OLD.amount_paid
     AND NEW.payment_date  IS NOT DISTINCT FROM OLD.payment_date
     AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method
     AND public.has_active_confirm_mandate(auth.uid(), OLD.receiver_id)
  THEN
    RETURN NEW;
  END IF;
  -- Everyone else (accountant) — protected columns.
  IF (NEW.total_ex_btw        IS DISTINCT FROM OLD.total_ex_btw)        OR
     (NEW.btw_amount          IS DISTINCT FROM OLD.btw_amount)          OR
     (NEW.total_inc_btw       IS DISTINCT FROM OLD.total_inc_btw)       OR
     (NEW.invoice_date        IS DISTINCT FROM OLD.invoice_date)        OR
     (NEW.due_date            IS DISTINCT FROM OLD.due_date)            OR
     (NEW.sender_id           IS DISTINCT FROM OLD.sender_id)           OR
     (NEW.receiver_id         IS DISTINCT FROM OLD.receiver_id)         OR
     (NEW.direction           IS DISTINCT FROM OLD.direction)           OR
     (NEW.status              IS DISTINCT FROM OLD.status)              OR
     (NEW.amount_paid         IS DISTINCT FROM OLD.amount_paid)         OR
     (NEW.payment_method      IS DISTINCT FROM OLD.payment_method)      OR
     (NEW.payment_date        IS DISTINCT FROM OLD.payment_date)        OR
     (NEW.marked_paid_at      IS DISTINCT FROM OLD.marked_paid_at)      OR
     (NEW.payment_prepared_at IS DISTINCT FROM OLD.payment_prepared_at) OR
     (NEW.pay_token           IS DISTINCT FROM OLD.pay_token)           OR
     (NEW.invoice_number      IS DISTINCT FROM OLD.invoice_number)      OR
     (NEW.invoice_type        IS DISTINCT FROM OLD.invoice_type)        OR
     -- [SEC] Deze drie stonden in accountant_write_holes.sql en zijn hier bij het overnemen van
     -- de lijst weggevallen. CREATE OR REPLACE vervangt het hele lichaam, dus dit bestand
     -- BEPAALDE daarmee — zonder waarschuwing — wat een gemachtigde boekhouder mocht herschrijven.
     -- Ze staan hier terug zodat dit bestand in elke volgorde veilig is om opnieuw te draaien;
     -- accountant_amount_guard_restore.sql is wat de live database heeft hersteld.
     --
     -- vendor_iban        het rekeningnummer waar de ondernemer naartoe betaalt, EN de referentie
     --                    waartegen de IBAN-wisselcontrole de volgende factuur afzet.
     -- payment_reference  het kenmerk dat hij bij die betaling overneemt.
     -- document_id        welk bewijsstuk onder deze factuur hangt.
     (NEW.vendor_iban         IS DISTINCT FROM OLD.vendor_iban)         OR
     (NEW.payment_reference   IS DISTINCT FROM OLD.payment_reference)   OR
     (NEW.document_id         IS DISTINCT FROM OLD.document_id)         OR
     -- [VRIJGESTELD] vat_deduction verzet rubriek 5b van de klant met het volledige btw_amount van
     -- de factuur: 'direct_exempt' schuift de voorbelasting van aftrekbaar naar geblokkeerd, en
     -- andersom net zo makkelijk. Hij stond in GEEN enkele versie van deze lijst. Hij staat in élke
     -- herdefinitie omdat in deze map niet vast te stellen is welke als laatste draait — één oude
     -- die na de nieuwe draait zou hem anders weer uit de bescherming halen.
     (NEW.vat_deduction       IS DISTINCT FROM OLD.vat_deduction)
  THEN
    RAISE EXCEPTION
      'Permission denied: only the invoice owner can modify amounts, dates, status or payment fields (invoice_id: %)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_accountant_amount_changes ON public.invoices;
CREATE TRIGGER prevent_accountant_amount_changes
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_accountant_amount_changes();

-- =====================================================================
-- CONTROLE — draai dit blok NA de migratie.
-- =====================================================================
-- 1) Staat alles er?
--    SELECT (SELECT count(*) FROM information_schema.columns
--             WHERE table_name='accountant_invoice_mandates' AND column_name='kind')  AS soort,
--           (SELECT count(*) FROM information_schema.columns
--             WHERE table_name='invoices' AND column_name='confirmed_by')             AS wie,
--           (SELECT count(*) FROM pg_proc WHERE proname='has_active_confirm_mandate') AS fn;
--    Verwacht: 1, 1, 1.
--
-- 2) Bestaande machtigingen zijn 'facturen' geworden en niets anders:
--    SELECT kind, count(*) FROM public.accountant_invoice_mandates GROUP BY kind;
--    Verwacht: alleen 'facturen'.
--
-- 3) De vier policies van de twee machtigingen samen:
--    SELECT policyname FROM pg_policies WHERE schemaname='public'
--     AND policyname LIKE '%mandate%' ORDER BY 1;
--    Verwacht: invoice_lines_mandate_read, invoices_mandate_confirm_read,
--              invoices_mandate_confirm_write, invoices_mandate_draft_issue,
--              invoices_mandate_draft_read.
--
-- 4) Een factuurmandaat geeft GEEN bevestigrecht:
--    SELECT public.has_active_confirm_mandate('<boekhouder>', '<klant>');  -- verwacht: f
