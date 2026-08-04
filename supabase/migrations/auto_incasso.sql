-- [AUTO-INCASSO] Which suppliers collect their invoices themselves.
--
-- Rent, energy, insurance, the accountant's monthly fee: the money leaves the account on its own.
-- The invoice still arrives and still has to be booked, but there is nothing for the owner to do —
-- and until now the app could not tell the difference. It showed those invoices as "te laat", kept
-- them at the top of Vandaag's "Te betalen", and offered a "Betalen" button that would hand the
-- supplier a SECOND copy of money that had already left.
--
-- Why this lives on the supplier and not on the invoice, and never on an amount:
-- being direct-debited is a property of the relationship — a mandate signed once — not of a
-- number. A rule keyed on "same supplier AND same amount" breaks on the two ordinary cases: a
-- supplier that sends more than one invoice (the pair that started this differ by € 8,74), and an
-- amount that changes (rent is indexed every 1 July). Both break SILENTLY, at the moment the owner
-- has stopped watching because the app has been handling it for a year.
--
-- Additive and defaulted, so the column is safe to add ahead of the code that reads it, and the
-- code is safe to ship ahead of the column (see incassoSupported() — every reader treats a missing
-- column as "no supplier is on incasso", which is exactly today's behaviour).

BEGIN;

ALTER TABLE public.suppliers
  -- The mandate: this supplier's invoices are collected automatically.
  ADD COLUMN IF NOT EXISTS auto_incasso boolean NOT NULL DEFAULT false,
  -- When the owner said so. Not a filter — invoices from BEFORE this date were collected too, and
  -- refusing to settle them would leave exactly the backlog this feature exists to clear. It is
  -- here so the audit trail can answer "since when did the app assume this", which is the question
  -- that matters if a booking is ever disputed.
  ADD COLUMN IF NOT EXISTS auto_incasso_since date;

-- The settle pass asks one question per user: "which of my suppliers are on incasso?". Partial, so
-- the index holds only the handful of rows that are true rather than every supplier in the book.
CREATE INDEX IF NOT EXISTS idx_suppliers_auto_incasso
  ON public.suppliers (user_id)
  WHERE auto_incasso;

COMMENT ON COLUMN public.suppliers.auto_incasso IS
  '[AUTO-INCASSO] This supplier collects by automatische incasso. Their invoices lose the "te laat" badge and the Betalen button (which would be a double payment), and are booked as paid after their vervaldatum has passed — never before, never a creditnota, and never one flagged duplicate / changed-IBAN / multi-invoice / arithmetic. See src/lib/auto-incasso.ts.';
COMMENT ON COLUMN public.suppliers.auto_incasso_since IS
  '[AUTO-INCASSO] The day the owner marked this supplier as collected automatically. Audit trail only — older invoices are settled too, because they were collected too.';

COMMIT;
