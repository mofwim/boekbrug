-- [SEAM] The smallest database allocate_bank_payment can be true against.
--
-- Deliberately NOT a copy of the production schema. It declares exactly the columns the function
-- reads and writes, and nothing else — because a fixture that invents columns proves the function
-- against a database we do not have, which is the failure this whole directory exists to stop.
-- If the function starts touching a new column, this file fails first and loudly.
--
-- auth.uid() is a stub returning NULL, which is the service-role case: the caller guard then pins
-- the call by p_user_id alone. The test overrides it to impersonate a stranger where that matters.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.bank_transactions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL,
  amount     numeric,      -- SIGNED: negative is money out
  date       date,
  status     text,
  invoice_id uuid
);

CREATE TABLE public.invoices (
  id                uuid PRIMARY KEY,
  sender_id         uuid,
  receiver_id       uuid,
  status            text,
  accountant_status text,
  invoice_type      text,
  total_inc_btw     numeric,   -- SIGNED: a creditnota is negative
  amount_paid       numeric DEFAULT 0,
  payment_method    text,
  marked_paid_at    timestamptz,
  payment_date      date
);

-- The link table, shaped as bank_tx_invoices.sql + invoice_manual_payments.sql leave it.
--
-- Two details here are load-bearing and were wrong in the first version of this fixture, which is
-- the fixture's own lesson: a surrogate `id` primary key with a UNIQUE INDEX on the pair, NOT a
-- composite primary key. A PRIMARY KEY column cannot be NULL, and apply_manual_payment writes
-- transaction_id NULL on purpose — a manual instalment belongs to no bank line. Declared as a
-- composite PK, every manual payment is rejected by the fixture and the test blames the function.
--
-- UNIQUE treats NULLs as distinct, so several manual instalments on one invoice coexist while
-- allocate_bank_payment's ON CONFLICT (transaction_id, invoice_id) still finds its row.
CREATE TABLE public.bank_tx_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  transaction_id uuid,          -- NULL = a manual payment, not a bank line
  invoice_id     uuid NOT NULL,
  amount_applied numeric,       -- MAGNITUDE, per invoice — the sign is derived, never stored
  paid_on        date,
  method         text,
  client_key     uuid,
  created_at     timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX bank_tx_invoices_unique_pair
  ON public.bank_tx_invoices (transaction_id, invoice_id);

-- [FACTUUR-B] The live invoice-number counter. Written ONLY by next_invoice_seq and
-- seed_invoice_counter — there are no INSERT/UPDATE/DELETE policies for the session client.
CREATE TABLE public.invoice_counters (
  user_id  uuid NOT NULL,
  year     int  NOT NULL,   -- a calendar year, or 0 for continuous numbering
  type     text NOT NULL,
  last_seq int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year, type)
);

-- The two roles the migration GRANTs to. Created only if absent so a real Supabase-like database
-- can run this file too.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role;  END IF;
END $$;
