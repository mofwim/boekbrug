// src/app/dashboard/kas/page.tsx
// [CASH-LEDGER] Server wrapper — auth guard, then the self-contained Kas client.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import KasClient from "./KasClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kas — BoekBrug" };

export default async function KasPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <KasClient />;
}
