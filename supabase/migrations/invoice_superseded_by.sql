-- [SUPERSEDE] Which invoice replaced this one?
--
-- A supplier invoices the wrong amount, corrects it, and re-sends. Both copies arrive. Since
-- [DEDUP-CORRECTED] the verify queue flags that ("zelfde factuurnummer, ander bedrag"), but the
-- owner then had to go to another screen, find the old one, and remove it there. Two screens and
-- a good memory for what is really one answer: "this one replaces that one".
--
-- That action ARCHIVES the old invoice — never a real delete; the retention obligation (art. 52
-- AWR) keeps the record for seven years. But an archived row with no explanation is exactly the
-- problem invoice_archive_reason.sql described: three months later there is an amount sitting in
-- Genegeerd and nobody remembers why. archive_reason='dubbel' states the CATEGORY; this column
-- states WHICH:
--
--   superseded_by_number — the invoice number of the document that replaced this one.
--
-- Deliberately the NUMBER and not the id, exactly as replaced_by_number already does: the screen
-- that renders "Vervangen door 20260457" sits in a list and must not do a join per row. The exact
-- id link, both ways, lives in the audit log (invoice.superseded) where it belongs — that is the
-- record of who did what, when.
--
-- Deliberately NULLABLE, no default, and with no influence on money: no financial query reads it,
-- archiving stays archiving, and restoring keeps working. It is a note. When the invoice is
-- restored the restore route clears it — an active invoice must never claim it was replaced.
--
-- APPLY: run this whole file in the Supabase SQL editor. Nothing here deletes data.
-- Idempotent / re-runnable.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS superseded_by_number text;

COMMENT ON COLUMN public.invoices.superseded_by_number IS
  '[SUPERSEDE] The invoice number of the invoice that replaced this one (a corrected re-issue from the same supplier). Only set on an archived row; the restore routes clear it again. A note for the screen - no financial calculation reads this column. The exact id link lives in the audit log.';

-- ── VERIFY ──────────────────────────────────────────────────────────────────────────────────
-- The column exists. Must be true.
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'superseded_by_number'
) AS has_superseded_by_number;
