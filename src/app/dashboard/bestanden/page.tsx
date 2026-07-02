// app/dashboard/bestanden/page.tsx
// [BOEK-033] Server wrapper — auth check + ensureYearStructure + render BestandenPage
// [BOEK-033] Reads profile.role server-side and passes it to the client component
//            so the sidebar logo can link to the correct home (no client fetch).

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { ensureYearStructure } from "@/lib/bestanden";
import { BestandenPage } from "./BestandenPage";

export const metadata = { title: "Mijn bestanden — BoekBrug" };

export default async function BestandenServerPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // [BOEK-033] Read onboarding_done + role in a single query
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_done, role")
    .eq("id", user.id)
    .single();

  if (!profile?.onboarding_done) redirect("/onboarding");

  // [BOEK-033] Ensure year structure exists — idempotent, fast-path on built years
  await ensureYearStructure(user.id, new Date().getFullYear());

  // [BOEK-033] Pass role for the sidebar logo to point to the correct home
// [BOEK-002] narrow role to BestandenPage's union (Supabase returns generic string after type regen)
// [BESTANDEN-FOCUS] BestandenPage uses useSearchParams (to react to ?folder=/?focus=
  // deep-links after client-side navigation), which requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <BestandenPage role={profile.role as 'zzper' | 'accountant' | 'client' | null} />
    </Suspense>
  );
}