-- [ENABLEBANKING] Keep updated_at true even for a write that forgets to.
--
-- WHY THIS IS DEFENCE AND NOT A REPAIR
--
-- The column is NOT stale today. Every write to these two tables goes through
-- enablebanking-connection.ts, and all six of them set updated_at explicitly — the status
-- change, the session attach, the sync watermark, the error record, the revoke, and the account
-- upsert. A review of the live schema found no BEFORE UPDATE trigger and reasonably inferred the
-- column would freeze at its insert time; it does not, because the application sets it.
--
-- So this trigger changes no value that is written correctly today. It exists because "the
-- application remembers" is a guarantee that expires the moment someone adds a seventh write —
-- a one-line status patch in a route, a repair script, a psql session during an incident. That
-- write would succeed, look right, and silently leave updated_at pointing at the day the row was
-- created. What it costs then is not money but the ability to answer questions later: when did
-- this consent last change, which connection went quiet first, what did support actually see.
--
-- The same reasoning the rest of this codebase applies to money rules: a rule that CAN be
-- forgotten eventually is. Postgres cannot forget.
--
-- There was no project-wide updated_at helper to reuse — other tables set the column inside their
-- own SQL functions — so this creates one. It is deliberately generic and owns nothing else, so a
-- later table can attach to it instead of growing a seventh copy of `updated_at = now()`.
--
-- Idempotent: safe to run more than once.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- NEW.updated_at is overwritten unconditionally on purpose. Honouring a caller-supplied value
  -- would reintroduce exactly the hole this closes: a write that passes a stale timestamp, or
  -- none at all, would keep it.
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'BEFORE UPDATE trigger: stamps updated_at with now(), unconditionally. Generic — attach it to any table carrying an updated_at column.';

DROP TRIGGER IF EXISTS set_bank_connections_updated_at ON public.bank_connections;
CREATE TRIGGER set_bank_connections_updated_at
  BEFORE UPDATE ON public.bank_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_bank_connection_accounts_updated_at ON public.bank_connection_accounts;
CREATE TRIGGER set_bank_connection_accounts_updated_at
  BEFORE UPDATE ON public.bank_connection_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- Expected: 2 rows, both tgenabled = 'O' (enabled, origin).
--
-- SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled
--   FROM pg_trigger t
--   JOIN pg_class c ON c.oid = t.tgrelid
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE NOT t.tgisinternal
--    AND n.nspname = 'public'
--    AND c.relname IN ('bank_connections','bank_connection_accounts')
--  ORDER BY 1, 2;
--
-- And to prove it fires (expect updated_at > created_at on the touched row):
--
-- UPDATE public.bank_connections SET last_error = last_error WHERE id = '<some id>';
-- SELECT id, created_at, updated_at, updated_at > created_at AS trigger_fired
--   FROM public.bank_connections WHERE id = '<some id>';
