-- [ZELF-EERST] The owner's grip on the autopilot.
--
-- Auto-advance books a confident, clean incoming invoice without a tap. The bar is high and every
-- auto-booked row is tagged and reversible — but none of that answers a new owner's real
-- question, which is "how do I find out I can trust this?". The only honest answer is: check its
-- work for a while. This column lets them say so: FALSE means every read waits in the verify
-- queue for their tap, receipts included. Nothing about the reading itself changes.
--
-- Default TRUE: today's behavior, unchanged for everyone who never touches the switch.
--
-- [DEPLOY-SAFE] Both doors read this behind an isMissingColumn fallback (auto-boeken.ts), so the
-- deploy and this migration may land in either order: until the column exists, everyone is
-- treated as opted in — exactly what the default says. Any OTHER read failure answers FALSE
-- (wait for the human): wrongly waiting costs one tap, wrongly auto-booking overrides a stated
-- choice about money.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auto_boeken boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.auto_boeken IS
  '[ZELF-EERST] Whether confident clean reads may auto-book (invoice → received, settled bon → paid). FALSE = everything waits in the verify queue for the owner''s tap. Default on; the settings screen toggles it.';
