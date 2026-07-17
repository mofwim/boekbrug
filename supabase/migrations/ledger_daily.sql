-- [LEDGER-DAILY] Corner 3 of the reconciliation triangle — the bookkeeper's grootboek
-- export (Kiwi "OVERZICHT"/"KASBOEK" per account: 550100 = PIN, 570000 = kas). These are
-- the SAME gross figures the till already records, so they are a CROSS-CHECK WITNESS only:
-- a per-day gross that reconcileTriangle compares against the till's PIN (Leg A). It is NEVER
-- booked as revenue or cost — the triangle raises a break when the ledger disagrees with the
-- till, nothing more. Money still comes solely from daily_turnover / invoices / cash_entries.
--
-- Opt-in by use: an owner who never uploads a grootboek export never creates a row and never
-- sees a ledger break. Non-breaking: a new table only.
--
-- One row per (user, day, kind): a re-import of the same account+day UPDATES (idempotent),
-- so re-uploading a corrected export never duplicates a witness.

CREATE TABLE IF NOT EXISTS public.ledger_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ledger_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pin', 'cash', 'bank', 'other')), -- LedgerKind
  received numeric NOT NULL DEFAULT 0,   -- gross "Ontvangen" for the day (always ≥ 0 in practice)
  spent numeric NOT NULL DEFAULT 0,      -- gross "Uitgaven" for the day
  account_nr text,                       -- "Rekening Nr:" (550100 / 570000 / …) for traceability
  source text NOT NULL DEFAULT 'ledger_xlsx',
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL, -- optional raw evidence file
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Idempotent re-import: the same account KIND on the same day updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_daily_unique_day_kind
  ON public.ledger_daily (user_id, ledger_date, kind);

CREATE INDEX IF NOT EXISTS idx_ledger_daily_user_date
  ON public.ledger_daily (user_id, ledger_date DESC);

ALTER TABLE public.ledger_daily ENABLE ROW LEVEL SECURITY;

-- Owner-only, same shape as cash_entries. The service-role pipeline (accountant read path,
-- result route) bypasses RLS and scopes by user_id in the query, exactly like daily_turnover.
DROP POLICY IF EXISTS ledger_daily_select_own ON public.ledger_daily;
CREATE POLICY ledger_daily_select_own ON public.ledger_daily
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS ledger_daily_insert_own ON public.ledger_daily;
CREATE POLICY ledger_daily_insert_own ON public.ledger_daily
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS ledger_daily_update_own ON public.ledger_daily;
CREATE POLICY ledger_daily_update_own ON public.ledger_daily
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS ledger_daily_delete_own ON public.ledger_daily;
CREATE POLICY ledger_daily_delete_own ON public.ledger_daily
  FOR DELETE TO authenticated USING (user_id = auth.uid());
