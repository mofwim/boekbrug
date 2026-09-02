-- =====================================================================
-- [ANON-ORAKEL] Three SECURITY DEFINER helpers answered questions about other people's business
-- to callers who were not signed in.
-- BoekBrug · September 2026
-- =====================================================================
-- WHAT WAS WRONG. A function created without an explicit REVOKE is granted to PUBLIC, and PUBLIC
-- includes `anon` — the role behind every unauthenticated request to /rest/v1/rpc/*. Three helpers
-- were therefore callable by anyone on the internet, and all three take the identity they answer
-- about as a PARAMETER rather than reading auth.uid():
--
--   has_active_invoice_mandate(accountant, client)  -> does this accountant hold an invoicing
--                                                      mandate over this client?
--   has_active_confirm_mandate(accountant, client)  -> ...and a confirmation mandate?
--   audit_row_is_about_me(type, entity_id, viewer)  -> is this invoice owned by this person?
--
-- SECURITY DEFINER means they answer with the owner's rights, so RLS never sees the question. The
-- last one is the sharpest: an invoice id plus a user id returns a yes/no about who owns which
-- document. UUIDs are not guessable, so this is not a mass leak — but "hard to guess" is not an
-- access control, and an id that appears in a payment link is not secret either.
--
-- WHY THIS IS SAFE TO REVOKE. These three are used ONLY inside policies whose role list is
-- {authenticated}: audit_logs_about_me, invoices_mandate_confirm_read/write,
-- invoices_mandate_draft_issue/read and invoice_lines_mandate_read. A policy expression runs with
-- the privileges of the role evaluating it, so removing anon's EXECUTE cannot break a policy that
-- anon never evaluates. No code in src/ calls any of them over RPC (checked: zero call sites).
--
-- WHAT IS DELIBERATELY LEFT ALONE, and this is the important half:
--
--   is_my_accountant_client(client)  KEEPS its PUBLIC grant. Three {public} policies call it —
--                                    invoices_accountant_read, invoices_accountant_update_v2,
--                                    invoice_lines_select_accountant, documents_accountant_read —
--                                    so an anonymous SELECT on invoices/documents EVALUATES it.
--                                    Revoking would turn those reads into a permission error
--                                    instead of an empty result. It is also not an oracle: it
--                                    reads auth.uid(), which is NULL for anon, so it always
--                                    answers false to a stranger.
--   acting_for_owner()               Same shape — auth.uid()-based, harmless to anon — and used by
--                                    seven policies. Left as it is rather than changed for tidiness.
--
-- Idempotent / re-runnable. Grants nothing new; only narrows.
-- =====================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.has_active_invoice_mandate(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_invoice_mandate(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_active_confirm_mandate(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_confirm_mandate(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.audit_row_is_about_me(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_row_is_about_me(text, uuid, uuid) TO authenticated, service_role;

COMMIT;

-- =====================================================================
-- CONTROLE (run separately after applying). The first three must be false, the last two true.
-- =====================================================================
-- select
--   has_function_privilege('anon', 'public.has_active_invoice_mandate(uuid,uuid)', 'EXECUTE') as anon_mandaat,
--   has_function_privilege('anon', 'public.has_active_confirm_mandate(uuid,uuid)', 'EXECUTE') as anon_bevestig,
--   has_function_privilege('anon', 'public.audit_row_is_about_me(text,uuid,uuid)', 'EXECUTE')  as anon_audit,
--   has_function_privilege('authenticated', 'public.has_active_invoice_mandate(uuid,uuid)', 'EXECUTE') as ingelogd_mandaat,
--   has_function_privilege('anon', 'public.is_my_accountant_client(uuid)', 'EXECUTE')          as anon_klantcheck_blijft;
