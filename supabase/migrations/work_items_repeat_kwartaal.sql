-- [WERK-3] A hovenier's onderhoud and a schoonmaak contract also come per kwartaal.
--
-- work_items_repeat.sql fixed the rhythm list in a CHECK; werk.ts (REPEATS) is the same list and
-- the [WERK] gate holds the two together. Adding a rhythm is therefore one line there and this
-- constraint here — never a text value the module does not know.
ALTER TABLE public.work_items DROP CONSTRAINT IF EXISTS work_items_repeat_every_check;
ALTER TABLE public.work_items ADD CONSTRAINT work_items_repeat_every_check
  CHECK (repeat_every IN ('week', 'twee_weken', 'vier_weken', 'maand', 'kwartaal'));

-- CONTROLE
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'work_items_repeat_every_check';
