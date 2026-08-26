-- [OCHTEND] The owner's choice about the morning mail.
--
-- The digest itself needs no schema: it reads bank_tx_invoices and invoices as they are. This
-- column exists ONLY so an owner can turn the mail off — a courtesy that cannot be declined is
-- not a courtesy. Default true: the mail already stays silent on every day without events, so
-- opt-out is the exception, not the norm.
--
-- [DEPLOY-SAFE] The cron reads this column behind an isMissingColumn fallback, so the deploy and
-- this migration may land in either order: until the column exists everyone is treated as opted
-- in, exactly what the default here says.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ochtend_mail boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.ochtend_mail IS
  '[OCHTEND] Whether the owner receives the morning digest mail (sent only on days with events: payments recorded on outgoing invoices, incoming invoices arrived). Default on; the settings screen toggles it.';
