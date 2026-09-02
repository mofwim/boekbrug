-- =====================================================================
-- [NIET-DEZE-FACTUUR] The owner can say a suggestion is wrong, and the app remembers.
-- BoekBrug · 2 september 2026
-- =====================================================================
-- WHAT WAS MISSING. A bank line's card offered an invoice and one button: "Bevestig betaling".
-- There was no way to say the suggestion was WRONG. Reported on a card that proposed invoice
-- FAC/2026/00296 for a payment whose own bank description reads "26 00623" — a different invoice
-- entirely — under a green check. The owner could confirm it, or leave the line sitting there
-- forever. Neither is an answer, and the second means the same wrong pair is offered again on
-- every visit.
--
-- Ignoring the LINE existed (bank_transactions.ignore_reason) and is a different act: it says this
-- payment needs no invoice at all. Saying "not THIS invoice" is about one pair.
--
-- WHY A TABLE AND NOT A COLUMN. It is a many-to-many fact: one line can rule out several invoices
-- while still being open to the rest, which is exactly the case where a supplier has three bills
-- of the same amount. A column would hold one, and the second refusal would silently overwrite
-- the first.
--
-- WHAT IT IS NOT. It is not a negative memory about the SUPPLIER, and it must not become one. The
-- matcher's memory (match-memory.ts) is derived from confirmations and stays that way; this says
-- only "not this invoice for this line", the narrowest true statement. A rejection that taught the
-- matcher something general would let one mis-tap change how a whole counterparty is read.
--
-- REVERSIBLE. Deleting the row puts the suggestion back, which is what the screen's undo does.
-- ON DELETE CASCADE on both sides: a rejection about a line or an invoice that no longer exists is
-- not a fact worth keeping, and a dangling one would hide a suggestion for a reason nobody can see.
--
-- [DEPLOY-SAFE] The code ships before this is applied. Until then the button still works for the
-- session and simply does not survive a reload — the route treats a missing table as "no
-- rejections", which is exactly today's behaviour.
--
-- APPLY: run this whole file in the Supabase SQL editor. It creates one table. Nothing is deleted.
-- Idempotent / re-runnable.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.bank_match_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One refusal per pair per owner. Without it a second tap writes a second row and the undo removes
-- only one of them, so the suggestion would come back looking like the app forgot.
CREATE UNIQUE INDEX IF NOT EXISTS bank_match_rejections_unique
  ON public.bank_match_rejections (user_id, transaction_id, invoice_id);
-- The read is always "everything this owner has refused", once per page load.
CREATE INDEX IF NOT EXISTS bank_match_rejections_user
  ON public.bank_match_rejections (user_id);

ALTER TABLE public.bank_match_rejections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_match_rejections_select_own ON public.bank_match_rejections;
CREATE POLICY bank_match_rejections_select_own ON public.bank_match_rejections
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS bank_match_rejections_insert_own ON public.bank_match_rejections;
CREATE POLICY bank_match_rejections_insert_own ON public.bank_match_rejections
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS bank_match_rejections_delete_own ON public.bank_match_rejections;
CREATE POLICY bank_match_rejections_delete_own ON public.bank_match_rejections
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
-- No UPDATE policy on purpose: a rejection is made or withdrawn, never edited into a different
-- pair. Rewriting one would move a refusal to an invoice the owner never looked at.

COMMENT ON TABLE public.bank_match_rejections IS
  '[NIET-DEZE-FACTUUR] One (bank line, invoice) pair the owner has said do not belong together. Narrowest true statement: never a judgement about the supplier. Deleting the row restores the suggestion.';

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Must return true.
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'bank_match_rejections'
) AS table_bestaat;
