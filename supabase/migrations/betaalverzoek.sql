-- [BETAALVERZOEK] Anchor gateway #3 — the outgoing payment request (+ pay-QR).
-- Closes the cash loop: the owner shares a link, the customer pays from their OWN
-- bank to the owner's OWN IBAN with the invoice number as the payment reference,
-- and that reference rides back through bank-import → the reconciliation engine →
-- the invoice is marked paid. BoekBrug never touches the money (no PSP).
--
-- A public /pay/[token] page must be reachable by the customer WITHOUT a login, so
-- we need an unguessable handle for one invoice that does NOT expose the sequential
-- id or relax RLS. This adds a random per-invoice token, minted on demand when the
-- owner creates a betaalverzoek. The public read path is a service-role API that
-- returns ONLY a minimal projection keyed by this token — the invoices table itself
-- stays fully RLS-protected against anon.
--
-- Non-breaking: NULLABLE column (no token until a betaalverzoek is created), UNIQUE
-- so a token maps to exactly one invoice. Revocable by setting it back to NULL.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pay_token uuid;

-- One token ↔ one invoice. Partial UNIQUE index (only non-null tokens) so the many
-- token-less invoices don't collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_pay_token
  ON public.invoices (pay_token) WHERE pay_token IS NOT NULL;
