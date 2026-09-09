// src/app/dashboard/werk/page.tsx
// [WERK] The trade's own work: server wrapper — auth, the trade's skin, then the screen.
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { workSkin } from "@/lib/werk";
import WerkClient from "./WerkClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Werk — BoekBrug" };

export default async function WerkPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const supabase = await createServerSupabaseClient();
  let vak: string | null = null;
  try {
    const { data } = await supabase.from("profiles").select("vak").eq("id", user.id).maybeSingle();
    vak = (data as { vak?: string | null } | null)?.vak ?? null;
  } catch { /* no column yet → no skin → the screen says so */ }
  const skin = workSkin(vak);
  // A trade without a work layer has no business here; the home is where its app starts.
  if (!skin) redirect("/dashboard");
  return <WerkClient vak={vak!} />;
}
