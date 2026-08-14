-- supabase/migrations/offerte_akkoord.sql
-- [OFFERTE-AKKOORD] De klant zegt ja of nee op een offerte, in het document zelf.
--
-- ── WAT ER ONTBRAK ──
-- Een offerte gaat als PDF de deur uit en het antwoord komt terug als een mailtje, een appje of
-- een telefoontje. Nergens in de app staat dan dat er ja is gezegd — niet wat er is afgesproken,
-- niet wanneer, en niet door wie. Bij een meningsverschil over wat er is besteld is er niets om
-- op terug te vallen dan iemands geheugen.
--
-- ── VIER KOLOMMEN, EN WAT ZE NIET DOEN ──
--
--   offerte_token          het geheim in de link. Wie hem heeft mag antwoorden — precies zoals
--                          pay_token werkt. Een EIGEN token en niet pay_token hergebruikt: dat
--                          zou één geheim twee dingen laten ontsluiten, en dan kan een link die
--                          is gedeeld om akkoord te geven ook een betaalpagina openen.
--   offerte_response       'accepted' of 'declined'. Meer smaken zijn er niet; "misschien" is een
--                          gesprek, geen toestand van een document.
--   offerte_responded_at   wanneer. Dit is het bewijs, en daarom een timestamptz en geen datum.
--   offerte_response_name  wie het intypte. Vrije tekst, want het is wat de persoon zelf zegt te
--                          zijn — de app kan het niet verifiëren en doet ook niet alsof.
--
-- Wat ze NIET doen: een factuur maken. Een geaccepteerde offerte is een sein aan de ondernemer,
-- geen factuur. Factureren verbruikt een nummer uit de doorlopende reeks (Art. 35 Wet OB) en dat
-- is onomkeerbaar; een nummer laten ontstaan door een klik van een DERDE is precies de macht die
-- deze app nergens weggeeft. Dezelfde grens als bij de terugkerende facturen: alles behalve de
-- laatste tik.
--
-- Ze veranderen ook de STATUS van de offerte niet. De rij blijft 'sent' tot de ondernemer hem
-- omzet of laat gaan — het antwoord is een feit dat erbij komt, geen overgang.
--
-- ── ANTWOORDEN NA DE GELDIGHEIDSDATUM MAG ──
-- Een offerte die gisteren verliep en vandaag wordt geaccepteerd is goed nieuws, geen fout. De
-- ondernemer is nergens aan gebonden — hij factureert immers zelf — dus weigeren zou werk
-- weggooien om een dag. Het antwoord wordt vastgelegd mét zijn datum; wie wil zien dat het laat
-- was, ziet het.
--
-- Idempotent. Draait veilig meerdere keren.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS offerte_token uuid,
  ADD COLUMN IF NOT EXISTS offerte_response text,
  ADD COLUMN IF NOT EXISTS offerte_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS offerte_response_name text;

-- Het token is de sleutel: hij moet uniek zijn, en de publieke route zoekt erop.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_offerte_token_key
  ON public.invoices (offerte_token)
  WHERE offerte_token IS NOT NULL;

-- Twee antwoorden, of geen. Een derde waarde zou door elke lezer anders worden geraden — dezelfde
-- klasse fout waar deze codebase het meest last van heeft gehad.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_offerte_response_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_offerte_response_check
      CHECK (offerte_response IS NULL OR offerte_response IN ('accepted', 'declined'));
  END IF;
END $$;

-- Een antwoord zonder tijdstip is geen bewijs, en een tijdstip zonder antwoord is ruis. Ze komen
-- samen of niet.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_offerte_response_paired_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_offerte_response_paired_check
      CHECK ((offerte_response IS NULL) = (offerte_responded_at IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.invoices.offerte_token IS
  '[OFFERTE-AKKOORD] Het geheim in de akkoordlink. Eigen token, nooit pay_token hergebruiken.';
COMMENT ON COLUMN public.invoices.offerte_response IS
  '[OFFERTE-AKKOORD] accepted | declined | NULL. Verandert de status van de offerte NIET en maakt '
  'geen factuur: nummeren blijft de tik van de ondernemer (Art. 35).';
