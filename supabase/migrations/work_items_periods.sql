-- [CONTRACT] A schoonmaak contract billed per period, not per beurt.
--
-- A recurring opdracht row IS the contract on one location (locatie required, repeat_every, the
-- afgesproken uren, the beurten). Schoonsoft and CleanPlanner bill such a contract in one of two
-- ways: per beurt (what [WERK-BEURT] already does) or a fixed amount per period. The fixed amount
-- is a field (fields.maandbedrag, validated by werk.ts); WHICH periods have been invoiced is a
-- fact the row must carry, or a month could be billed twice. That fact lives here, beside the
-- beurten, in the same shape: the period and the invoice that covered it.
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS billed_periods jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.work_items.billed_periods IS
  '[CONTRACT] For repeating work billed per period: [{period: ''YYYY-MM'', invoice_id}]. '
  'Appended by /api/werk/[id]/factuur under an optimistic lock; never by hand.';

-- CONTROLE
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'work_items' and column_name = 'billed_periods';
