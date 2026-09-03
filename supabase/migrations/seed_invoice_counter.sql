-- =====================================================================
-- [FACTUUR-B] seed_invoice_counter — forward-only in the DATABASE, not in a variable.
-- BoekBrug · August 2026
-- =====================================================================
-- ── WHAT WAS WRONG ──
--
-- /api/invoice/numbering seeds the counter when an owner picks a starting number. Its own header
-- says what it means to do:
--
--     seed invoice_counters.last_seq = MAX(startSeq-1, existing) FORWARD-ONLY
--
-- and the code was:
--
--     const { data: cur } = await supabase.from('invoice_counters').select('last_seq')…
--     const current = cur?.last_seq ?? 0
--     const target  = Math.max(desired.startSeq - 1, current)
--     await pipeline.from('invoice_counters').upsert({ …, last_seq: target }, { onConflict: … })
--
-- The MAX is real, and it is taken against a value read a few milliseconds earlier. The write that
-- follows is an unconditional SET. Between the two, next_invoice_seq can allocate — that function
-- is deliberately atomic precisely because two invoices can be numbered at the same instant — and
-- then the upsert writes a SMALLER last_seq than the counter had. The counter goes BACKWARDS, and
-- the next invoice is numbered with a sequence that has already been used.
--
-- ── WHY THIS IS WORTH A MIGRATION FOR A RARE RACE ──
--
-- The window is narrow: numbering can only be changed while no factuur has been issued for the
-- year, so it needs a first invoice being sent in the same breath as a settings change. It is
-- narrow and it is not closed, and what is on the other side of it is not a display bug.
--
-- Article 35 Wet OB 1968 requires invoice numbers to be sequential. A regressed counter produces a
-- duplicate, and the UNIQUE constraint on (sender_id, invoice_number) turns most of those into a
-- retry — but only while both invoices still exist. Delete or archive the earlier one and the
-- number is simply reissued, quietly, with two different documents having carried it.
--
-- The fix is to stop computing the maximum in the application at all. GREATEST inside the UPDATE
-- is evaluated against the row as it is AT WRITE TIME, under the lock ON CONFLICT already takes —
-- the same mechanism next_invoice_seq relies on, and the same one the original migration used for
-- its own seeding pass (factuur_b_numbering.sql §C) while the route that came later did not.
--
-- It also RETURNS what actually landed. The route reported `target + 1` as the owner's first
-- number, which is what it asked for rather than what the counter says — so on the one occasion
-- the seed was clamped, the confirmation screen showed a number the next invoice would not carry.
--
-- APPLY: run in the Supabase SQL editor. Creates one function. No data changed.
-- Depends on factuur_b_numbering.sql (invoice_counters).
-- =====================================================================

--
-- ── [RPC-ANON-REVOKE] DIT BESTAND HEROPENT EEN DEUR DIE BEWUST DICHT IS ─────────────────────
--
-- De GRANT onderaan geeft `authenticated` EXECUTE op seed_invoice_counter, en rpc_anon_revoke.sql
-- neemt dat recht juist WEG: "zijn eigen teller op 999999999 zetten" is geen functie die iemand
-- hoort te hebben, en geen enkele call site roept deze met een sessieclient aan.
--
-- Vandaag staat het recht ingetrokken in productie — gemeten op 2 september 2026. Dat blijft zo
-- zolang dit bestand niet opnieuw gedraaid wordt. Draai je het wél, draai dan daarna
-- rpc_anon_revoke.sql opnieuw; die is idempotent en zet de grens in één keer terug.
--

BEGIN;

-- ── Drop first, and drop EVERY overload ───────────────────────────────────────────────────────
--
-- CREATE OR REPLACE cannot change a function's return type or the NAMES of its parameters. Where
-- some earlier version of this function already exists under a different shape, the statement
-- below fails with
--
--     ERROR:  cannot change name of input parameter "uid"
--     HINT:   Use DROP FUNCTION seed_invoice_counter(uuid,integer,text,integer) first.
--
-- and because this file is one transaction, the whole thing rolls back. The old function stays,
-- nothing says so afterwards, and a schema check keeps reporting the migration as not applied
-- while the owner is certain they ran it. That is exactly how this was found.
--
-- Every overload BY NAME, not one signature: a DROP that names the arguments only matches the
-- shape it names, and the shape blocking the replace is by definition a different one. This
-- function is app-owned, called from one route through PostgREST, and referenced by no view,
-- default or constraint, so there is nothing for a drop to break.
--
-- Idempotent: on a database that has never seen it, the loop simply finds nothing.
DO $drop$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'seed_invoice_counter'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END
$drop$;

CREATE OR REPLACE FUNCTION public.seed_invoice_counter(
  p_user_id  uuid,
  p_year     int,
  p_type     text,
  p_last_seq int
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_seq int;
BEGIN
  -- Same contract as next_invoice_seq, apply_bank_payment and allocate_bank_payment: with the
  -- session client auth.uid() is the caller and must equal p_user_id; with service-role it is NULL
  -- and the call is pinned by p_user_id alone. This function is GRANTed to `authenticated` and
  -- PostgREST exposes every such function at /rest/v1/rpc/ with the anon key that ships in the
  -- browser bundle, so without this line any registered user could reset a stranger's numbering.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[FACTUUR-B] caller % may not seed the counter of %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_type NOT IN ('factuur', 'creditnota', 'pro_forma') THEN
    RAISE EXCEPTION '[FACTUUR-B] unknown invoice type %', p_type USING ERRCODE = '22023';
  END IF;

  -- A counter is a count of documents that exist. Negative is not a smaller start, it is nonsense,
  -- and it would let the next allocation return 0 or a negative sequence.
  IF p_last_seq IS NULL OR p_last_seq < 0 THEN
    RAISE EXCEPTION '[FACTUUR-B] a counter may not start below zero (got %)', p_last_seq
      USING ERRCODE = '22023';
  END IF;

  -- ── THE WHOLE POINT ──
  -- GREATEST is evaluated against the row AS IT IS NOW, under the lock ON CONFLICT takes, so an
  -- allocation that happened while the caller was deciding cannot be undone. Forward-only by
  -- construction rather than by a variable that was true a moment ago.
  INSERT INTO public.invoice_counters (user_id, year, type, last_seq)
  VALUES (p_user_id, p_year, p_type, p_last_seq)
  ON CONFLICT (user_id, year, type)
  DO UPDATE SET last_seq = GREATEST(public.invoice_counters.last_seq, EXCLUDED.last_seq)
  RETURNING last_seq INTO v_seq;

  -- What LANDED, not what was asked for. The caller reports the owner's first number from this.
  RETURN v_seq;
END;
$$;

COMMENT ON FUNCTION public.seed_invoice_counter(uuid, int, text, int) IS
  '[FACTUUR-B] Seeds invoice_counters.last_seq forward-only, with GREATEST evaluated under the ON CONFLICT lock, and returns the value that actually landed. Replaces a read-then-unconditional-upsert in /api/invoice/numbering whose MAX was computed against a stale read — a concurrent next_invoice_seq could make the counter go backwards and reissue a sequence (Art. 35 Wet OB 1968).';

REVOKE ALL ON FUNCTION public.seed_invoice_counter(uuid, int, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_invoice_counter(uuid, int, text, int)
  TO authenticated, service_role;

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
--   -- an ordinary first seed
--   select public.seed_invoice_counter(:user, 2026, 'factuur', 99);   -- 99
--   -- a LOWER seed is refused by the data, not by the caller
--   select public.seed_invoice_counter(:user, 2026, 'factuur', 40);   -- still 99
--   -- and forward still moves
--   select public.seed_invoice_counter(:user, 2026, 'factuur', 250);  -- 250
--
--   -- the race itself: read 99, allocate concurrently, then seed with the stale max
--   select public.next_invoice_seq(:user, 2026, 'factuur');           -- 251
--   select public.seed_invoice_counter(:user, 2026, 'factuur', 99);   -- 251, NOT 99
-- =====================================================================
