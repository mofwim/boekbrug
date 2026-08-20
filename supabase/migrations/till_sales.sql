-- =====================================================================
-- [KASSA] Per-sale detail for a shop that has no till.
-- BoekBrug · August 2026
-- =====================================================================
-- WHY: daily_turnover.source has allowed 'manual' since the table was created and no line of code
-- has ever written it — every caller passes 'z_report'. So an owner without a kassa (a barber, a
-- garage, a nail salon) had no door into the BTW-authoritative table at all.
--
-- That is not a missing convenience. His PIN revenue arrives over the bank as a pos_income line,
-- and bank_transactions carries NO btw_rate column — no screen anywhere can give a bank revenue
-- line a rate. financial-result counts it as revenue with no rate (cashOmzetZonderBtw), and
-- /api/btw/file BLOCKS the filing on precisely that signal. His own aangifte is held shut by money
-- he cannot classify.
--
-- ── THIS TABLE IS NOT A MONEY SOURCE ──
-- Read that again before adding a reader. The financial engines (financial-result, aangifte,
-- kasboek, readiness, the closing package) must NEVER read till_sales. It is the owner's per-sale
-- record — what was sold, to be able to see and correct today's takings — and it AGGREGATES into
-- exactly one daily_turnover row per day, which is the only thing the engines see.
--
-- The reason is [KAS-DUBBELTELLING], written up in kasboek.ts: a day's cash revenue that reaches
-- the books through two sources at once put a shop taking EUR 500 a day roughly EUR 45.000 above
-- reality inside one quarter. Both engines already suppress cash_entries omzet on a day that
-- daily_turnover covers. A second money source here would be that same bug a third time.
--
-- For the same reason a till sale does NOT write a cash_entries row. The drawer still balances:
-- buildKasboek counts daily_turnover.cash_amount as ontvangsten.
--
-- Opt-in by use: an owner who never rings up a sale never creates a row and never sees the Kassa
-- surface. Non-breaking: a new table only.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.till_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The trading day this sale belongs to. Set from the owner's Amsterdam today, never from a UTC
  -- clock: a sale rung up at 23:30 local belongs to that evening's takings, and a UTC date would
  -- move it (and its btw) to the next day for two hours every evening.
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  -- One ticket = one customer at the counter, possibly several lines. Sharing an id is what lets a
  -- mistake be voided as the whole transaction it was, which is how every POS behaves.
  ticket_id uuid NOT NULL,
  description text NOT NULL,
  -- Negative for a refund/correction of an earlier sale on the same day. The day's figures then go
  -- down, which is a real day and is tested (till-day.test.ts).
  quantity numeric NOT NULL,
  -- GROSS, incl. btw — what the customer actually paid. articles.unit_price is stored EX-btw
  -- because it feeds invoice lines; a consumer price list is the other way round, and
  -- articleGrossPrice() is the single conversion between them.
  unit_price_incl numeric NOT NULL,
  btw_rate numeric NOT NULL CHECK (btw_rate IN (0, 9, 21)),
  -- Aggregates one-to-one into daily_turnover's pin_amount / cash_amount / other_amount, so the
  -- vocabulary matches the columns it feeds rather than the Dutch used for cash_entries.category.
  method text NOT NULL CHECK (method IN ('pin', 'cash', 'other')),
  -- Optional provenance: which catalogue article was tapped. ON DELETE SET NULL — archiving a
  -- service from the price list must never rewrite what was sold last Tuesday.
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.till_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS till_sales_select_own ON public.till_sales;
CREATE POLICY till_sales_select_own ON public.till_sales
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS till_sales_insert_own ON public.till_sales;
CREATE POLICY till_sales_insert_own ON public.till_sales
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS till_sales_update_own ON public.till_sales;
CREATE POLICY till_sales_update_own ON public.till_sales
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS till_sales_delete_own ON public.till_sales;
CREATE POLICY till_sales_delete_own ON public.till_sales
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- The day's sales, newest first — the only access pattern the screen and the aggregator have.
CREATE INDEX IF NOT EXISTS idx_till_sales_user_date
  ON public.till_sales (user_id, sale_date DESC, created_at DESC);
-- Voiding a ticket deletes by (user, ticket).
CREATE INDEX IF NOT EXISTS idx_till_sales_ticket
  ON public.till_sales (user_id, ticket_id);

COMMENT ON TABLE public.till_sales IS
  'Per-sale detail for a shop without a till. NOT a money source: it aggregates into one '
  'daily_turnover row per day (source=manual), which is the only thing the financial engines read. '
  'See the header of this migration and [KAS-DUBBELTELLING] in kasboek.ts.';
