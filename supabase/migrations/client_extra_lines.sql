-- supabase/migrations/client_extra_lines.sql
-- [KLANT-EXTRA] Two free lines directly under the customer's name on an invoice.
--
-- WHY
-- The customer block carries a name, an address and a btw number, and for a great many real
-- invoices that is not enough to get the document to the right desk:
--
--     Stichting Contour
--     t.a.v. mevrouw Jansen          <- who it is for
--     Afdeling Inkoop / PO-2026-114  <- the reference their system needs to pay it
--     Spoorlaan 444
--     5038 CB Tilburg
--
-- Larger customers delay or refuse invoices that arrive without their own reference, and until now
-- the only place to put one was a line description — where it becomes part of WHAT WAS SUPPLIED,
-- which it is not.
--
-- WHY ON invoices AND NOT ON clients
-- A purchase-order reference is different on every invoice, so it belongs to the document. These
-- columns sit beside client_name / client_address / client_btw_number, which are already the
-- document's own snapshot of the customer rather than a link to the customer record. A standing
-- addressee that repeats on every invoice for one customer would belong on public.clients, and is
-- deliberately NOT what this is.
--
-- WHY TWO AND NOT A t.a.v. FIELD
-- The second line is a reference at one customer, a building at another and a cost centre at a
-- third. A column named after one of those is wrong for the other two.
--
-- Safe to apply at any time. Nullable, no default, no backfill: every existing invoice keeps
-- exactly the document it renders now, because both lines empty renders nothing at all. The app
-- also works BEFORE this is applied — the write falls back to one without these two fields (see
-- writeWithExtraLines in src/lib/client-extra-lines-write.ts), so a missing migration costs the
-- two lines and never an invoice.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS client_extra_line1 text,
  ADD COLUMN IF NOT EXISTS client_extra_line2 text,
  -- [KLANT-EXTRA-3] Een derde regel, toegevoegd nadat de eerste twee al waren toegepast. Daarom
  -- staat hij in DIT bestand en niet in een tweede migratie: ADD COLUMN IF NOT EXISTS is
  -- idempotent, dus opnieuw draaien voegt alleen de ontbrekende kolom toe en laat de twee die er
  -- al zijn ongemoeid. Eén bestand dat de hele vorm van dit blok beschrijft leest beter dan twee
  -- die je naast elkaar moet leggen om te weten hoeveel regels er zijn.
  ADD COLUMN IF NOT EXISTS client_extra_line3 text,
  -- [KLANT-EXTRA-4] A fourth line, same argument as the third: ADD COLUMN IF NOT EXISTS is
  -- idempotent, so re-running this one file only adds what is missing. One file describing the
  -- whole shape of the block beats a trail of one-line migrations.
  ADD COLUMN IF NOT EXISTS client_extra_line4 text;

COMMENT ON COLUMN public.invoices.client_extra_line1 IS
  'Vrije regel direct onder de klantnaam op het document, bijvoorbeeld "t.a.v. mevrouw Jansen". '
  'Leeg is de normale toestand: dan staat er niets en schuift het adres gewoon door.';

COMMENT ON COLUMN public.invoices.client_extra_line2 IS
  'Tweede vrije regel onder de klantnaam, bijvoorbeeld een afdeling, kostenplaats of '
  'inkoopordernummer dat de klant op de factuur wil zien staan.';

COMMENT ON COLUMN public.invoices.client_extra_line3 IS
  'Derde vrije regel onder de klantnaam. Alle regels zijn optioneel en lege regels vallen weg, '
  'zodat het adresblok nooit een gat krijgt waar een regel had kunnen staan.';

COMMENT ON COLUMN public.invoices.client_extra_line4 IS
  'Vierde vrije regel onder de klantnaam — zelfde regels als de eerste drie: optioneel, '
  'leeg valt weg, en hij reist mee naar creditnota, duplicaat en terugkerende factuur.';
