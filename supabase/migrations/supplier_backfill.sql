-- [SUPPLIER-REGISTRY backfill] Seed suppliers from EXISTING incoming invoices that print an IBAN
-- (the strong identity), link invoices.supplier_id, and unify the displayed client_name to one
-- canonical name per supplier — so the current "same company, many spellings" mess is cleaned up,
-- not just fixed going forward.
--
-- SCOPE (deliberately conservative): only ACTIVE incoming invoices (status processing/received —
-- the review queue + unpaid crediteuren). Settled history (paid/archived) is left byte-for-byte
-- intact. Name-only suppliers (no printed IBAN) are NOT backfilled here — SQL cannot replicate the
-- app's vendorCoreKey normalization — but they converge automatically as new invoices import
-- through resolveSupplierForImport.
--
-- Idempotent: ON CONFLICT DO NOTHING on the suppliers upsert, and the UPDATE only touches rows
-- whose supplier_id is still NULL. Safe to re-run.

-- 1. Canonical name per (user, IBAN): the most RECENT non-empty client_name for that account.
WITH normalized AS (
  SELECT
    receiver_id AS user_id,
    upper(regexp_replace(coalesce(vendor_iban, ''), '\s', '', 'g')) AS iban_key,
    client_name,
    created_at
  FROM public.invoices
  WHERE direction = 'incoming'
    AND status IN ('processing', 'received')
    AND receiver_id IS NOT NULL
    AND vendor_iban IS NOT NULL
    AND length(regexp_replace(coalesce(vendor_iban, ''), '\s', '', 'g')) >= 15
),
canon AS (
  SELECT DISTINCT ON (user_id, iban_key)
    user_id, iban_key, client_name AS canonical_name
  FROM normalized
  WHERE client_name IS NOT NULL AND btrim(client_name) <> ''
  ORDER BY user_id, iban_key, created_at DESC
)
INSERT INTO public.suppliers (user_id, name, name_key, iban)
SELECT user_id, canonical_name, NULL, iban_key
FROM canon
ON CONFLICT (user_id, iban) WHERE iban IS NOT NULL DO NOTHING;

-- 2. Link each active incoming invoice to its supplier and unify the display name.
UPDATE public.invoices AS inv
SET supplier_id = s.id,
    client_name = s.name
FROM public.suppliers AS s
WHERE s.user_id = inv.receiver_id
  AND s.iban = upper(regexp_replace(coalesce(inv.vendor_iban, ''), '\s', '', 'g'))
  AND inv.direction = 'incoming'
  AND inv.status IN ('processing', 'received')
  AND inv.vendor_iban IS NOT NULL
  AND length(regexp_replace(coalesce(inv.vendor_iban, ''), '\s', '', 'g')) >= 15
  AND inv.supplier_id IS NULL;
