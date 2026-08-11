-- migrations: accountant_invoice_mandate.sql, accountant_confirm_mandate.sql
-- =====================================================================
-- [RLS-PROEF] Cross-tenant READ isolation, tried — not read.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- The [RLS-UIT] gate in lifecycle-gates.test.ts is STATIC: it proves every service-role query on
-- the money line carries an owner filter in its text. This file proves the other half by
-- EXPERIMENT — what an authenticated session may actually reach when RLS is on — for the one
-- surface that is supposed to cross a tenant boundary: an accountant reaching a client's invoices
-- through a mandate.
--
-- WHAT THIS COVERS, AND THE HARD BOUNDARY ON IT
-- Only the mandate policies ship in this repo. The BASE policies — invoices_zzp_select (owner),
-- the accountant "shared = true" read, the member read — were created in the original dashboard
-- setup and are not in supabase/migrations. So this file loads only the mandate DDL, and asserts
-- only what the mandate DDL fully governs on its own:
--
--   · READ isolation — who can SELECT which invoices, and whose lines;
--   · the amount-guard TRIGGER, which is not RLS and needs no base policy;
--   · that revocation closes the read window on the very next statement;
--   · that a mandate is not a window into the client's OWN drafts.
--
-- What it deliberately does NOT assert: the mandate ISSUE write (draft -> sent). Running it here
-- surfaced a real and non-obvious coupling — PostgreSQL applies a SELECT policy's USING to the
-- NEW row during an UPDATE, so the moment status leaves 'draft' the mandate read policy
-- (status = 'draft') stops matching the new row, and the write is admitted only if a BASE SELECT
-- policy admits the 'sent' row. That is exactly why the migration's WITH CHECK is written without
-- a status test. It also means mandated issuing is fail-CLOSED against a missing base policy
-- (issuing breaks; nothing leaks), which is the safe direction — but it cannot be proven true here
-- without inventing the base policy, and a test built on an invented policy proves nothing about
-- the database we actually run. So it is named, not faked.
--
-- MECHANICS. auth.uid() is re-bound to a session GUC so one connection can impersonate each actor.
-- Impersonated statements run under SET ROLE authenticated — not the table owner, not superuser —
-- so RLS actually applies; setup and read-back run as the superuser, which RLS never applies to.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

-- ── The world: two clients, two accountants, one facturen-mandate ─────────────────────────────
INSERT INTO public.profiles (id, role) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'zzper'),
  ('d0000000-0000-0000-0000-000000000002', 'zzper'),
  ('a0000000-0000-0000-0000-00000000000a', 'accountant'),   -- A — facturen-mandate from C
  ('b0000000-0000-0000-0000-00000000000b', 'accountant');   -- B — only a bevestigen-mandate from C

INSERT INTO public.accountant_clients (accountant_id, zzper_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000001');
INSERT INTO public.accountant_invoice_mandates (zzper_id, accountant_id, kind) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'facturen'),
  -- B's mandate is the WRONG KIND. The confirm-mandate migration exists so this must NOT open
  -- invoices — its header names that exact widening as the failure it guards against.
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'bevestigen');

INSERT INTO public.invoices (id, sender_id, created_by, direction, invoice_type, status, total_ex_btw, btw_amount, total_inc_btw) VALUES
  ('11111111-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'outgoing', 'factuur', 'draft', 100, 21, 121), -- A's mandate draft for C
  ('11111111-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'outgoing', 'factuur', 'draft', 200, 42, 242), -- C's OWN draft
  ('11111111-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'outgoing', 'factuur', 'sent',  300, 63, 363), -- C's issued invoice
  ('11111111-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'outgoing', 'factuur', 'draft', 400, 84, 484), -- D's draft, created by A, NO mandate from D
  ('11111111-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'outgoing', 'factuur', 'draft', 600, 126, 726); -- a draft B created — but B holds only a BEVESTIGEN mandate, so it must stay invisible to B

INSERT INTO public.invoice_lines (invoice_id, description, quantity, unit_price, btw_rate, line_total) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Advies', 1, 100, 21, 100),
  ('11111111-0000-0000-0000-000000000002', 'Advies', 2, 100, 21, 200);

-- ── READ isolation ────────────────────────────────────────────────────────────────────────────
SET ROLE authenticated;

-- A, mandated creator, sees EXACTLY the one draft they made under the mandate: never the client's
-- own concept (created_by = C), never the issued invoice, never D's draft (no mandate from D).
-- The positive half is also this file's control — a broken harness (RLS off for the role, or
-- auth.uid() unbound) would return a different count and fail here first.
SELECT set_config('test.uid', 'a0000000-0000-0000-0000-00000000000a', false);
DO $$
DECLARE ids uuid[];
BEGIN
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO ids FROM public.invoices;
  IF ids <> ARRAY['11111111-0000-0000-0000-000000000001']::uuid[] THEN
    RAISE EXCEPTION '[RLS-PROEF] A must see exactly the draft it created under mandate, saw: %', ids;
  END IF;
  IF (SELECT count(*) FROM public.invoice_lines) <> 1 THEN
    RAISE EXCEPTION '[RLS-PROEF] A must see only the LINES of that same draft';
  END IF;
END $$;

-- B: linked to C, holds a bevestigen-mandate, and even CREATED a draft (…006). It must still see
-- nothing — the mandate read is gated on kind = 'facturen', so a bevestigen-mandate opening
-- invoices is the exact widening the confirm migration exists to prevent.
SELECT set_config('test.uid', 'b0000000-0000-0000-0000-00000000000b', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.invoices) <> 0 THEN
    RAISE EXCEPTION '[RLS-PROEF] B holds only a bevestigen-mandate and must see NO invoices';
  END IF;
  IF (SELECT count(*) FROM public.invoice_lines) <> 0 THEN
    RAISE EXCEPTION '[RLS-PROEF] …and no lines';
  END IF;
END $$;

-- A stranger with no relationship to anyone: nothing.
SELECT set_config('test.uid', 'e0000000-0000-0000-0000-0000000000ee', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.invoices) + (SELECT count(*) FROM public.invoice_lines) <> 0 THEN
    RAISE EXCEPTION '[RLS-PROEF] a stranger must see nothing';
  END IF;
END $$;

-- ── A mandate is not a window into the client's OWN drafts ────────────────────────────────────
-- A attempts to seize C's own concept (created_by = C). The mandate policies key on
-- created_by = auth.uid(), so A can neither see nor update it: the UPDATE matches zero rows, no
-- error, and the row is untouched. This needs no base policy — it is pure mandate DDL.
SELECT set_config('test.uid', 'a0000000-0000-0000-0000-00000000000a', false);
UPDATE public.invoices SET status = 'sent', invoice_number = 'HIJACK-1'
 WHERE id = '11111111-0000-0000-0000-000000000002';

RESET ROLE;
DO $$
DECLARE nr text; st text;
BEGIN
  SELECT invoice_number, status INTO nr, st FROM public.invoices WHERE id = '11111111-0000-0000-0000-000000000002';
  IF st <> 'draft' OR nr IS NOT NULL THEN
    RAISE EXCEPTION '[RLS-PROEF] A reached the client''s OWN draft (status %, number %) — a mandate must not be a window into it', st, nr;
  END IF;
END $$;

-- ── The amount-guard TRIGGER, in isolation ────────────────────────────────────────────────────
-- The superuser bypasses RLS but never a trigger, so this aims auth.uid() at A and pokes a
-- protected column on C's ISSUED invoice. Trigger exceptions 1-4 all miss (not service role, not
-- the sender, not the receiver, not a draft A created) — so the guard must raise.
SELECT set_config('test.uid', 'a0000000-0000-0000-0000-00000000000a', false);
DO $$
BEGIN
  BEGIN
    UPDATE public.invoices SET total_inc_btw = 1 WHERE id = '11111111-0000-0000-0000-000000000003';
    RAISE EXCEPTION '[RLS-PROEF] the amount guard let an accountant rewrite a total on an issued invoice';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%only the invoice owner can modify%' THEN RAISE; END IF;
  END;
END $$;

-- ── Revocation closes the read window on the NEXT statement ────────────────────────────────────
-- The mandate screen's promise. Not "at the next sync": the policy calls has_active_invoice_mandate
-- per statement, so the statement after the revoke is already too late.
SELECT set_config('test.uid', '', false);
UPDATE public.accountant_invoice_mandates SET revoked_at = now()
 WHERE accountant_id = 'a0000000-0000-0000-0000-00000000000a';

SET ROLE authenticated;
SELECT set_config('test.uid', 'a0000000-0000-0000-0000-00000000000a', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.invoices) <> 0 THEN
    RAISE EXCEPTION '[RLS-PROEF] the mandate was revoked and A can still read the client''s drafts';
  END IF;
END $$;
RESET ROLE;

SELECT '[RLS-PROEF] read isolation held: a facturen-mandate opens exactly one draft, a bevestigen-mandate opens none, a stranger sees nothing, the amount guard holds on issued invoices, and revocation closes the window immediately' AS result;
