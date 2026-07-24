// app/dashboard/quarterly/page.tsx
// Quarterly overview page (BOEK-013)

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

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Kwartaaloverzicht</h1>
        <p className="text-muted-foreground text-sm mt-1">
          BTW-aangifte, totalen en export per kwartaal
        </p>
      </div>
      <QuarterlyOverview isAccountant={isAccountant} role={role} />
    </div>
  );
}