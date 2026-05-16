// app/dashboard/bestanden/page.tsx
// [BOEK-033] Server wrapper — auth check + render BestandenPage

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
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

  return <BestandenPage />;
}