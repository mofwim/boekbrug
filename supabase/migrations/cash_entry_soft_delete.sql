-- supabase/migrations/cash_entry_soft_delete.sql
-- [KAS-ZACHT] A removed cash movement stops counting and stops disappearing.
--
-- Why this exists. Deleting a kasboek line was a HARD delete, and the cash book is the one ledger in
-- this administration where that is indefensible:
--
--   · it is the only ledger the owner writes BY HAND. A bank line is never destroyed, an archived
--     invoice is still a row with a status, a removed turnover day can be re-imported from the
--     Z-report it came from. A cash movement has no source document to re-read — someone typed it;
--   · and it is the ledger the app itself BLOCKS a BTW-aangifte on (readiness.ts,
--     /api/btw/file via loadDrawerWitness). A running balance that can lose a line without trace,
--     used as grounds to refuse a filing, is not a book anyone can check.
--
-- [KAS-SPOOR] already made the removal traceable: the audit row carries the movement's date, amount,
-- category and description, the kasboek panel and the accountant's .xlsx disclose it per quarter, and
-- the account export ships kas-spoor.json. That is evidence ABOUT the book. This is the book itself
-- keeping the line — which is what makes the removal reversible, and what an accountant means by a
-- correction: a real bookkeeping system reverses, it does not destroy.
--
-- ── WHAT THE COLUMN MEANS ──
--
-- deleted_at IS NULL      → a live movement. Counts everywhere it counted before.
-- deleted_at IS NOT NULL  → removed from the books. Counts NOWHERE: not in the drawer balance, not
--                           in the kasboek, not in the result, not in the aangifte, not in the
--                           readiness/filing witness, not in search, not in the accountant's sheet.
--                           It stays readable, and it stays in the owner's own export.
--
-- One exception, deliberate: the GDPR/portability export (account-export.ts) ships cash_entries
-- verbatim, deleted rows included, with their deleted_at visible. Everywhere else a removed line is
-- absent; there it must be present, because an export of "all your data" that silently drops rows is
-- the harm that file is written against.
--
-- ── DEPLOY ORDER ──
--
-- Code ships before a migration is applied by hand (docs/MIGRATIES_VOLGORDE.md), and here the naive
-- version does real damage in that window: filtering on a column that does not exist fails the read,
-- and the reads in question are the drawer balance, the kasboek, readiness and the filing gate. The
-- app would lose its cash administration on every screen at once.
--
-- So the capability is PROBED, not assumed (src/lib/cash-live.ts). Without this column the app behaves
-- exactly as it did before: no filter anywhere, and DELETE still removes the row. The day this SQL
-- lands, soft delete switches itself on — no second deploy.

-- ── PREREQUISITE ──
--
-- Run AFTER cash_settlement_invoice_link.sql and cash_settlement_per_instalment.sql. The index
-- rebuilt at the bottom is theirs, and it names invoice_id and settlement_id — on a database without
-- those columns this file fails on that statement, after the ALTER above has already succeeded.
-- (See docs/MIGRATIES_VOLGORDE.md; both are long applied in production.)

ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

COMMENT ON COLUMN public.cash_entries.deleted_at IS
  '[KAS-ZACHT] When this cash movement was removed from the books. NULL = live. A non-NULL row counts in NO total anywhere (drawer balance, kasboek, result, aangifte, readiness/filing witness, search, closing package) and is excluded by src/lib/cash-live.ts; it stays readable and is included verbatim in the owner''s account export.';

-- The index every read now needs. Partial, on the live rows only: that is what the queries ask for,
-- and it keeps the index the same size it was while removed rows accumulate behind it.
--
-- It mirrors the existing idx_cash_entries_user_date rather than replacing it: that one still serves
-- the export and any read that deliberately wants everything.
CREATE INDEX IF NOT EXISTS idx_cash_entries_user_date_live
  ON public.cash_entries (user_id, entry_date DESC)
  WHERE deleted_at IS NULL;

-- ── The idempotency guard has to learn about it too ──
--
-- cash_entries_one_settlement_per_instalment (cash_settlement_per_instalment.sql) makes a cash-paid
-- invoice's drawer movement unique per instalment. Without the deleted_at clause a REMOVED settlement
-- would keep occupying that slot: the reconcile, which sees only live rows, would find no entry for a
-- paid-in-cash invoice, try to create one, and hit the unique index forever. The invoice would then
-- stand as paid in cash with nothing in the drawer, and the insert error is caught and reported —
-- so it would be a permanent, silent gap of exactly the kind [KAS-STIL] exists to make audible.
--
-- Recreated WHERE deleted_at IS NULL so uniqueness applies among live rows only. A removed settlement
-- can then be re-created cleanly, which is the whole point of a reversal.
DROP INDEX IF EXISTS cash_entries_one_settlement_per_instalment;
CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_one_settlement_per_instalment
  ON public.cash_entries (invoice_id, coalesce(settlement_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE invoice_id IS NOT NULL AND deleted_at IS NULL;

-- RLS needs no change and that is worth stating rather than leaving to inference. Soft-deleting is an
-- UPDATE on the owner's own row, which cash_entries_update_own already allows (USING and WITH CHECK
-- both on user_id = auth.uid()), and the same policy is what would let a restore set it back to NULL.
-- The DELETE policy stays as well: it is still the path used before this column exists.

-- ── CONTROLE ──
--
-- Eén query. Ze moet drie regels teruggeven: de kolom, de partiële index op de live rijen, en de
-- unieke index die opnieuw is opgebouwd MÉT deleted_at in zijn voorwaarde. Staat die laatste er
-- zonder 'deleted_at' in de definitie, dan is de DROP/CREATE hierboven niet gedraaid en houdt een
-- verwijderde tegenboeking haar plek bezet — precies het stille gat dat hierboven wordt beschreven.
--
--   SELECT 'kolom' AS wat, column_name AS naam, data_type AS detail
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'cash_entries' AND column_name = 'deleted_at'
--   UNION ALL
--   SELECT 'index', indexname, indexdef
--     FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'cash_entries'
--      AND indexname IN ('idx_cash_entries_user_date_live', 'cash_entries_one_settlement_per_instalment')
--   ORDER BY wat, naam;
--
-- En daarna, als controle op de betekenis in plaats van op de vorm: dit hoort 0 te zijn zolang
-- niemand iets heeft verwijderd, en daarna precies het aantal regels dat uit de boeken is gehaald.
--
--   SELECT count(*) AS verwijderde_kasboekingen FROM public.cash_entries WHERE deleted_at IS NOT NULL;
