-- supabase/migrations/invoice_line_discount.sql
-- [REGEL-KORTING] Een korting op ÉÉN regel — een percentage of een bedrag.
--
-- WAAROM NAAST DE KORTING DIE ER AL IS
-- invoice_discount.sql zet een korting op de HELE factuur. Dat is de korting die je geeft ("10%
-- voor een vaste klant"), en hij wordt pro rata over de btw-tarieven verdeeld. Wat hij niet kan
-- is het gewone geval van een handelsfactuur: drie regels vol tarief en één regel met 20% eraf,
-- omdat juist dat artikel in de aanbieding is. Dat is een korting op de REGEL, hij hoort bij het
-- artikel en niet bij het document, en hij staat zo ook op elke professionele factuur.
--
-- De twee stapelen, in deze volgorde: eerst de regelkortingen (die bepalen wat de regel waard
-- is), daarna de documentkorting over wat er dan overblijft. Dat is de volgorde die EN 16931
-- voorschrijft — een regelkorting is BG-27 en verlaagt BT-131, en de documentkorting (BG-20)
-- werkt op de som van die verlaagde regelbedragen.
--
-- WAT ER IN line_total KOMT TE STAAN, EN WAAROM DAT DE VEILIGE KANT IS
-- Het NETTO bedrag: aantal × prijs MIN de regelkorting. Niet het brutobedrag.
--
-- Dat is met opzet de kant waarop een vergissing niets kost. Elke lezer die deze twee kolommen
-- nooit leert kennen — een oud scherm, een export, een rapportage, de aangifte — telt line_total
-- op en komt op het juiste bedrag uit. Andersom (bruto bewaren, korting door de lezer laten
-- aftrekken) betekent dat iedere lezer die de kolommen mist de klant TE VEEL in rekening brengt,
-- en dat op een genummerd document. Eén vergeten lezer is dan een factuur die te hoog is.
--
-- Het percentage zelf blijft daarnaast staan, om dezelfde reden als bij de documentkorting: "20%"
-- en "€ 12,50" zijn vandaag hetzelfde bedrag en morgen niet. Zonder het afgesproken getal is de
-- regel niet te reproduceren zodra het aantal verandert.
--
-- ZONDER DEZE MIGRATIE BLIJFT ALLES WERKEN
-- De schrijfroutes vallen terug op een regel zonder korting (dezelfde terugval als `unit` en
-- `vat_treatment`), en parseDiscount geeft dan null: de rekensom is letterlijk die van hiervoor.
-- Wat je mist is de mogelijkheid om een regelkorting te GEVEN, niet het factureren.
--
-- Idempotent. Draait veilig meerdere keren.

ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS discount_type text,
  ADD COLUMN IF NOT EXISTS discount_value numeric;

-- Alleen de twee spellingen die de app kent, of niets. Een derde waarde zou door een route worden
-- geaccepteerd en door elke lezer anders geraden — dezelfde CHECK als op de factuurkop, want het
-- is hetzelfde begrip en het zou niet aan de kolom mogen liggen welke waarden geldig zijn.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_discount_type_check'
  ) THEN
    ALTER TABLE public.invoice_lines
      ADD CONSTRAINT invoice_lines_discount_type_check
      CHECK (discount_type IS NULL OR discount_type IN ('percent', 'amount'));
  END IF;
END $$;

-- Een korting is positief, en een percentage gaat niet boven de honderd. Nul is geen korting: die
-- zou "Korting 0%" onder een regel van een klant zetten, en de app slaat hem daarom niet op
-- (parseDiscount geeft null). De CHECK zorgt dat ook een andere schrijver dat niet kan.
--
-- Boven de 100% is geen grote korting maar een negatieve regel met een vriendelijk woord ervoor:
-- de klant zou geld TOE krijgen op een regel die iets levert. Wie geld terug moet, krijgt een
-- creditnota — een ander document, uit een andere reeks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_discount_value_check'
  ) THEN
    ALTER TABLE public.invoice_lines
      ADD CONSTRAINT invoice_lines_discount_value_check
      CHECK (
        discount_value IS NULL
        OR (discount_value > 0 AND (discount_type <> 'percent' OR discount_value <= 100))
      );
  END IF;
END $$;

COMMENT ON COLUMN public.invoice_lines.discount_type IS
  '[REGEL-KORTING] percent | amount | NULL. Zie src/lib/invoice-discount.ts.';
COMMENT ON COLUMN public.invoice_lines.discount_value IS
  '[REGEL-KORTING] Het AFGESPROKEN getal (20 voor 20%, of euro''s excl. btw). Het uitgerekende '
  'bedrag staat niet hier: line_total is al netto.';
