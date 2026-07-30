-- [SUPERSEDE] Welke factuur heeft deze vervangen?
--
-- Een leverancier factureert het verkeerde bedrag, corrigeert het, en stuurt de factuur opnieuw.
-- Beide komen binnen. De controlewachtrij vlagt dat sinds [DEDUP-CORRECTED] ("zelfde
-- factuurnummer, ander bedrag"), maar de eigenaar moest daarna zelf naar een ander scherm, de
-- oude opzoeken en hem daar weghalen. Twee schermen en een goed geheugen voor iets wat één
-- antwoord is: "deze vervangt die".
--
-- Die handeling archiveert de oude factuur — nooit een echte delete, de bewaarplicht (art. 52
-- AWR) houdt het stuk zeven jaar. Maar een gearchiveerde rij zonder uitleg is precies het
-- probleem dat invoice_archive_reason.sql beschreef: drie maanden later staat er een bedrag in
-- Genegeerd en niemand weet meer waarom. archive_reason='dubbel' zegt de CATEGORIE; deze kolom
-- zegt WELKE:
--
--   superseded_by_number — het factuurnummer van het stuk dat dit verving.
--
-- Bewust het NUMMER en niet de id, precies zoals replaced_by_number dat al doet: het scherm dat
-- "Vervangen door 20260457" toont staat in een lijst en mag daar geen join per rij voor doen. De
-- exacte id-koppeling van beide kanten staat in de audit-log (invoice.superseded), waar hij
-- thuishoort — dat is de plek die vertelt wie wat wanneer deed.
--
-- Bewust NULLABLE, geen default, en zonder enige invloed op geld: geen financiële query kijkt
-- hiernaar, archiveren blijft archiveren en terugzetten blijft werken. Het is een notitie. Wordt
-- de factuur teruggezet, dan wist de terugzet-route hem — een actieve factuur mag nooit beweren
-- dat hij vervangen is.
--
-- APPLY: draai dit hele bestand in de Supabase SQL editor. Niets hier verwijdert data.
-- Idempotent / opnieuw te draaien.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS superseded_by_number text;

COMMENT ON COLUMN public.invoices.superseded_by_number IS
  '[SUPERSEDE] Het factuurnummer van de factuur die deze verving (een gecorrigeerde herzending van dezelfde leverancier). Alleen gezet op een gearchiveerde rij; de terugzet-route wist hem weer. Een notitie voor het scherm — geen enkele financiele berekening leest deze kolom. De exacte id-koppeling staat in de audit-log.';

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- De kolom bestaat. Moet true zijn.
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'superseded_by_number'
) AS heeft_superseded_by_number;
