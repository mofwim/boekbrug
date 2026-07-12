-- [CASH-LEDGER] Phase 2 — the cash book (kasadministratie) as a second source for the
-- same financial-identity model. Cash is a separate ledger from the bank; money that
-- MOVES between them (storting / opname) is category 'transfer' on both sides, so it
-- nets out and is never counted as revenue or cost.
--
-- Opt-in by use: a bank-only owner never creates a cash_entry and never sees the Kas
-- surfaces. Non-breaking: a new table only.

CREATE TABLE IF NOT EXISTS public.cash_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  amount numeric NOT NULL CHECK (amount >= 0),   -- always positive; direction gives the sign
  category text NOT NULL,                          -- same vocab: omzet|kosten|prive|transfer|tax|fee
  description text,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL, -- optional linked bon
  btw_rate numeric,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.cash_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_entries_select_own ON public.cash_entries
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY cash_entries_insert_own ON public.cash_entries
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY cash_entries_update_own ON public.cash_entries
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY cash_entries_delete_own ON public.cash_entries
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_cash_entries_user_date
  ON public.cash_entries (user_id, entry_date DESC);
