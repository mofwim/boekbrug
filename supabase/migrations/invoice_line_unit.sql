-- supabase/migrations/invoice_line_unit.sql
-- [UNIT] De eenheid van een factuurregel — één kolom, en het gat dat hij dicht is groter
-- dan hij eruitziet.
--
-- WAT ER MIS WAS
-- De artikelencatalogus (public.artikelen) heeft al jaren een `unit`-veld: uur, m², stuk. Maar
-- invoice_lines heeft die kolom NIET, dus op het moment dat een artikel op een factuur belandt,
-- valt de eenheid eraf. Gevolg:
--
--   · op de PDF staat "2" waar "2 uur" hoort te staan;
--   · in de e-factuur (UBL/Peppol) schreef de export unitCode="C62" op ELKE regel. C62 betekent
--     "one / stuk". Twee uur arbeid ging dus de deur uit als "2 stuks", veertien m² schilderwerk
--     als "14 stuks".
--
-- Het BEDRAG klopte altijd — quantity × unit_price verandert hier niet door. Maar de e-factuur
-- beschreef iets anders dan er geleverd was, en dat is het document dat telt bij een controle of
-- een geschil. Peppol BIS Billing 3.0 eist bovendien een code uit UN/ECE Recommendation 20;
-- "alles is een stuk" is geen geldige invulling van die eis, alleen een die niet opvalt.
--
-- WAT DEZE MIGRATIE WEL EN NIET DOET
-- Eén nullable tekstkolom. Geen enkele bestaande rij verandert, geen bedrag wordt herrekend, en
-- een lege eenheid blijft precies doen wat hij nu doet: terugvallen op C62 (zie
-- src/lib/units.ts). De code werkt ook ZONDER deze migratie — de schrijfactie valt dan terug
-- op een regel zonder eenheid, net als bij created_by. Wat je zonder deze kolom mist is de
-- juiste code op nieuwe facturen, niet het factureren zelf.
--
-- Idempotent. Draait veilig meerdere keren.

ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS unit text;

COMMENT ON COLUMN public.invoice_lines.unit IS
  '[UNIT] De eenheid zoals de ondernemer hem koos (uur, m², stuk, km). Vertaald naar een UN/ECE Rec 20-code bij de UBL-export — zie src/lib/units.ts. NULL = geen eenheid, wat neerkomt op C62 (stuk), precies zoals het gedrag vóór deze kolom.';

-- =====================================================================
-- CONTROLE — draai dit blok NA de migratie.
-- =====================================================================
-- 1) Staat de kolom er?
--    SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='invoice_lines' AND column_name='unit';
--    Verwacht: 1.
--
-- 2) Is er niets veranderd aan wat er al stond? Elke bestaande regel hoort NULL te hebben.
--    SELECT count(*) AS met_eenheid FROM public.invoice_lines WHERE unit IS NOT NULL;
--    Verwacht: 0 direct na de migratie. Daarna groeit dit alleen met NIEUWE regels.
--
-- 3) En de sluitende: is er geen bedrag aangeraakt? Deze hoort altijd leeg te zijn.
--    SELECT id, quantity, unit_price, line_total
--      FROM public.invoice_lines
--     WHERE line_total IS NOT NULL
--       AND round(line_total::numeric, 2) <> round((quantity * unit_price)::numeric, 2)
--     LIMIT 20;
--    Verwacht: 0 rijen. Staat hier iets, dan komt dat NIET van deze migratie (die raakt geen
--    bedragen aan) maar was het er al — meld het dan, want dan klopt een factuurtotaal niet.
-- =====================================================================
