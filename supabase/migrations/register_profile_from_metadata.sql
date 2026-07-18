-- supabase/migrations/register_profile_from_metadata.sql
-- [COHERENCE-REGISTER] Populate the profile from signup metadata inside the
-- handle_new_user trigger (SECURITY DEFINER → bypasses RLS), so registration works
-- when email confirmation is ENABLED.
--
-- The bug it fixes: register/page.tsx wrote the profile from the browser with
-- supabase.from('profiles').upsert(...) immediately after signUp(). With email
-- confirmation on, signUp returns a user but NO session, so the browser is still the
-- anon role. The profiles INSERT/UPDATE policies are `TO authenticated WITH CHECK
-- (id = auth.uid())` — no anon grant — so the upsert was rejected by RLS, the handler
-- errored with "Profiel aanmaken mislukt", and the "Controleer je e-mail" screen was
-- never reached. The account existed but the registration UX was a dead end.
--
-- Fix: the trigger already fires on auth.users INSERT as SECURITY DEFINER. Extend it
-- to read role / company_name / kvk_number / btw_number / onboarding_step from
-- raw_user_meta_data (which signUp's options.data fills), with the same safe defaults
-- as before when a field is absent (e.g. Google OAuth signups that pass no metadata).
-- The client no longer writes the profile at all, so there is no anon-RLS path to fail.
--
-- Idempotent: CREATE OR REPLACE. Re-running is safe. No data migration needed.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  meta jsonb := COALESCE(new.raw_user_meta_data, '{}'::jsonb);
  v_role text;
  v_step int;
BEGIN
  -- Role: only the two known values are accepted; anything else (or absent) → 'zzper'.
  v_role := CASE
    WHEN meta->>'role' IN ('zzper', 'accountant') THEN meta->>'role'
    ELSE 'zzper'
  END;

  -- Onboarding step: register skips the welcome/role/company screens (passes 4).
  -- Absent/invalid → 1 (full wizard), matching the previous hard-coded default.
  BEGIN
    v_step := COALESCE(NULLIF(meta->>'onboarding_step', ''), '1')::int;
  EXCEPTION WHEN others THEN
    v_step := 1;
  END;
  IF v_step IS NULL OR v_step < 1 THEN
    v_step := 1;
  END IF;

  INSERT INTO public.profiles (
    id, email, full_name,
    company_name, kvk_number, btw_number,
    onboarding_step, onboarding_done, role
  ) VALUES (
    new.id,
    new.email,
    NULLIF(meta->>'full_name', ''),
    NULLIF(meta->>'company_name', ''),
    NULLIF(meta->>'kvk_number', ''),
    NULLIF(meta->>'btw_number', ''),
    v_step,
    false,
    v_role
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;
