// src/app/onboarding/page.tsx
// [BOEK-015] fix: create profile if null, clamp step to min 1

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let { data: profile } = await supabase
    .from("profiles")
    .select("full_name, onboarding_done, onboarding_step, role, email")
    .eq("id", user.id)
    .single();

  // [BOEK-015] fix: profile missing → create it so onboarding can proceed
  if (!profile) {
    await supabase.from("profiles").insert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name ?? null,
      onboarding_step: 1,
      onboarding_done: false,
      role: "zzp",
    });

    // Re-fetch after insert
    const { data: fresh } = await supabase
      .from("profiles")
      .select("full_name, onboarding_done, onboarding_step, role, email")
      .eq("id", user.id)
      .single();

    profile = fresh;
  }

  if (profile?.onboarding_done) redirect("/dashboard");

  const userName =
    profile?.full_name ??
    user.user_metadata?.full_name ??
    user.email ??
    "daar";

  // [BOEK-015] fix: onboarding_step = 0 in DB → clamp to 1 so Step 1 renders
  const initialStep = Math.max(1, profile?.onboarding_step ?? 1);
  const initialRole = profile?.role === "accountant" ? "accountant" : "zzp";

  return (
    <OnboardingWizard
      userName={userName}
      userEmail={user.email ?? ""}
      initialStep={initialStep}
      initialRole={initialRole}
    />
  );
}