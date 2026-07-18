// src/app/dashboard/dagomzet/page.tsx
// [TURNOVER-IMPORT] Server wrapper — auth guard, then the self-contained import client.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import DagomzetImportClient from "./DagomzetImportClient";
import TurnoverInsights from "./TurnoverInsights";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dagomzet — BoekBrug" };

export default async function DagomzetPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // [TURNOVER-SHOW] Show the BOOKED omzet first (KPI's, maand-trend, BTW- en betaalverdeling) so a
  // returning owner sees their kassa-omzet instead of an empty import screen — then the import panel
  // below for adding more. TurnoverInsights renders nothing when there is no booked data yet.
  return (
    <>
      <TurnoverInsights />
      <DagomzetImportClient />
    </>
  );
}
