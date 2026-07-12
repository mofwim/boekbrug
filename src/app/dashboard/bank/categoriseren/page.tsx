// src/app/dashboard/bank/categoriseren/page.tsx
// [BANK-IDENTITY] Server wrapper — auth guard, then the self-contained client.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import CategoriseClient from "./CategoriseClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Categoriseren — BoekBrug" };

export default async function CategoriseerPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <CategoriseClient />;
}
