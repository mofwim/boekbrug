-- =====================================================================
-- [REMINDERS] Automatische betalingsherinneringen — an outgoing invoice
-- that stays unpaid past its due date gets a gentle, escalating reminder
-- e-mailed to the client AUTOMATICALLY. Migration. BoekBrug · July 2026
-- =====================================================================
-- WHY: "Herinner je klant" on /dashboard/vandaag is a READ-ONLY task list
-- today (VandaagClient.tsx:491 — "there is no reminder-send logic yet").
-- The owner still had to chase every late payment by hand. This is the
-- data layer for a cron that sends the reminder for them — the clearest
-- cashflow win in the app, on infra that already exists (Resend + cron).
--
-- MODEL (minimal, opt-in, idempotent, reversible):
--   · profiles.reminders_enabled  — master switch, DEFAULT false. Nothing is
--                                   ever e-mailed to anyone's client until the
--                                   owner turns this on. Trust before automation.
--   · profiles.reminder_offsets   — days AFTER due_date at which to remind.
--                                   DEFAULT '{14,30}': a calm two-step (14 =
--                                   friendly nudge, 30 = firm-but-polite).
--   · invoices.reminders_paused   — per-invoice opt-out (a delicate client, a
--                                   disputed invoice). DEFAULT false.
--   · invoice_reminders           — one row per reminder actually sent. Its
--                                   UNIQUE(invoice_id, day_offset) is the
--                                   idempotency guard: a tier can never be sent
--                                   twice, even if two cron runs overlap (the
--                                   loser of the insert race sends nothing). It
--                                   is also the send history shown in the UI.
--
-- WHAT THIS DOES NOT DO: no money movement, no status change, no filing. A
-- reminder is a best-effort e-mail; failure is logged, never fatal. Incoming
-- invoices, SMS and debt-collection escalation are explicitly out of scope.
--
-- APPLY: run this whole file in the Supabase SQL editor (one transaction).
-- Nothing here deletes data. Idempotent / re-runnable.
-- =====================================================================

BEGIN;

-- ── 1) profiles — owner settings ─────────────────────────────────────
--    reminders_enabled: master opt-in. DEFAULT false is the whole trust
--    contract — an existing user is NEVER auto-enrolled into e-mailing
--    their clients. They must switch it on in Instellingen.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.reminders_enabled IS
  '[REMINDERS] Master opt-in for automatic payment reminders. DEFAULT false — no reminder is ever sent to a client until the owner enables this.';

--    reminder_offsets: days after due_date to send each tier. DEFAULT
--    {14,30}. int[] so the owner can tune the cadence later without a
--    schema change. The cron reads this per owner.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reminder_offsets integer[] NOT NULL DEFAULT '{14,30}';

COMMENT ON COLUMN public.profiles.reminder_offsets IS
  '[REMINDERS] Days after due_date at which to send each reminder tier (e.g. {14,30}). The cron sends the highest reached tier not yet sent.';

-- ── 2) invoices — per-invoice opt-out ────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS reminders_paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoices.reminders_paused IS
  '[REMINDERS] When true, this invoice is skipped by the reminder cron even if the owner has reminders enabled (delicate client / disputed invoice).';

-- ── 3) invoice_reminders — sent-log + idempotency anchor ─────────────
CREATE TABLE IF NOT EXISTS public.invoice_reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_offset  integer NOT NULL,            -- which tier (e.g. 14 or 30)
  sent_at     timestamptz NOT NULL DEFAULT now(),
  email_to    text,                        -- recipient at send time (audit)
  status      text NOT NULL DEFAULT 'sent',-- 'sent' | 'failed'
  -- IDEMPOTENCY: a given tier is sent AT MOST ONCE per invoice. Two overlapping
  -- cron runs both computing "tier 14 is due" → the first insert wins, the
  -- second hits this constraint and is swallowed (ON CONFLICT DO NOTHING), so
  -- the client never gets the same reminder twice.
  CONSTRAINT invoice_reminders_once_per_tier UNIQUE (invoice_id, day_offset)
);

COMMENT ON TABLE public.invoice_reminders IS
  '[REMINDERS] One row per reminder e-mail sent for an invoice. UNIQUE(invoice_id, day_offset) makes each tier send-once (idempotent under concurrent cron runs). Also the send-history surface in the UI.';

-- Cron candidate lookup joins already-sent tiers per invoice; owner history
-- reads by user. Both are covered here.
CREATE INDEX IF NOT EXISTS invoice_reminders_invoice_idx
  ON public.invoice_reminders (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_reminders_user_idx
  ON public.invoice_reminders (user_id);

-- ── 4) RLS — owner reads own history; writes are service-role only ───
--    The cron inserts via the service-role pipeline client (bypasses RLS),
--    so no INSERT policy is granted to authenticated users — a client-side
--    session can only READ its own reminder history, never forge a send.
ALTER TABLE public.invoice_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_reminders_select_own ON public.invoice_reminders;
CREATE POLICY invoice_reminders_select_own
  ON public.invoice_reminders
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMIT;
