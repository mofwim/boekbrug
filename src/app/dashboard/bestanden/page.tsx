// app/dashboard/bestanden/page.tsx
// [BOEK-033] Server wrapper — auth check + ensureYearStructure + render BestandenPage

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { ensureYearStructure } from "@/lib/bestanden";
import { BestandenPage } from "./BestandenPage";

export const metadata = { title: "Mijn bestanden — BoekBrug" };

export default async function BestandenServerPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_done")
    .eq("id", user.id)
    .single();

  if (!profile?.onboarding_done) redirect("/onboarding");

  // [BOEK-033] Ensure year structure exists — idempotent, safe to call every load
  await ensureYearStructure(user.id, new Date().getFullYear());

  return <BestandenPage />;
}