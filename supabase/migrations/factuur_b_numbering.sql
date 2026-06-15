-- =====================================================================
-- [FACTUUR-B] Atomic + customizable invoice numbering — migration
-- BoekBrug · June 2026
-- =====================================================================
-- MANDATORY ORDER (do NOT skip):
--   1. BACKUP first (Supabase -> Database -> Backups, or pg_dump). No
--      migration without a backup.
--   2. Run the DUPLICATE PRE-CHECK below; confirm it returns ZERO rows.
--      The whole file runs in ONE transaction: if duplicates exist, the
--      UNIQUE constraint (section F) aborts and EVERYTHING rolls back
--      cleanly (nothing half-applied). Clean the duplicates, then re-run
--      (the file is fully idempotent / re-runnable).
--   3. Apply this whole file.
--   4. Regenerate database.types.ts using CMD (NOT PowerShell -> avoids
--      the UTF-16 corruption).
--   5. Only then: the lib / code changes (separate deliverables).
--
-- Contract preserved: generateInvoiceNumber keeps its signature; the two
-- call sites (api/invoice/send/route.ts, api/invoice/creditnota/route.ts)
-- do NOT change. Only the internals are rewired onto next_invoice_seq().
--
-- DUPLICATE PRE-CHECK (run separately FIRST, expect 0 rows):
--   SELECT sender_id, invoice_number, COUNT(*)
--   FROM invoices WHERE invoice_number IS NOT NULL
--   GROUP BY 1,2 HAVING COUNT(*) > 1;
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- A. Counter table -- one row per (user x year x type).
--    year sentinel: a real calendar year => yearly-reset numbering;
--    year = 0       => continuous numbering (no reset). The MODE is
--    decided by the lib (which year value it passes); the table supports
--    both. Writes go ONLY through next_invoice_seq() (section B).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year     int  NOT NULL,                              -- calendar year, or 0 = continuous
  type     text NOT NULL CHECK (type IN ('factuur','creditnota','pro_forma')),
  last_seq int  NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (user_id, year, type)
);

COMMENT ON TABLE public.invoice_counters IS
  '[FACTUUR-B] Atomic per (user,year,type) invoice sequence. Writes go ONLY through next_invoice_seq() (SECURITY DEFINER). year=0 means continuous (no yearly reset).';

-- RLS: deny by default. The SECURITY DEFINER function (owner) bypasses RLS
-- for writes; the migration seeds as owner. A SELECT policy lets a user
-- preview ONLY their own counter (onboarding "your first number will be..."
-- -- read only, never consumes a number).
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_counters_select_own ON public.invoice_counters;
CREATE POLICY invoice_counters_select_own
  ON public.invoice_counters
  FOR SELECT
  USING (user_id = auth.uid());
-- No INSERT/UPDATE/DELETE policies -> direct writes from the session client
-- are denied; only next_invoice_seq() (and migrations) may write.

-- ---------------------------------------------------------------------
-- B. Atomic allocator -- SECURITY DEFINER, returns the RAW integer.
--    The lib formats it; single source of truth for the live sequence.
--    Guards that the caller is the user they claim (condition (4)).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_invoice_seq(
  p_user_id uuid,
  p_year    int,
  p_type    text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq int;
BEGIN
  -- Caller identity guard. auth.uid() is request-scoped and still returns
  -- the CALLER's id inside SECURITY DEFINER. A service_role / anon context
  -- (auth.uid() IS NULL) may NOT mint numbers -- both real call sites use
  -- the authenticated session client.
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION
      '[FACTUUR-B] next_invoice_seq: caller % may not allocate for %',
      auth.uid(), p_user_id
      USING ERRCODE = '42501';   -- insufficient_privilege
  END IF;

  IF p_type NOT IN ('factuur','creditnota','pro_forma') THEN
    RAISE EXCEPTION '[FACTUUR-B] next_invoice_seq: invalid type %', p_type
      USING ERRCODE = '22023';   -- invalid_parameter_value
  END IF;

  IF p_year < 0 THEN
    RAISE EXCEPTION '[FACTUUR-B] next_invoice_seq: invalid year %', p_year
      USING ERRCODE = '22023';
  END IF;

  -- Atomic read+increment in a single statement. Concurrent callers
  -- serialize on the row lock taken by ON CONFLICT -- each gets a distinct
  -- last_seq. No SELECT-then-compute window. Forward-only by construction.
  INSERT INTO public.invoice_counters (user_id, year, type, last_seq)
  VALUES (p_user_id, p_year, p_type, 1)
  ON CONFLICT (user_id, year, type)
  DO UPDATE SET last_seq = public.invoice_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN v_seq;
END;
$$;

COMMENT ON FUNCTION public.next_invoice_seq(uuid,int,text) IS
  '[FACTUUR-B] Atomically allocates the next raw sequence int for (user,year,type). Forward-only (Art. 35 Wet OB 1968). Authenticated caller only.';

-- Lock down execution: authenticated users only (the in-body guard does the rest).
REVOKE ALL ON FUNCTION public.next_invoice_seq(uuid,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_seq(uuid,int,text) TO authenticated;

-- ---------------------------------------------------------------------
-- C. Seed counters from existing data -- MAX(existing) per (user,year,type).
--    Idempotent (GREATEST on conflict). All current numbers are the default
--    format [CR-|PF-]{seq}-{year}; the filter skips anything malformed.
--    Continuous (year=0) rows are NOT seeded here -- no continuous-format
--    data exists yet; onboarding seeds those when a customer picks one.
--    NOTE: a brand-new customer (signs up after this migration) has NO
--    counter row, so their chosen start number is honored EXACTLY. Only a
--    pre-existing test-polluted account gets a baseline here.
-- ---------------------------------------------------------------------
INSERT INTO public.invoice_counters (user_id, year, type, last_seq)
SELECT
  i.sender_id                                          AS user_id,
  (regexp_match(i.invoice_number, '(\d{4})$'))[1]::int AS year,
  i.invoice_type                                       AS type,
  MAX((regexp_match(i.invoice_number, '^(?:CR-|PF-)?(\d+)'))[1]::int) AS last_seq
FROM public.invoices i
WHERE i.invoice_number IS NOT NULL
  AND i.sender_id IS NOT NULL
  AND i.invoice_type IN ('factuur','creditnota','pro_forma')
  AND i.invoice_number ~ '^(?:CR-|PF-)?\d+-\d{4}$'
GROUP BY
  i.sender_id,
  (regexp_match(i.invoice_number, '(\d{4})$'))[1]::int,
  i.invoice_type
ON CONFLICT (user_id, year, type)
DO UPDATE SET last_seq = GREATEST(public.invoice_counters.last_seq, EXCLUDED.last_seq);

-- ---------------------------------------------------------------------
-- D. Customization config on profiles (NOT on invoices -- respects the
--    invoice schema freeze). template + padding ONLY; the live counter
--    stays single-source in invoice_counters; the start point and every
--    change are captured in the audit trail (logAuditAction), so there is
--    no redundant start_point column here.
--      invoice_number_template : e.g. '{seq}-{year}', '{year}-{seq}',
--                                '{seq}/{year}', 'INV-{seq}-{year}', '{seq}'.
--                                NULL/'' => default. {year} present => yearly
--                                reset; absent => continuous.
--      invoice_number_padding  : minimum zero-pad width for {seq} (045 => 3).
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invoice_number_template text,
  ADD COLUMN IF NOT EXISTS invoice_number_padding  int NOT NULL DEFAULT 3;

COMMENT ON COLUMN public.profiles.invoice_number_template IS
  '[FACTUUR-B] Template around {seq} (and optional {year}). NULL/empty = default {seq}-{year}. {year} present => yearly reset; absent => continuous.';
COMMENT ON COLUMN public.profiles.invoice_number_padding IS
  '[FACTUUR-B] Minimum zero-pad width for {seq} (e.g. 3 => 045).';

-- ---------------------------------------------------------------------
-- E. Drop the DEAD rpc generate_invoice_number(uuid). FACTUUR-A removed its
--    last caller; the function lingered as a parallel numbering path.
--    Closing the door for good.
--    Verify the exact signature BEFORE relying on this (expected: one uuid
--    arg). If it differs, IF EXISTS makes the line a silent no-op:
--      SELECT p.oid::regprocedure
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname='public' AND p.proname='generate_invoice_number';
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.generate_invoice_number(uuid);

-- ---------------------------------------------------------------------
-- F. UNIQUE safety net -- the duplicate pre-check (see header) MUST be clean.
--    Backstop against any future stray writer; the lib retries on 23505
--    (rare, self-healing against seeding drift). NULL invoice_number
--    (drafts) coexist -- NULLs are distinct in a UNIQUE constraint.
--    Guarded for re-run safety.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_sender_invoice_number_key'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_sender_invoice_number_key
      UNIQUE (sender_id, invoice_number);
  END IF;
END $$;

COMMIT;
