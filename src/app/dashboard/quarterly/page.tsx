// app/dashboard/quarterly/page.tsx
// Quarterly overview page (BOEK-013)

import { Suspense } from "react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getSessionUser } from "@/lib/session-user";
import { redirect } from "next/navigation";
import { QuarterlyOverview } from "@/components/quarterly/QuarterlyOverview";
import { COLUMN } from "@/lib/design/tokens";
// [TAAL] The one line this page speaks itself; the overview below reads the catalogue already.
import { serverTranslator } from "@/lib/i18n/server";

export const metadata = {
  title: "Kwartaaloverzicht — BoekBrug",
};

export default async function QuarterlyPage() {
  const supabase = await createServerSupabaseClient();
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAccountant = profile?.role === "accountant";
  // [BOEK-013] role for navigation helper in QuarterlyOverview
  const role = isAccountant ? "accountant" : "zzper";
  const t = await serverTranslator();

  // [HEADER-SYSTEM] Title "Kwartaaloverzicht" + back live in the shared sub-page
  // bar (DashboardChrome/STATIC_TITLES); the in-body h1 that repeated it was
  // removed. The one-line description stays as intro copy.
  return (
    <div className="mx-auto px-4 py-8" style={{ maxWidth: COLUMN.work }}>
      <p className="text-muted-foreground text-sm mb-6">
        {t("kwo.intro")}
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