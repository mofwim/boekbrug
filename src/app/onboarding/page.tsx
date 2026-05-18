// src/app/onboarding/page.tsx
// [BOEK-015] Onboarding entry point — resumes from saved step

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, onboarding_done, onboarding_step, role")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_done) redirect("/dashboard");

  const userName = profile?.full_name ?? user.email ?? "daar";
  const initialStep = profile?.onboarding_step ?? 1;
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