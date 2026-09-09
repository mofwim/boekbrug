-- [BESTE] When the customer first opened the pay or offerte page.
--
-- Written once by the public page (first-view.ts, under IS NULL), shown on the invoice as
-- "Bekeken door de klant op …". Nullable: an invoice sent on paper or by mail is never viewed
-- through a link, and null must read as "not known", never as "not viewed".
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS first_viewed_at timestamptz;
COMMENT ON COLUMN public.invoices.first_viewed_at IS
  '[BESTE] First time the customer opened the pay or offerte page. Stamped once; null = unknown.';
