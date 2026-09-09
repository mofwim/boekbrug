-- [WERK-BEURT] Work that comes back: the weekly schoonmaak, the fortnightly garden.
--
-- The small planners these trades use (CleanPlanner, Schoonsoft, Buttons for Cleaners) make the
-- opdracht ONCE, let it repeat, tick a beurt off when it is done, and turn the done beurten into
-- one invoice — per beurt or per period. The row stays open; the invoice is stamped on the
-- beurten it covers, so a beurt can never be billed twice and the next one starts clean.
--
-- Two nullable columns on the same table, read by nothing that existed before. A werkorder or a
-- rit never sets repeat_every and never gets a beurt; werk.ts refuses both for a skin that does
-- not repeat.

ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS repeat_every text
    CHECK (repeat_every IN ('week', 'twee_weken', 'vier_weken', 'maand'));
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS visits jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.work_items.repeat_every IS
  '[WERK-BEURT] The rhythm of repeating work (week, twee_weken, vier_weken, maand); null for work that happens once.';
COMMENT ON COLUMN public.work_items.visits IS
  '[WERK-BEURT] The beurten done on repeating work: {on: date, note, invoice_id}. A beurt with an '
  'invoice_id is billed and never billed again. Validated by werk.ts.';

-- CONTROLE
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'work_items' and column_name in ('repeat_every', 'visits');
