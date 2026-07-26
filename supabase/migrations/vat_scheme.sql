-- =====================================================================
-- [KASSTELSEL] BTW scheme election: factuurstelsel (accrual) vs kasstelsel (cash basis).
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: BoekBrug computes BTW purely on the accrual (factuurstelsel) basis — an
-- invoice's omzet/voorbelasting lands in the quarter of its INVOICE date. But
-- many small B2C businesses (retail, horeca, kappers) use the KASSTELSEL, where
-- BTW is due in the quarter the invoice is PAID (and voorbelasting deductible in
-- the quarter you pay the supplier). Applying the accrual timing to a kasstelsel
-- owner puts the BTW in the WRONG quarter — a wrong number on the aangifte.
--
-- This is the owner's election. Two columns:
--   vat_scheme       'factuur' (default) | 'kas'. Default keeps every existing
--                    owner BYTE-IDENTICAL post-migration — no behaviour change
--                    until an owner switches to 'kas'.
--   vat_scheme_since the effective date of the CURRENT scheme. REQUIRED so a
--                    switch is applied per-quarter (a quarter is computed under
--                    the scheme in force for THAT quarter's dates) and never
--                    retroactively rewrites an already-filed quarter on the
--                    recompute-on-read truth layer.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- =====================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vat_scheme text NOT NULL DEFAULT 'factuur'
    CHECK (vat_scheme IN ('factuur', 'kas'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vat_scheme_since date;

COMMENT ON COLUMN public.profiles.vat_scheme IS
  '[KASSTELSEL] BTW basis: factuur (accrual, default) or kas (cash basis — BTW due on payment date). Drives per-quarter VAT timing; default factuur = no behaviour change.';
COMMENT ON COLUMN public.profiles.vat_scheme_since IS
  '[KASSTELSEL] Effective date of the current vat_scheme. A quarter is computed under the scheme in force for that quarter; quarters before this date keep their prior scheme (never retroactively rewritten).';

COMMIT;
