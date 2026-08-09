-- supabase/migrations/vat_statement_note.sql
-- [BTW-VERKLARING] The owner's own sentence explaining why an invoice carries no btw.
--
-- WHY A FREE-TEXT COLUMN AND NOT A CODE
-- The app knows THAT a line is exempt (invoice_lines.vat_treatment = 'exempt'); it can never know
-- WHICH exemption applies. Those live in art. 11 Wet OB and the applicable provision depends on
-- the trade — education, care, insurance and the rest each have their own. Deriving one and
-- printing it would put a false legal ground on a customer's invoice, which is worse than the
-- silence it replaces. So the owner writes their line once and every invoice carries it.
--
-- The same field covers a plain 0% invoice (export, intra-EU goods, certain services), where the
-- app has no basis for a reason at all. Empty is the normal state and means the document stays
-- silent, exactly as it did before this column existed.
--
-- NOT for the KOR and NOT for verlegd: those two the app derives itself, from profiles.kor_active
-- and from the customer's EU VAT number. See src/lib/vat-statement.ts.
--
-- Safe to apply at any time. Nullable, no default, no backfill: every existing profile keeps
-- exactly the behaviour it has now.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vat_statement_note text;

COMMENT ON COLUMN public.profiles.vat_statement_note IS
  'Vrije toelichting die op de factuur verschijnt wanneer er geen btw wordt berekend '
  '(vrijgestelde prestatie of 0%). Niet gebruikt bij KOR of btw verlegd — die leidt de app zelf af.';
