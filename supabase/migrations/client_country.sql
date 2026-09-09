-- supabase/migrations/client_country.sql
-- [KLANT-LAND] The customer's country, on the customer and on the invoice's own snapshot of them.
--
-- WHY
-- This schema held no country for a customer anywhere, and three things turn on it:
--
--   · art. 35a lid 1 sub c Wet OB: the customer's address, which for a foreign customer includes
--     the country — a Dutch postcode and city are the whole address only in the Netherlands;
--   · the guard on a 0% invoice: a sale WITHOUT btw to a business in another member state is only
--     zero-rated with the customer's btw-identificatienummer on the document (art. 138 BTW-
--     richtlijn). Without a country the app could not tell a domestic 0% supply from an intra-EU
--     one, and refused nothing — the money audit's first sales finding;
--   · the ICP-opgaaf and, on the purchase side, rubriek 4a/4b, which today infer the country from
--     the btw-nummer's prefix and see nothing at all where there is no EU prefix (a UK, US or
--     Swiss supplier).
--
-- ISO 3166-1 alpha-2, upper case ('NL', 'DE', 'BE'), the code every e-invoice and the ICP use.
-- NULL means "not recorded" — read as the Netherlands by everything that has to decide, which is
-- exactly what every existing row was implicitly before this column existed.
--
-- WHY ON invoices TOO
-- client_name / client_address / client_btw_number are the document's own snapshot of the
-- customer, frozen when the invoice is made; the country belongs beside them for the same
-- reason: a customer who moves later must not change what an issued invoice says.
--
-- Safe to apply at any time. Nullable, no default, no backfill. The app works BEFORE it is
-- applied: the country is written in its own best-effort step and a missing column costs the
-- country, never a customer or an invoice.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS country text
  CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS client_country text
  CHECK (client_country IS NULL OR client_country ~ '^[A-Z]{2}$');

COMMENT ON COLUMN public.clients.country IS
  '[KLANT-LAND] ISO 3166-1 alpha-2 (NL, DE, BE). NULL = niet vastgelegd, gelezen als Nederland.';
COMMENT ON COLUMN public.invoices.client_country IS
  '[KLANT-LAND] De landcode van de klant zoals die op DIT document staat (momentopname, naast client_address).';
