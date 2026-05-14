// app/onboarding/page.tsx
// First-login onboarding flow (BOEK-015)
// Middleware redirects here when onboarding_done = false

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const metadata = {
  title: "Welkom — BoekBrug",
};

export default async function OnboardingPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // If already onboarded, skip
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_done, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_done) redirect("/dashboard");

  return (
    <OnboardingWizard
      userName={profile?.full_name ?? user.email ?? "daar"}
    />
  );
}