-- [BESTE] Two facts every package keeps on a customer and BoekBrug did not: the phone, and the
-- payment term agreed with THIS customer.
--
-- The term is what the new-invoice screen pre-fills the due date from when the customer is
-- picked; null means "the app default" (payment-term.ts), never 0 days. The bound is the same
-- typo guard as MAX_PAYMENT_TERM_DAYS.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS payment_term_days smallint
  CHECK (payment_term_days IS NULL OR (payment_term_days >= 0 AND payment_term_days <= 365));
COMMENT ON COLUMN public.clients.phone IS '[BESTE] The customer''s phone, as typed by the owner.';
COMMENT ON COLUMN public.clients.payment_term_days IS
  '[BESTE] The payment term agreed with THIS customer, in days; null = the app default (payment-term.ts).';
