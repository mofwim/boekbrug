-- =====================================================================
-- [BANK-AMOUNT-ONLY] auto_match_reason on bank_transactions
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: the app auto-confirms two tiers of near-certain bank matches:
--   'certain'      — the invoice NUMBER is printed in the statement (or the
--                    supplier IBAN matches) AND the amount is exact. Decisive
--                    identity; booked silently.
--   'amount_only'  — no printed number/IBAN, but the EXACT amount + a matching
--                    counterpart NAME + a clear single winner. Strong, but a
--                    recurring same-amount supplier could in theory be the wrong
--                    month if the true invoice isn't imported yet. So the owner
--                    asked for these to be auto-booked but VISIBLY FLAGGED
--                    ("op bedrag gekoppeld — controleer") on the Gekoppeld tab,
--                    with the same one-tap Ontkoppelen as every other match.
--
-- This column records which tier booked a line so the UI can show that flag.
-- NULL = booked by the certain tier (or confirmed by a human) — no flag needed.
-- Display-only: the money-truth is still tx.invoice_id + invoice.status, and a
-- bank confirmation never touches omzet/BTW (accrual). Fully reversible.
--
-- Safe to run more than once (IF NOT EXISTS). No backfill: existing matched
-- lines stay NULL (unflagged), which is correct — they were booked under the
-- old certain-only rule or confirmed by hand.
-- =====================================================================

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS auto_match_reason text;

COMMENT ON COLUMN public.bank_transactions.auto_match_reason IS
  'Which auto-confirm tier booked this link: ''amount_only'' → flag "controleer" in the UI; NULL → certain match or human-confirmed (no flag).';
