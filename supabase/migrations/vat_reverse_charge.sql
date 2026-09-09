-- ─────────────────────────────────────────────────────────────────────────────
-- [VERLEGD-VERKOOP] A third btw treatment on a sales line: 'reverse_charge'.
--
-- The verleggingsregeling binnenland (art. 12 lid 5 Wet OB 1968 jo. art. 24b Uitvoeringsbesluit
-- OB 1968): a subcontractor in bouw, an uitzender, a cleaner, a scrap dealer invoices WITHOUT btw
-- and the customer accounts for it. The line carries 0% plus this flag — exactly the shape
-- 'exempt' already has — and the two are different money on the aangifte:
--
--   'exempt'          art. 11: no btw, the turnover reaches NO rubriek.
--   'reverse_charge'  art. 12 lid 5: no btw, the turnover is rubriek 1e ("niet bij u belast"),
--                     the customer declares the btw in their 2a.
--   NULL / 'taxed'    an ordinary taxed line, including a real 0% rate.
--
-- The CHECK constraint from vat_exemption.sql listed two values; it is replaced by the same
-- constraint with three. Nothing else changes: every existing row keeps its value, and a row that
-- carries NULL is still an ordinary taxed line.
--
-- Apply in the Supabase SQL editor. Until it is applied, saving a line with 'reverse_charge' fails
-- on this constraint (23514) and the app reports that instead of storing something else.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_vat_treatment_check;

ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_vat_treatment_check
  CHECK (vat_treatment IS NULL OR vat_treatment IN ('taxed', 'exempt', 'reverse_charge'));

COMMENT ON COLUMN public.invoice_lines.vat_treatment IS
  '[VRIJGESTELD] ''exempt'' = vrijgestelde prestatie (art. 11): telt als omzet, draagt geen BTW en hoort in GEEN rubriek. [VERLEGD-VERKOOP] ''reverse_charge'' = btw verlegd naar de afnemer (art. 12 lid 5): 0% op de regel, omzet in rubriek 1e, het btw-nummer van de afnemer op de factuur. ''taxed''/NULL = gewoon belast, inclusief een echt 0%-tarief (dat behoudt aftrekrecht).';
