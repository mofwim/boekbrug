-- [BANK-TX-SOURCE-ID] Give a stored bank transaction the identity its source already gave it.
--
-- WHY
-- Dedup was content-based only: date + amount + normalized name + reference. That is a GUESS,
-- and it was the ONLY defence. It has two failure modes that no amount of tuning removes:
--
--   1. It cannot be enforced. The import reads "what is already stored", decides, then writes.
--      Two writers in that window — an upload while the daily cron sync runs — both read an
--      empty result and both insert. Nothing in the database says no.
--   2. It moves when the parser moves. Improve how a reference is derived (as we just did for
--      MT940) and yesterday's stored fingerprint no longer matches today's incoming one, so a
--      re-upload of a statement already imported inserts it a second time.
--
-- Yet the bank had already solved this. Measured on one real ING quarter, 576 transactions:
--
--   MT940  :61: bank reference   576 present, 576 DISTINCT
--   CAMT   <NtryRef>             576 present, 576 DISTINCT
--
-- A perfect key, per format — and the parser has been reading it into BankTransaction.transactionId
-- all along, only for mapToRows to drop it on the floor.
--
-- WHAT THIS DOES NOT SOLVE, and why the fingerprint stays
-- The same 576 transactions carry a DIFFERENT id in each format. Overlap between the MT940 ids and
-- the CAMT ids: ZERO. ING does not name a transaction the same way twice. So this key settles
-- "the same file/feed delivered this line again" with certainty, and says nothing at all about
-- "the same payment arrived through a different door" — that remains the content fingerprint's
-- job (bank-import.ts) and the reason bank-parity.test.ts exists.
--
-- WHY (user_id, source, external_id) AND NOT (user_id, external_id)
-- `source` is "<door>:<account>" — e.g. "MT940:NL02ABNA0123456789", "enablebanking:<account uid>".
-- The id is only promised unique WITHIN one bank's one export of one account. Two linked accounts,
-- or the same quarter downloaded in two formats, must never collide into one row.
--
-- WHY A PLAIN UNIQUE AND NOT A PARTIAL ONE
-- Postgres treats NULLs as distinct, so every row already in the table (source NULL, external_id
-- NULL) stays legal and no backfill is needed — and so does any future row whose source carries no
-- id (147 of the 576 feed rows have no entry_reference). A plain constraint also stays inferrable
-- by ON CONFLICT, which a partial one is not through PostgREST — and that inference is what lets
-- the import degrade a raced duplicate into "skipped" instead of losing the whole batch.
--
-- Idempotent: safe to run more than once.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS source      text,
  ADD COLUMN IF NOT EXISTS external_id text;

COMMENT ON COLUMN public.bank_transactions.source IS
  'Which door and which account delivered this row: "<door>:<account>", e.g. "MT940:NL02ABNA0123456789" or "enablebanking:<account uid>". Scopes external_id; never shown to the owner.';
COMMENT ON COLUMN public.bank_transactions.external_id IS
  'The id the SOURCE gave this transaction (MT940 :61: bank reference, CAMT <NtryRef>, feed entry_reference). Unique within one source only — the formats do not agree with each other.';

-- The backstop the application-level dedup never had. NULLs are distinct, so this constrains only
-- rows that actually carry an identity.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bank_tx_source_identity
  ON public.bank_transactions (user_id, source, external_id);

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- Expected: both columns present, and the unique index present + is_unique = true.
--
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'bank_transactions'
--       AND column_name IN ('source','external_id'))                        AS new_columns,   -- 2
--   (SELECT count(*) FROM pg_indexes
--     WHERE schemaname = 'public' AND indexname = 'uniq_bank_tx_source_identity') AS idx,      -- 1
--   (SELECT i.indisunique FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--     WHERE c.relname = 'uniq_bank_tx_source_identity')                     AS is_unique;     -- true
--
-- And to see it doing its job after the next import (expect: no row where a source identity
-- repeats — this must come back EMPTY):
--
-- SELECT user_id, source, external_id, count(*)
--   FROM public.bank_transactions
--  WHERE source IS NOT NULL AND external_id IS NOT NULL
--  GROUP BY 1,2,3 HAVING count(*) > 1;
