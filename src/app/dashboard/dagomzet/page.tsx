// src/app/dashboard/dagomzet/page.tsx
// [TURNOVER-IMPORT] Server wrapper — auth guard, then the self-contained import client.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import DagomzetImportClient from "./DagomzetImportClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dagomzet importeren — BoekBrug" };

export default async function DagomzetPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <DagomzetImportClient />;
}
