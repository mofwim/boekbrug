-- supabase/queries/invoice_rounding_audit.sql
-- [AFROND-AUDIT] Which invoices do not add up, and which of those can still be fixed?
--
-- READ-ONLY. Every statement here is a SELECT. Nothing is written, nothing is corrected: an
-- issued invoice is a legal record (art. 35 Wet OB) and correcting one is a creditnota, never an
-- UPDATE. This file exists to tell you WHICH invoices are affected and WHICH are still drafts, so
-- the decision stays yours.
--
-- Run it in the Supabase SQL editor. It reports, in order:
--
--   1. one summary row — how many invoices, how much money, how much is still fixable
--   2. the invoices whose HEADER disagrees with their own lines
--   3. the LINES whose printed unit price does not multiply to their own amount
--   4. a control, so a query returning nothing is distinguishable from a query that cannot see
--
-- ── THE TWO DEFECTS IT LOOKS FOR, AND WHY THEY ARE NOT THE SAME QUESTION ──
--
-- A. HEADER vs LINES. invoices.total_ex_btw should equal the sum of its invoice_lines.line_total.
--    When it does not, the customer adds up the column and gets a different number than the total,
--    and an accountant recomputing the btw from the stated base gets a third. In a UBL e-invoice
--    it is fatal rather than confusing: Peppol BIS 3.0 BR-CO-10 requires
--    LegalMonetaryTotal/LineExtensionAmount to equal the sum of the line amounts, so the file is
--    refused at the receiving access point and the invoice never arrives.
--
-- B. PRICE vs LINE. round(quantity * unit_price, 2) should equal line_total. When it does not,
--    the invoice prints a unit price that does not produce its own line amount — the customer's
--    own multiplication fails on the page in front of them.
--
-- They have different causes and different fixes, which is why they are counted separately. An
-- invoice can have B on every line and still have a correct header.
--
-- ── WHAT IS DELIBERATELY NOT FLAGGED ──
--
--   · direction <> 'outgoing' — an incoming invoice's header is READ off a supplier's document,
--     not computed by this app. Its arithmetic is the supplier's, and import-health.ts already
--     judges it. Including it here would bury your own invoices under other people's.
--   · a document-level discount — invoices.discount_type is set. Then the header is SUPPOSED to
--     be lower than the sum of the lines, and calling that a defect would flag every discounted
--     invoice ever issued. Query 2 reports these in a separate column so you can see they were
--     considered rather than silently dropped.
--   · a difference under half a cent — that is float noise in the comparison, not in the books.
--
-- ── WHAT THIS CANNOT FIND, AND IT MATTERS ──
--
-- An invoice whose prices were rounded AND whose totals were then recomputed from those rounded
-- prices is INTERNALLY CONSISTENT. Header equals the sum of its lines; every line equals its own
-- price times its quantity. Verified on a fixture built from the reported invoice: the damaged
-- version passes both checks below in silence.
--
-- Nothing in the data remembers that it used to be EUR 368,80. Arithmetic cannot find it, and a
-- query that claimed to would be lying. The only witness left is the PDF that was actually sent,
-- which this app stores — comparing those is a document job, not a SQL job.
--
-- So read a clean result as "no invoice contradicts ITSELF", never as "every invoice is right".
--
-- ── A NOTE ON WHAT "FIXABLE" MEANS ──
-- status = 'draft' and no invoice_number: nothing has left the building, so re-saving the invoice
-- recomputes it. Anything else has been issued and its number is spent. The honest remedy there is
-- a creditnota plus a new invoice, and that is a business decision, not a script.

-- Optional: scope to one owner. Leave as-is for every invoice in the database.
--   \set owner '00000000-0000-0000-0000-000000000000'
--   ... AND i.sender_id = :'owner'


-- ═══ 1. SUMMARY ═══════════════════════════════════════════════════════════════════════════════
-- One row. Read this first: it says whether the rest is worth reading.

WITH line_sums AS (
  SELECT
    l.invoice_id,
    round(sum(coalesce(l.line_total, 0))::numeric, 2)                        AS lines_total,
    count(*)                                                                  AS line_count,
    -- Lines whose own price does not reproduce their own amount (defect B).
    count(*) FILTER (
      WHERE round((coalesce(l.quantity, 0) * coalesce(l.unit_price, 0))::numeric, 2)
         <> round(coalesce(l.line_total, 0)::numeric, 2)
    )                                                                         AS unreconciled_lines,
    -- How much money those lines are off by, in total, on this invoice.
    round(sum(abs(
      round((coalesce(l.quantity, 0) * coalesce(l.unit_price, 0))::numeric, 2)
      - round(coalesce(l.line_total, 0)::numeric, 2)
    ))::numeric, 2)                                                           AS line_error
  FROM public.invoice_lines l
  GROUP BY l.invoice_id
),
scoped AS (
  SELECT
    i.id, i.invoice_number, i.invoice_date, i.invoice_type, i.status, i.client_name,
    i.discount_type,
    round(coalesce(i.total_ex_btw, 0)::numeric, 2)                            AS header_ex,
    s.lines_total, s.line_count, s.unreconciled_lines, s.line_error,
    round(s.lines_total - round(coalesce(i.total_ex_btw, 0)::numeric, 2), 2)  AS difference,
    -- Nothing has left the building yet, so re-saving recomputes it.
    (i.status = 'draft' AND i.invoice_number IS NULL)                         AS still_fixable
  FROM public.invoices i
  JOIN line_sums s ON s.invoice_id = i.id
  WHERE i.direction = 'outgoing'
    AND i.archived_at IS NULL
)
SELECT
  count(*)                                                                    AS invoices_checked,
  count(*) FILTER (WHERE abs(difference) >= 0.005 AND discount_type IS NULL)  AS header_disagrees,
  count(*) FILTER (WHERE unreconciled_lines > 0)                              AS has_unreconciled_line,
  count(*) FILTER (WHERE abs(difference) >= 0.005 AND discount_type IS NULL AND still_fixable)
                                                                              AS of_which_still_draft,
  count(*) FILTER (WHERE discount_type IS NOT NULL)                           AS skipped_discounted,
  -- The money, as a total and as the worst single invoice. A hundred one-cent invoices and one
  -- fifty-euro invoice are different problems and the sum alone cannot tell them apart.
  coalesce(round(sum(abs(difference)) FILTER (WHERE abs(difference) >= 0.005 AND discount_type IS NULL), 2), 0)
                                                                              AS total_difference,
  coalesce(round(max(abs(difference)) FILTER (WHERE discount_type IS NULL), 2), 0)
                                                                              AS worst_single_invoice,
  -- The line-level money, separately. Measured on the fixtures: an invoice can be internally
  -- consistent at the header (difference 0,01) while one of its LINES is off by 0,65 — reporting
  -- only the header figure understates the damage by a factor of sixty.
  coalesce(round(sum(line_error), 2), 0)                                      AS total_line_error
FROM scoped;


-- ═══ 2. THE INVOICES WHOSE HEADER DISAGREES WITH THEIR OWN LINES ══════════════════════════════
-- Ordered by size of the difference, because that is the order in which they matter.

WITH line_sums AS (
  SELECT
    l.invoice_id,
    round(sum(coalesce(l.line_total, 0))::numeric, 2) AS lines_total,
    count(*)                                          AS line_count
  FROM public.invoice_lines l
  GROUP BY l.invoice_id
)
SELECT
  i.invoice_number,
  i.invoice_date,
  i.invoice_type,
  i.status,
  i.client_name,
  s.line_count,
  s.lines_total                                                     AS "sum of the lines",
  round(coalesce(i.total_ex_btw, 0)::numeric, 2)                    AS "header ex btw",
  round(s.lines_total - coalesce(i.total_ex_btw, 0)::numeric, 2)    AS difference,
  round(coalesce(i.btw_amount, 0)::numeric, 2)                      AS "stated btw",
  round(coalesce(i.total_inc_btw, 0)::numeric, 2)                   AS "total inc btw",
  CASE
    WHEN i.status = 'draft' AND i.invoice_number IS NULL
      THEN 'draft — opening and saving it recomputes the totals'
    ELSE 'issued — art. 35: correct with a creditnota, never by editing'
  END                                                               AS remedy
FROM public.invoices i
JOIN line_sums s ON s.invoice_id = i.id
WHERE i.direction = 'outgoing'
  AND i.archived_at IS NULL
  -- A document-level discount is SUPPOSED to make the header lower than the lines.
  AND i.discount_type IS NULL
  AND abs(round(s.lines_total - coalesce(i.total_ex_btw, 0)::numeric, 2)) >= 0.005
ORDER BY abs(round(s.lines_total - coalesce(i.total_ex_btw, 0)::numeric, 2)) DESC, i.invoice_date DESC;


-- ═══ 3. THE LINES WHOSE PRICE DOES NOT MULTIPLY TO THEIR OWN AMOUNT ═══════════════════════════
-- This is what the customer sees fail when they check the column by hand.

SELECT
  i.invoice_number,
  i.invoice_date,
  i.status,
  i.client_name,
  l.description,
  l.quantity,
  l.unit_price,
  round((coalesce(l.quantity, 0) * coalesce(l.unit_price, 0))::numeric, 2) AS "price x quantity",
  round(coalesce(l.line_total, 0)::numeric, 2)                             AS "stored line total",
  round(
    round((coalesce(l.quantity, 0) * coalesce(l.unit_price, 0))::numeric, 2)
    - round(coalesce(l.line_total, 0)::numeric, 2), 2
  )                                                                        AS difference
FROM public.invoice_lines l
JOIN public.invoices i ON i.id = l.invoice_id
WHERE i.direction = 'outgoing'
  AND i.archived_at IS NULL
  AND round((coalesce(l.quantity, 0) * coalesce(l.unit_price, 0))::numeric, 2)
   <> round(coalesce(l.line_total, 0)::numeric, 2)
ORDER BY abs(
  round((coalesce(l.quantity, 0) * coalesce(l.unit_price, 0))::numeric, 2)
  - round(coalesce(l.line_total, 0)::numeric, 2)
) DESC, i.invoice_date DESC;


-- ═══ 4. CONTROL ══════════════════════════════════════════════════════════════════════════════
-- Run this whenever queries 2 and 3 come back empty.
--
-- An empty result has two meanings and they are opposite: "nothing is wrong" and "this query
-- cannot see your invoices" (wrong project, RLS in the way, a filter that excludes everything).
-- A report that cannot tell those apart is worth nothing, and every other check in this codebase
-- carries the same guard for the same reason.
--
-- Expect: outgoing_invoices and lines both well above zero, and a handful in reconciles_exactly.
-- If outgoing_invoices is 0, queries 2 and 3 were never able to answer.

SELECT
  count(DISTINCT i.id)                                            AS outgoing_invoices,
  count(l.id)                                                     AS lines,
  count(l.id) FILTER (
    WHERE round((coalesce(l.quantity, 0) * coalesce(l.unit_price, 0))::numeric, 2)
        = round(coalesce(l.line_total, 0)::numeric, 2)
  )                                                               AS reconciles_exactly,
  min(i.invoice_date)                                             AS oldest,
  max(i.invoice_date)                                             AS newest
FROM public.invoices i
LEFT JOIN public.invoice_lines l ON l.invoice_id = i.id
WHERE i.direction = 'outgoing'
  AND i.archived_at IS NULL;
