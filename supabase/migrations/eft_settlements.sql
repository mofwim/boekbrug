-- [TRIANGLE] EFT terminal settlements — corner 2 of the card-takings reconciliation
-- triangle. A payment terminal prints a per-shift settlement receipt (Equens CTAP
-- "TOTALEN RAPPORT") with the acquirer's GROSS card total, split per card scheme. That
-- gross is the bridge between the till's gross PIN (daily_turnover) and the bank's NET
-- payout: till PIN == EFT gross (a break is a real discrepancy), and EFT gross − bank net
-- = the acquirer commission (a real cost the app previously discarded, overstating profit).
--
-- Opt-in by use, exactly like daily_turnover / cash_ledger: a store that never uploads a
-- terminal receipt has no rows here and is fully unaffected. Non-breaking — a NEW table.
--
-- Parsed by src/lib/eft-parser.ts; consumed by src/lib/triangle.ts + financial-result.ts.

CREATE TABLE IF NOT EXISTS public.eft_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The calendar takings day the shift belongs to (from the transaction timestamps, so a
  -- shift opening the evening before midnight books on the day its sales happened).
  settlement_date date NOT NULL,
  terminal_id text,                    -- TMS TERM-ID
  period_nr text,                      -- PERIODE NR (the shift/batch number)
  shift_nr text,
  period_start timestamptz,
  period_end timestamptz,
  first_trx timestamptz,
  last_trx timestamptz,
  gross_total numeric NOT NULL,        -- EFT TOTAAL — gross card sales for the shift
  tx_count integer NOT NULL DEFAULT 0,
  by_scheme jsonb,                     -- [{ scheme, count, amount }] per card scheme
  source text NOT NULL DEFAULT 'terminal_receipt' CHECK (source IN ('terminal_receipt', 'manual')),
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL, -- the receipt image/pdf
  created_at timestamp with time zone DEFAULT now(),
  -- One settlement per terminal-shift: a re-import of the same shift UPDATEs rather than
  -- duplicating. terminal_id + period_nr + settlement_date is the natural shift key.
  CONSTRAINT eft_settlements_unique_shift UNIQUE (user_id, terminal_id, period_nr, settlement_date)
);

ALTER TABLE public.eft_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY eft_settlements_select_own ON public.eft_settlements
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY eft_settlements_insert_own ON public.eft_settlements
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY eft_settlements_update_own ON public.eft_settlements
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY eft_settlements_delete_own ON public.eft_settlements
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_eft_settlements_user_date
  ON public.eft_settlements (user_id, settlement_date DESC);
