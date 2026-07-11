// src/app/dashboard/resultaat/page.tsx
// [RESULT] Server wrapper — auth guard, then the self-contained result client.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import ResultaatClient from "./ResultaatClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resultaat — BoekBrug" };

export default async function ResultaatPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <ResultaatClient />;
}
