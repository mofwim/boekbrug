// src/app/onboarding/page.tsx
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // [HERVATTEN] Mét de bedrijfsgegevens die er al staan. Ze werden hier niet gelezen en dus ook
  // niet meegegeven, terwijl de wizard zijn formulier leeg begon — zie de toelichting bij
  // initialCompany in OnboardingWizard.
  let { data: profile } = await supabase
    .from("profiles")
    .select("full_name, onboarding_done, onboarding_step, role, email, company_name, kvk_number, btw_number, iban, address")
    .eq("id", user.id)
    .single();

  // [KLUIS] Een archiefaccount heeft hier niets te zoeken: deze wizard vraagt om
  // bedrijfsgegevens, een mailboxkoppeling en een eerste factuur, en wie zijn gestopte zaak
  // komt archiveren heeft geen van drieën. De trigger zet onboarding_done al op true bij
  // registratie, dus normaal komt hij hier nooit — maar wie via een oude link of een
  // bookmark toch binnenvalt hoort in zijn kluis te landen en niet in een vragenlijst.
  //
  // Apart gelezen zodat de select hierboven blijft werken als de kolom nog niet bestaat.
  // ⚠️ En de redirect staat BUITEN de try: `redirect()` werkt door een NEXT_REDIRECT-fout te
  // gooien, dus binnen de try zou de catch hem opvangen en stilzwijgend negeren — de
  // gebruiker zag dan alsnog de wizard en niets verried waarom.
  let isArchief = false;
  try {
    const { data: doel } = await supabase
      .from("profiles")
      .select("account_purpose")
      .eq("id", user.id)
      .single();
    isArchief = doel?.account_purpose === "archief";
  } catch {
    /* kolom bestaat nog niet → gewoon de wizard, zoals altijd */
  }
  if (isArchief) redirect("/dashboard/kluis");

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
      .select("full_name, onboarding_done, onboarding_step, role, email, company_name, kvk_number, btw_number, iban, address")
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

  // [BOEK-015] P2 fix: role was explicitly chosen if profile.role is a real role
  // (not the auto-inserted default). We treat a saved 'accountant' OR a step > 1
  // as evidence the user already passed the role choice.
  const roleWasSet = profile?.role === "accountant" || (profile?.onboarding_step ?? 0) >= 2;

  return (
    <OnboardingWizard
      userName={userName}
      initialStep={initialStep}
      initialRole={initialRole}
      roleWasSet={roleWasSet}
      initialCompany={{
        company_name: profile?.company_name ?? "",
        kvk_number: profile?.kvk_number ?? "",
        btw_number: profile?.btw_number ?? "",
        iban: profile?.iban ?? "",
        address: profile?.address ?? "",
      }}
    />
  );
}