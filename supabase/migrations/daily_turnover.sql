-- [TURNOVER] Phase 1 — daily till/POS turnover (dagomzet) as a FIRST-CLASS revenue
-- source for retail owners, split by BTW rate. A shop's real revenue is the daily
-- Z-report (kassa), NOT a handful of invoices: one day mixes 0% / 9% / 21% turnover
-- across several payment methods (pin / contant / overig). This table holds that split
-- so the result engine can count revenue PER RATE and RECONCILE it against the bank's
-- pos_income settlements and the cash book — the three witnesses of the same money.
--
-- Opt-in by use: a ZZP owner never creates a daily_turnover row and is fully unaffected
-- (mirrors cash_ledger.sql). Non-breaking: a NEW table only.
--
-- De-dup discipline (see src/lib/turnover.ts + src/lib/financial-result.ts): when a day
-- has a turnover row, THAT is the revenue; the bank's pos_income and the cash-book omzet
-- for the same day become reconciliation witnesses (excluded from revenue) — the money
-- is never counted twice. Exactly mirrors the existing "bank line with invoice_id → it's
-- a payment, not a second revenue" rule.

CREATE TABLE IF NOT EXISTS public.daily_turnover (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  turnover_date date NOT NULL,
  -- Net taxable base per Dutch BTW rate (excl. BTW), straight from the Z-report
  -- ("Base TC 0/9/21%"). 0% carries no BTW, so it has no btw_ column.
  base_0  numeric NOT NULL DEFAULT 0,
  base_9  numeric NOT NULL DEFAULT 0,
  base_21 numeric NOT NULL DEFAULT 0,
  btw_9   numeric NOT NULL DEFAULT 0,
  btw_21  numeric NOT NULL DEFAULT 0,
  total_incl numeric,                  -- gross turnover as printed (cross-check only)
  -- Payment-method split — the reconciliation keys against bank pos_income + cash book.
  pin_amount   numeric,
  cash_amount  numeric,
  other_amount numeric,
  source text NOT NULL DEFAULT 'z_report' CHECK (source IN ('z_report', 'manual')),
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL, -- raw Z-report file
  created_at timestamp with time zone DEFAULT now(),
  -- One turnover row per day per owner (a day has exactly one Z-report). A re-import of
  -- the same day UPDATEs rather than duplicating.
  CONSTRAINT daily_turnover_unique_day UNIQUE (user_id, turnover_date)
);

ALTER TABLE public.daily_turnover ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_turnover_select_own ON public.daily_turnover
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY daily_turnover_insert_own ON public.daily_turnover
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY daily_turnover_update_own ON public.daily_turnover
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY daily_turnover_delete_own ON public.daily_turnover
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_daily_turnover_user_date
  ON public.daily_turnover (user_id, turnover_date DESC);
