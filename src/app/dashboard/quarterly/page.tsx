// app/dashboard/quarterly/page.tsx
// Quarterly overview page (BOEK-013)

import { Suspense } from "react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { QuarterlyOverview } from "@/components/quarterly/QuarterlyOverview";

export const metadata = {
  title: "Kwartaaloverzicht — BoekBrug",
};

export default async function QuarterlyPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAccountant = profile?.role === "accountant";
  // [BOEK-013] role for navigation helper in QuarterlyOverview
  const role = isAccountant ? "accountant" : "zzper";

  // [HEADER-SYSTEM] Title "Kwartaaloverzicht" + back live in the shared sub-page
  // bar (DashboardChrome/STATIC_TITLES); the in-body h1 that repeated it was
  // removed. The one-line description stays as intro copy.
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <p className="text-muted-foreground text-sm mb-6">
        BTW-aangifte, totalen en export per kwartaal
      </p>
      {/* [QUARTER-DEEPLINK] QuarterlyOverview reads ?year&quarter so a link from another screen
          (e.g. waarheid's "Naar de BTW-aangifte van deze periode") opens the period it names.
          useSearchParams opts a client component into request-time rendering, so it must sit under
          a Suspense boundary — without one the whole route is forced dynamic and the build warns. */}
      <Suspense fallback={null}>
        <QuarterlyOverview isAccountant={isAccountant} role={role} />
      </Suspense>
    </div>
  );
}