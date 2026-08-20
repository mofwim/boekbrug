-- migrations: urenregistratie.sql
-- =====================================================================
-- [UREN] The one-invoice rule, proven against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- src/lib/uren.test.ts proves the ARITHMETIC around these rows. It cannot prove the three things
-- that only exist inside the database, and those three are the ones the feature stands on:
--
--   · the CHECKs — a row that cannot be a billable quantity never gets stored at all;
--   · ON DELETE SET NULL — throwing away a concept-factuur gives its hours BACK, instead of
--     deleting the work along with the document (which is what CASCADE would have done);
--   · RLS — one owner's hours are not another owner's, and "billed" cannot be flipped by a
--     stranger who guessed a uuid.
--
-- The second one is the whole reason invoice_id is a foreign key and not a boolean. A boolean
-- survives the deletion of the invoice it referred to, and then the hours are marked billed for an
-- invoice that no longer exists — money that was worked, cannot be found, and nobody is looking
-- for.
--
-- MECHANICS. Same as invoice_rls_isolation.test.sql: auth.uid() is re-bound to a session GUC so one
-- connection can impersonate each owner, and impersonated statements run under SET ROLE
-- authenticated so RLS actually applies.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

-- ── The world: two owners, one customer each, one concept-factuur ─────────────────────────────
INSERT INTO public.profiles (id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'zzper'),   -- A, whose hours these are
  ('22222222-2222-2222-2222-222222222222', 'zzper');   -- B, a stranger

INSERT INTO public.clients (id, user_id, name) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'Klant van A');

INSERT INTO public.invoices (id, sender_id, status, direction, invoice_type, total_inc_btw)
VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111',
        'draft', 'outgoing', 'factuur', 121.00);

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;

-- ══ 1. A row that cannot be a billable quantity is refused by the DATABASE ════════════════════
-- Not by a route, not by a form. The CHECK is the last reader, and it is the only one that is
-- there no matter which door the row came through.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.time_entries (user_id, worked_on, description, hours)
    VALUES ('11111111-1111-1111-1111-111111111111', '2026-08-03', 'Werk', 0);
    RAISE EXCEPTION '[UREN] zero hours was stored — a line of nothing can reach an invoice';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.time_entries (user_id, worked_on, description, hours)
    VALUES ('11111111-1111-1111-1111-111111111111', '2026-08-03', 'Werk', -2);
    RAISE EXCEPTION '[UREN] negative hours was stored — a correction disguised as work';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.time_entries (user_id, worked_on, description, hours)
    VALUES ('11111111-1111-1111-1111-111111111111', '2026-08-03', 'Werk', 25);
    RAISE EXCEPTION '[UREN] 25 hours in one day was stored — a typo becomes an invoice';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    -- Art. 35a Wet OB: the nature of the service belongs on the invoice, and this text IS that
    -- description. Whitespace is not a description.
    INSERT INTO public.time_entries (user_id, worked_on, description, hours)
    VALUES ('11111111-1111-1111-1111-111111111111', '2026-08-03', '   ', 2);
    RAISE EXCEPTION '[UREN] a blank description was stored — an amount without a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.time_entries (user_id, worked_on, description, hours, hourly_rate)
    VALUES ('11111111-1111-1111-1111-111111111111', '2026-08-03', 'Werk', 2, -50);
    RAISE EXCEPTION '[UREN] a negative rate was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- …and the two values that MUST be allowed, because refusing them would be its own defect.
INSERT INTO public.time_entries (id, user_id, client_id, worked_on, description, hours, hourly_rate)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-08-03', 'Garantiewerk', 2, 0);
INSERT INTO public.time_entries (id, user_id, client_id, worked_on, description, hours, hourly_rate)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-08-04', 'Tarief nog niet afgesproken', 3, NULL);
-- A quarter of an hour survives the numeric(6,2): the smallest unit anyone actually books.
INSERT INTO public.time_entries (id, user_id, client_id, worked_on, description, hours, hourly_rate)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-08-05', 'Overleg', 0.25, 85);

DO $$
DECLARE v numeric;
BEGIN
  SELECT hours INTO v FROM public.time_entries WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003';
  IF v <> 0.25 THEN
    RAISE EXCEPTION '[UREN] a quarter hour came back as % — the column cannot hold what people book', v;
  END IF;
  SELECT hourly_rate INTO v FROM public.time_entries WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF v IS NULL OR v <> 0 THEN
    RAISE EXCEPTION '[UREN] a rate of zero came back as % — goodwill work became unpriced work', v;
  END IF;
  SELECT hourly_rate INTO v FROM public.time_entries WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION '[UREN] an unagreed rate came back as % — unknown became a number', v;
  END IF;
END $$;

-- ══ 2. [UREN-EENMALIG] Deleting a concept-factuur gives the hours BACK ════════════════════════
UPDATE public.time_entries SET invoice_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
WHERE id IN ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.time_entries WHERE invoice_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION '[UREN] expected 1 unbilled hour after billing two, got %', n; END IF;
END $$;

DELETE FROM public.invoices WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

DO $$
DECLARE n int; still int;
BEGIN
  -- The work SURVIVES the document. CASCADE here would have deleted three hours of real work
  -- because the invoice around them was thrown away, which is the exact failure this file exists
  -- to make impossible.
  SELECT count(*) INTO still FROM public.time_entries;
  IF still <> 3 THEN
    RAISE EXCEPTION '[UREN] deleting a concept destroyed the work: % of 3 rows left', still;
  END IF;
  -- …and it is billable again, because it was worked and never paid for.
  SELECT count(*) INTO n FROM public.time_entries WHERE invoice_id IS NULL;
  IF n <> 3 THEN
    RAISE EXCEPTION '[UREN] deleting a concept left % hours marked billed for an invoice that no longer exists', 3 - n;
  END IF;
END $$;

-- An invoice_id that points at nothing cannot be written in the first place: without the foreign
-- key, "billed" would be a claim instead of a fact.
DO $$
BEGIN
  UPDATE public.time_entries SET invoice_id = '99999999-9999-9999-9999-999999999999'
  WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  RAISE EXCEPTION '[UREN] an hour was marked billed for an invoice that does not exist';
EXCEPTION WHEN foreign_key_violation THEN NULL;
END $$;

-- ══ 3. RLS: a stranger cannot read these hours, and cannot mark them billed ═══════════════════
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('test.uid', '22222222-2222-2222-2222-222222222222', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO n FROM public.time_entries;
  IF n <> 0 THEN RAISE EXCEPTION '[UREN] B read % of A''s hours', n; END IF;

  -- The dangerous one. Marking someone else's hours as billed does not READ anything — it makes
  -- work vanish from the list its owner bills from, silently, and they would never look for it.
  -- 23 and not 99 on purpose: a value the CHECK accepts, so it is THIS assertion that catches an
  -- open policy and not the hours ceiling firing first. A test whose diagnostic blames the wrong
  -- constraint sends the next reader to the wrong file.
  UPDATE public.time_entries SET invoice_id = NULL, hours = 23;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '[UREN] B changed % of A''s hours', n; END IF;

  DELETE FROM public.time_entries;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '[UREN] B deleted % of A''s hours', n; END IF;

  RESET ROLE;
END $$;

-- B cannot file work under A's name either — an insert whose user_id is not the caller is refused
-- by WITH CHECK, so nobody can push rows into another administratie.
DO $$
BEGIN
  PERFORM set_config('test.uid', '22222222-2222-2222-2222-222222222222', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.time_entries (user_id, worked_on, description, hours)
    VALUES ('11111111-1111-1111-1111-111111111111', '2026-08-06', 'Niet van B', 1);
    RESET ROLE;
    RAISE EXCEPTION '[UREN] B wrote an hour into A''s administratie';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END $$;

-- …and A still sees exactly their own three, so the policies did not simply close the door on
-- everyone. A test that only proves nobody can read anything proves nothing.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.time_entries;
  RESET ROLE;
  IF n <> 3 THEN RAISE EXCEPTION '[UREN] A sees % of their own 3 hours', n; END IF;
END $$;

-- ══ 4. A deleted customer card does not delete the work ═══════════════════════════════════════
-- Same argument as the invoice: the hours were worked. Losing the card loses the link, not the
-- money — and an hour with no client_id is still billable (uren.ts groups it on its own).
DELETE FROM public.clients WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.time_entries;
  IF n <> 3 THEN RAISE EXCEPTION '[UREN] deleting a customer card destroyed work: % of 3 left', n; END IF;
  SELECT count(*) INTO n FROM public.time_entries WHERE client_id IS NULL;
  IF n <> 3 THEN RAISE EXCEPTION '[UREN] % hours still point at a customer that is gone', 3 - n; END IF;
END $$;

-- ══ 5. Removing the owner DOES remove the work ═══════════════════════════════════════════════
-- The one place CASCADE is right: an erased account leaves nothing behind, and the GDPR erasure
-- path relies on exactly this rather than on remembering to add a table it has never heard of.
DELETE FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.time_entries;
  IF n <> 0 THEN RAISE EXCEPTION '[UREN] % hours outlived the account they belonged to', n; END IF;
END $$;

SELECT '✅ [UREN] time_entries: the checks hold, a deleted concept gives its hours back, and RLS closes the door' AS result;
