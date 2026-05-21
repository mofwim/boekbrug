// app/dashboard/quarterly/page.tsx
// Quarterly overview page (BOEK-013)

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { QuarterlyOverview } from "@/components/quarterly/QuarterlyOverview";import Link from "next/link";

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

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Terug naar dashboard
        </Link>
        <h1 className="text-2xl font-semibold">Kwartaaloverzicht</h1>
        <p className="text-muted-foreground text-sm mt-1">
          BTW-aangifte, totalen en export per kwartaal
        </p>
      </div>
      <QuarterlyOverview isAccountant={isAccountant} role={role} />
    </div>
  );
}