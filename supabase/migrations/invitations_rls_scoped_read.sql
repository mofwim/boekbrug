-- =====================================================================
-- [SEC-INVITE] Scope invitation reads to the inviter or the invitee
-- =====================================================================
-- Problem (confirmed):
--   The invitations SELECT policy was:
--       CREATE POLICY "public can read invitations" ON public.invitations
--         FOR SELECT TO public USING (true);
--   → ANY caller, including anonymous, could read EVERY invitation row,
--     i.e. every accept-token (UUID) and every invited e-mail address.
--   Combined with an accept route that trusted the token alone, this
--   enabled invitation hijack / horizontal privilege escalation
--   (a stranger becoming another ZZP'er's accountant).
--
-- Application layer (already shipped, separate commit):
--   /api/invite/accept now verifies the accepting user's e-mail equals
--   the invitation's invitee e-mail (accountant_email) before linking.
--   That closes the exploit. THIS migration is defence-in-depth: it stops
--   the information disclosure (token + e-mail enumeration) at the DB.
--
-- Safety / compatibility (verified against every reader of `invitations`):
--   * /api/invite/info        → reads via service_role (bypasses RLS)      → OK
--   * /api/invite/accept       → the INVITEE reads by token; matches
--                                lower(accountant_email)=lower(auth.email()) → OK
--   * /api/accountant/invite   → the INVITER (accountant) reads its own
--     & repository.inviteClient  rows; matches auth.uid()=zzper_id
--                                (zzper_id is now set to the accountant id) → OK
--   * INSERT policy unchanged: WITH CHECK (auth.uid() = zzper_id).
--   No session-side reader remains that needs the public policy.
--
-- Reversibility: fully reversible — see the ROLLBACK block at the bottom.
-- Review before applying (this repo applies migrations deliberately).
-- =====================================================================

-- ---------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "public can read invitations" ON public.invitations;

CREATE POLICY "invitee or inviter can read invitations" ON public.invitations
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = zzper_id
    OR lower(accountant_email) = lower(auth.email())
  );

-- ---------------------------------------------------------------------
-- ROLLBACK (run to restore the previous behaviour exactly)
-- ---------------------------------------------------------------------
-- DROP POLICY IF EXISTS "invitee or inviter can read invitations" ON public.invitations;
-- CREATE POLICY "public can read invitations" ON public.invitations
--   FOR SELECT TO public USING (true);
