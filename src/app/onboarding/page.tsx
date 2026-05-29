// src/app/onboarding/page.tsx
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

  if (!profile) {
    await supabase.from("profiles").insert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name ?? null,
      onboarding_step: 1,
      onboarding_done: false,
      role: "zzper",
    });

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