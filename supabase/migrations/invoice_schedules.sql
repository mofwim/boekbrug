-- supabase/migrations/invoice_schedules.sql
-- [HERHAAL] Terugkerende facturen — repeat an invoice you already sent.
--
-- The model is deliberately thin: a schedule POINTS AT AN INVOICE and says how often to repeat
-- it. No template, no second copy of the client's details or the line items — the invoice the
-- owner already sent IS the definition of what is billed. One source of truth, and setting one up
-- costs a single tap on a row that already exists.
--
-- Each run produces a CONCEPT (status 'draft'), never a sent invoice:
--   · an invoice number is minted on SEND and only there (next_invoice_seq, forward-only, art. 35
--     Wet OB) — a background job that mints numbers puts holes in the sequence the moment
--     anything fails halfway;
--   · sending is an outward act toward a third party, and a wrong recurring invoice that goes out
--     by itself is a letter the owner never wrote and cannot unsend.
-- The app does the whole job except the last tap. That removes the typing, which is the work.

CREATE TABLE IF NOT EXISTS public.invoice_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- The invoice this schedule repeats. ON DELETE CASCADE: without its source there is nothing to
  -- copy, so the schedule has no meaning left either.
  source_invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,

  cadence text NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  -- Day-of-month the series is anchored on (1–31), kept as the ANCHOR and clamped per month, so
  -- a schedule on the 31st runs 31 Jan → 28 Feb → 31 Mar instead of collapsing to the 28th.
  anchor_day smallint NOT NULL DEFAULT 1 CHECK (anchor_day BETWEEN 1 AND 31),

  next_run_date date NOT NULL,
  ends_on date,
  active boolean NOT NULL DEFAULT true,

  last_run_at timestamptz,
  last_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  runs_count integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.invoice_schedules IS
  '[HERHAAL] One schedule = repeat one existing invoice every week/month/quarter/year as a fresh CONCEPT. Numbers are never minted here — only on send.';

-- One schedule per invoice: two schedules on the same source would silently bill a customer twice.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_schedules_one_per_source
  ON public.invoice_schedules (source_invoice_id);

-- The cron's only query: active schedules whose date has come.
CREATE INDEX IF NOT EXISTS idx_invoice_schedules_due
  ON public.invoice_schedules (next_run_date) WHERE active;

CREATE INDEX IF NOT EXISTS idx_invoice_schedules_user ON public.invoice_schedules (user_id);

ALTER TABLE public.invoice_schedules ENABLE ROW LEVEL SECURITY;

-- Owner-only, all four verbs. The cron runs on the service role and bypasses these by design.
DROP POLICY IF EXISTS invoice_schedules_select_own ON public.invoice_schedules;
CREATE POLICY invoice_schedules_select_own ON public.invoice_schedules
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS invoice_schedules_insert_own ON public.invoice_schedules;
CREATE POLICY invoice_schedules_insert_own ON public.invoice_schedules
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS invoice_schedules_update_own ON public.invoice_schedules;
CREATE POLICY invoice_schedules_update_own ON public.invoice_schedules
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS invoice_schedules_delete_own ON public.invoice_schedules;
CREATE POLICY invoice_schedules_delete_own ON public.invoice_schedules
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- [HERHAAL] Which concept came from which schedule. Nullable and ON DELETE SET NULL: a generated
-- concept is an ordinary invoice from the moment it exists — deleting the schedule must never
-- take an invoice with it, and the owner can edit or delete the concept like any other.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS schedule_id uuid
  REFERENCES public.invoice_schedules(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.invoices.schedule_id IS
  '[HERHAAL] The recurring schedule that generated this concept, if any. Purely informational — the invoice stands on its own.';

-- The cron asks "did this schedule already produce an invoice for this date?" before writing, so
-- a retry or an overlapping run can never bill a customer twice for the same period.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_per_schedule_date
  ON public.invoices (schedule_id, invoice_date) WHERE schedule_id IS NOT NULL;
