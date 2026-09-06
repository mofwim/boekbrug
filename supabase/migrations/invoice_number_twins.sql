-- supabase/migrations/invoice_number_twins.sql
-- [HAND-DUBBEL] The other rows carrying the same invoice NUMBER as this one.
--
-- APPLY: run in the Supabase SQL editor. Creates one function. No data is read, written or moved
-- by applying it. Idempotent.
--
-- ── WHY A FUNCTION ──
-- The match is on the number with its separators removed: FAMZFOOD sent "26 / 1876" and the second
-- reading stored "26/1876". Those are one number and PostgREST cannot compare them — an equality
-- filter misses the pair, and there is no LIKE that catches both directions of a difference in
-- punctuation. So the normalisation happens where it is exact.
--
-- ── AND WHY IT DECIDES NOTHING ──
-- It NARROWS, it does not judge. Whether two rows are the same invoice also depends on the
-- supplier — numbers are unique per supplier, not across them — and that comparison folds legal
-- suffixes ("Enka Horeca B.V." = "Enka Horeca bv"). That rule already exists once, in
-- duplicate-payable.ts, and the caller applies it to what comes back. Restating it in SQL would be
-- a second definition of "the same invoice", and the copy that drifts is the one nobody reads.
--
-- Same owner and same direction only: a sales invoice and a purchase invoice sharing a number is a
-- coincidence between two companies, not a double booking.

CREATE OR REPLACE FUNCTION public.invoice_number_twins(
  p_owner      uuid,
  p_invoice_id uuid
)
RETURNS TABLE(
  id             uuid,
  invoice_number text,
  client_name    text,
  total_inc_btw  numeric,
  status         text,
  amount_paid    numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH self AS (
    SELECT i.direction,
           regexp_replace(lower(coalesce(i.invoice_number, '')), '[^a-z0-9]', '', 'g') AS nr
    FROM public.invoices i
    WHERE i.id = p_invoice_id
      AND (i.sender_id = p_owner OR i.receiver_id = p_owner)
  )
  SELECT o.id, o.invoice_number, o.client_name, o.total_inc_btw, o.status, o.amount_paid
  FROM public.invoices o, self
  WHERE o.id <> p_invoice_id
    AND (o.sender_id = p_owner OR o.receiver_id = p_owner)
    AND o.direction IS NOT DISTINCT FROM self.direction
    AND self.nr <> ''
    AND regexp_replace(lower(coalesce(o.invoice_number, '')), '[^a-z0-9]', '', 'g') = self.nr
  ORDER BY o.created_at;
$$;

-- SECURITY DEFINER because the route reads as the pipeline after proving ownership, and both the
-- owner arguments above scope every row to that owner. Locked to the service role for that reason:
-- the caller must be the server, never a browser.
REVOKE ALL ON FUNCTION public.invoice_number_twins(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.invoice_number_twins(uuid, uuid) IS
  'Andere rijen van deze eigenaar met HETZELFDE factuurnummer (leestekens genegeerd) en dezelfde richting. Alleen versmallen; of het werkelijk dezelfde factuur is beslist duplicate-payable.ts, want dat hangt ook aan de leverancier.';

-- ── CONTROLE ───────────────────────────────────────────────────────────────────
-- Enka Horeca 26701681 stond drie keer; twee daarvan zijn nu gearchiveerd:
--   SELECT * FROM public.invoice_number_twins(
--     'ac22189e-7052-4c48-b4ec-90947cf92ecc', 'bae447c6-aaf6-4e48-b542-9f430bc0537b');
-- En de leestekens-zaak, FAMZFOOD "26 / 1876" tegenover "26/1876":
--   SELECT * FROM public.invoice_number_twins(
--     'ac22189e-7052-4c48-b4ec-90947cf92ecc', '1b58f770-4529-48c9-bd55-c5a7b894f0e6');
