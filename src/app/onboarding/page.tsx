// app/onboarding/page.tsx
// [BOEK-015] Onboarding entry point
// Reads: onboarding_step, role, preferred_language → resumes where user stopped

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, onboarding_done, onboarding_step, role, preferred_language")
    .eq("id", user.id)
    .single();

  // Already finished — send to dashboard
  if (profile?.onboarding_done) redirect("/dashboard");

  const userName = profile?.full_name ?? user.email ?? "daar";
  const initialStep = profile?.onboarding_step ?? 1;
  const initialRole = profile?.role === "accountant" ? "accountant" : "zzp";
  // [BOEK-015] Pass saved language so Step 1 shows the already-selected option
  const initialLanguage =
    (["nl", "en", "ar", "tr"] as const).find((l) => l === profile?.preferred_language) ?? "nl";

  return (
    <OnboardingWizard
      userName={userName}
      initialStep={initialStep}
      initialRole={initialRole}
      initialLanguage={initialLanguage}
    />
  );
}