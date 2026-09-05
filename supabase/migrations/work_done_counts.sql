-- supabase/migrations/work_done_counts.sql
-- [WERK-GEDAAN] Count what the app did for one owner in one PROCESSING window.
--
-- APPLY: run in the Supabase SQL editor. Creates one function. No data is read, written or moved
-- by applying it. Idempotent.
--
-- ── WHY A FUNCTION AND NOT A QUERY FROM THE ROUTE ──
-- Two of these counts ask whether a jsonb column CONTAINS a key (`field_confidence ? '_grounding'`).
-- That is one operator in SQL and an unproven filter shape over PostgREST — and this codebase uses
-- json-path filters nowhere else, so the route would have been the first to try one. A filter that
-- is syntactically accepted and semantically wrong returns 0 without an error, and 0 is the single
-- worst answer this feature can give: the whole surface exists to state how much work was done, on
-- a screen an accountant will check. So the counting happens in SQL, where the operator is exact.
--
-- ── WHY created_at AND NOT THE DOCUMENT'S OWN DATE ──
-- The question is "how much work did you do for me between these dates", so the axis is when the
-- APP acted, not when the money moved. Measured while writing this: counting invoices by their
-- fiscal quarter gave 0 for Q2 2026 — the whole administration was imported in July, so every Q2
-- invoice was processed outside Q2. Mixing the two axes in one total (bank lines by value date,
-- invoices by import date) produces a number that falls apart the moment anyone checks it.
--
-- One known imprecision, stated rather than hidden: a bank line categorised weeks after it was
-- imported is counted in the import window, because the categorisation moment is not stored. That
-- shifts work earlier, never invents it.

CREATE OR REPLACE FUNCTION public.work_done_counts(
  p_owner uuid,
  p_from  date,
  p_to    date
)
RETURNS TABLE(
  invoices_from_email     bigint,
  invoices_auto_verified  bigint,
  bank_lines_categorised  bigint,
  bank_lines_matched      bigint,
  till_days_imported      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (SELECT count(*) FROM public.invoices i
      WHERE i.receiver_id = p_owner AND i.direction = 'incoming'
        AND i.created_at >= p_from AND i.created_at < (p_to + 1)
        AND i.field_confidence ? '_grounding'),
    (SELECT count(*) FROM public.invoices i
      WHERE i.receiver_id = p_owner AND i.direction = 'incoming'
        AND i.created_at >= p_from AND i.created_at < (p_to + 1)
        AND i.field_confidence ? '_auto_verified'),
    (SELECT count(*) FROM public.bank_transactions b
      WHERE b.user_id = p_owner
        AND b.created_at >= p_from AND b.created_at < (p_to + 1)
        AND b.category_source IN ('memory','ai','supplier')),
    (SELECT count(*) FROM public.bank_transactions b
      WHERE b.user_id = p_owner
        AND b.created_at >= p_from AND b.created_at < (p_to + 1)
        AND b.invoice_id IS NOT NULL AND coalesce(b.auto_match_reason,'') <> ''),
    (SELECT count(*) FROM public.daily_turnover d
      WHERE d.user_id = p_owner
        AND d.created_at >= p_from AND d.created_at < (p_to + 1));
$$;

-- SECURITY DEFINER because an accountant's session sees none of a client's rows under RLS, and the
-- route already proved the link before calling. Locked to the service role for exactly that reason:
-- the caller must be the pipeline, never a browser.
REVOKE ALL ON FUNCTION public.work_done_counts(uuid, date, date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.work_done_counts(uuid, date, date) IS
  'Aantal handelingen dat de app voor deze eigenaar deed tussen twee datums — geteld op het moment dat de app handelde (created_at), niet op de datum van het document. Zie src/lib/work-done.ts.';

-- ── CONTROLE ───────────────────────────────────────────────────────────────────
-- Verwacht voor Kiwi Food, 1 juli t/m 30 september 2026: 317 · 227 · 24 · 23 · 91.
--   SELECT * FROM public.work_done_counts(
--     'ac22189e-7052-4c48-b4ec-90947cf92ecc', '2026-07-01', '2026-09-30');
