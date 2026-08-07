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

CREATE TABLE public.bank_tx_invoices (
  user_id        uuid NOT NULL,
  transaction_id uuid NOT NULL,
  invoice_id     uuid NOT NULL,
  amount_applied numeric,      -- MAGNITUDE, per invoice — the sign is derived, never stored
  PRIMARY KEY (transaction_id, invoice_id)
);

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
