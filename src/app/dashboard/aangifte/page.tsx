// src/app/dashboard/aangifte/page.tsx
// [AANGIFTE] Server wrapper — auth guard, then the concept BTW-aangifte client.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import AangifteClient from "./AangifteClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Concept BTW-aangifte — BoekBrug" };

export default async function AangiftePage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <AangifteClient />;
}
