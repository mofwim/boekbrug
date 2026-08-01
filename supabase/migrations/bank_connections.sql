-- [GOCARDLESS] Live bank link over PSD2 (GoCardless Bank Account Data) — August 2026
--
-- Why: until now a bank statement only entered BoekBrug because the owner exported an
-- MT940/CAMT file and uploaded it. That is the step people forget, and every promise built on
-- it degrades quietly — a kwartaal that misses a month, an accountant who never sees the whole
-- money line, invoices that stay "unpaid" because the payment was never imported. With the
-- owner's consent at his own bank, the transactions now arrive by themselves.
--
-- Two tables:
--   1. bank_connections          — one row per consent (a GoCardless "requisition"). This is
--      the CONSENT, not the account: PSD2 caps it at 90 days, after which the owner must
--      re-authorise at his bank. access_valid_until is therefore load-bearing, not cosmetic —
--      it is what lets the app warn BEFORE the feed goes quiet instead of after.
--   2. bank_connection_accounts  — the accounts that consent unlocked, one row each, with the
--      per-account sync watermark.
--
-- ── Why the watermark is a column and not a guess ───────────────────────────────────────────
-- GoCardless allows only a handful of transaction reads per DAY per account (10/day since
-- August 2024, with a documented intent to reach 4/day). Blow through that and the account is
-- rate-limited for the rest of the day — for a manual "ververs" button as much as for the cron.
-- last_synced_at is what makes "at most once a day, and the manual button says so honestly"
-- possible. Without it the cron and the button would race each other into a 429 the owner reads
-- as a broken app.
--
-- ── No secret lives here ────────────────────────────────────────────────────────────────────
-- Unlike the SnelStart maatwerksleutel (Vault, see snelstart_connection.sql), nothing in these
-- tables grants access on its own. A requisition id or account id is an opaque identifier; it
-- only means anything when combined with OUR application secrets, which live in the server
-- environment (GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY) and never in the database. So
-- there is no Vault reference to keep here — and no ambiguity about where the real secret is.

CREATE TABLE IF NOT EXISTS public.bank_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- Kept explicit so a second aggregator later is an added value, not a schema migration.
  provider text NOT NULL DEFAULT 'gocardless'
    CHECK (provider = ANY (ARRAY['gocardless'::text])),
  -- The GoCardless requisition: the consent object the whole link hangs from.
  requisition_id text NOT NULL,
  -- The end-user agreement behind it (holds the scope + the validity window we asked for).
  agreement_id text,
  institution_id text NOT NULL,
  institution_name text,
  institution_bic text,
  -- Our own opaque nonce, echoed back by GoCardless on the redirect. The callback matches on
  -- THIS, never on a user id from the query string: the redirect arrives in the owner's
  -- browser, so anything readable there is attacker-controllable.
  reference text NOT NULL,
  -- 'pending'  → created, the owner has not finished consenting at his bank yet
  -- 'linked'   → accounts are available and syncing
  -- 'expired'  → the 90-day consent ran out; the owner must reconnect (not an error)
  -- 'error'    → the bank/GoCardless refuses; last_error says what
  -- 'revoked'  → the owner disconnected it here
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'linked'::text, 'expired'::text, 'error'::text, 'revoked'::text])),
  -- The day this consent dies, as GRANTED by the bank — not as requested by us. A bank may cap
  -- the window shorter than the 90 days we ask for, and a date on screen that outlives the real
  -- consent is worse than no date at all.
  access_valid_until date,
  max_historical_days integer,
  connected_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_connections_pkey PRIMARY KEY (id),
  CONSTRAINT bank_connections_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- One row per requisition. The callback can fire twice (a refresh, a double tap on the bank's
  -- "gereed" button); without this a second visit would create a duplicate connection whose
  -- accounts then sync twice.
  CONSTRAINT bank_connections_requisition_unique UNIQUE (requisition_id)
);

-- The owner's own list, newest first — the connection card on /dashboard/bank.
CREATE INDEX IF NOT EXISTS bank_connections_user_created_idx
  ON public.bank_connections (user_id, created_at DESC);

-- The callback looks a connection up by the nonce it got back, so that lookup must be indexed
-- and unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS bank_connections_reference_uidx
  ON public.bank_connections (reference);

CREATE TABLE IF NOT EXISTS public.bank_connection_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  -- Denormalised on purpose: every sync and every read filters by user_id, and carrying it here
  -- keeps the RLS policy a single-table predicate instead of a join the planner has to prove.
  user_id uuid NOT NULL,
  -- The GoCardless account id (opaque uuid) — what /accounts/{id}/transactions/ is called with.
  account_id text NOT NULL,
  iban text,
  owner_name text,
  currency text,
  -- The account's own status at GoCardless (READY / SUSPENDED / EXPIRED / ERROR / PROCESSING).
  status text,
  -- ── The rate-limit watermark ──────────────────────────────────────────────────────────────
  -- When we last SUCCEEDED, and through which date. The next pull starts a few days before
  -- last_synced_through, because a transaction can book late; the content dedup in
  -- bank-import.ts absorbs the overlap, so overlapping is free and missing a line is not.
  last_synced_at timestamptz,
  last_synced_through date,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_connection_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT bank_connection_accounts_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES public.bank_connections(id) ON DELETE CASCADE,
  CONSTRAINT bank_connection_accounts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The same bank account must never be held twice by one owner. Reconnecting after the 90-day
  -- expiry returns the SAME GoCardless account id, and a second row would mean two watermarks
  -- for one account: both would sync, both would pull the same window, and only the content
  -- dedup would stand between that and doubled money.
  CONSTRAINT bank_connection_accounts_user_account_unique UNIQUE (user_id, account_id)
);

CREATE INDEX IF NOT EXISTS bank_connection_accounts_connection_idx
  ON public.bank_connection_accounts (connection_id);

-- The cron's own question: "which accounts are due for a sync?" — ordered so the longest-unsynced
-- go first and a truncated run never starves the same tail forever.
CREATE INDEX IF NOT EXISTS bank_connection_accounts_due_idx
  ON public.bank_connection_accounts (last_synced_at NULLS FIRST);

ALTER TABLE public.bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_connection_accounts ENABLE ROW LEVEL SECURITY;

-- Reading is the owner's (the UI shows the bank, the status and the expiry date). Writing is
-- EXCLUSIVELY the server routes with service_role — exactly as with snelstart_connections, and
-- for the same reason: a client that could set status='linked' or invent an account_id could
-- attach someone else's bank account id to its own row and read that account's transactions
-- through our credentials. There is deliberately no insert/update/delete policy for
-- authenticated.
DROP POLICY IF EXISTS bank_connections_select_own ON public.bank_connections;
CREATE POLICY bank_connections_select_own ON public.bank_connections
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS bank_connection_accounts_select_own ON public.bank_connection_accounts;
CREATE POLICY bank_connection_accounts_select_own ON public.bank_connection_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Beide tabellen staan er, de drie unieke sleutels ook, RLS staat aan en er is per tabel
-- precies één (lees)policy. Alles moet true zijn.
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'bank_connections') AS heeft_connections,
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'bank_connection_accounts') AS heeft_accounts,
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'bank_connections_requisition_unique') AS requisitie_uniek,
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'bank_connections_reference_uidx') AS referentie_uniek,
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'bank_connection_accounts_user_account_unique') AS rekening_uniek,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bank_connections'::regclass) AS rls_connections,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bank_connection_accounts'::regclass) AS rls_accounts,
  (SELECT count(*) = 1 FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'bank_connections') AS een_policy_connections,
  (SELECT count(*) = 1 FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'bank_connection_accounts') AS een_policy_accounts;
