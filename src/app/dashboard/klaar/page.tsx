// src/app/dashboard/klaar/page.tsx
// [READINESS] Server wrapper — auth guard, then the owner's readiness screen.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import KlaarClient from "./KlaarClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ben ik klaar? — BoekBrug" };

export default async function KlaarPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <KlaarClient />;
}
