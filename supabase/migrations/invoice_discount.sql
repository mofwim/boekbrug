-- supabase/migrations/invoice_discount.sql
-- [KORTING] Een korting op de hele factuur: een percentage of een bedrag.
--
-- WAAROM TWEE KOLOMMEN EN NIET ÉÉN BEDRAG
-- Het uitgerekende kortingsbedrag staat al in de totalen (total_ex_btw is de verlaagde grondslag).
-- Wat hier bewaard moet blijven is wat de ondernemer AFSPRAK: "10%" en "€ 200" zijn op deze
-- factuur hetzelfde bedrag en op de volgende niet. Alleen het bedrag bewaren maakt het document
-- onreproduceerbaar zodra er een regel bij komt — dan klopt het percentage op de PDF niet meer met
-- de bedragen eronder, en dat is precies het soort verschil dat een boekhouder niet kan uitleggen.
--
-- WAT HIER NIET STAAT
-- De verdeling over de btw-tarieven. Die is afgeleid (src/lib/invoice-discount.ts) en hoort niet
-- in de database: twee plekken die hetzelfde uitrekenen lopen uit elkaar, en de UBL-export en de
-- PDF moeten per definitie hetzelfde antwoord geven.
--
-- IDEMPOTENT: opnieuw draaien kan geen kwaad.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS discount_type text,
  ADD COLUMN IF NOT EXISTS discount_value numeric;

-- Alleen de twee spellingen die de app kent, of niets. Een derde waarde zou door een route worden
-- geaccepteerd en door elke lezer anders geraden — de klasse fout waar deze codebase het meest
-- last van heeft gehad (zie src/lib/skipped-import.ts).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_discount_type_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_discount_type_check
      CHECK (discount_type IS NULL OR discount_type IN ('percent', 'amount'));
  END IF;
END $$;

-- Een korting is positief. Nul is geen korting: die zou "Korting: € 0,00" op de factuur van een
-- klant zetten, en de app slaat hem daarom niet op (parseDiscount geeft null). De CHECK zorgt dat
-- ook een andere schrijver dat niet kan.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_discount_value_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_discount_value_check
      CHECK (
        discount_value IS NULL
        OR (discount_value > 0 AND (discount_type <> 'percent' OR discount_value <= 100))
      );
  END IF;
END $$;

-- De twee horen bij elkaar: een soort zonder waarde (of andersom) is een halve afspraak waar geen
-- lezer iets mee kan.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_discount_pair_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_discount_pair_check
      CHECK ((discount_type IS NULL) = (discount_value IS NULL));
  END IF;
END $$;
