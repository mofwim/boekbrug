// app/dashboard/bestanden/page.tsx
// [BOEK-033] Server wrapper — auth check + ensureYearStructure + render BestandenPage
// [BOEK-033] Reads profile.role server-side and passes it to the client component
//            so the sidebar logo can link to the correct home (no client fetch).

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getSessionUser } from "@/lib/session-user";
import { ensureYearStructure } from "@/lib/bestanden";
// [TZ-SERVER] Het jaar van de eigenaar — anders krijgt wie in het eerste uur van 1 januari
// uploadt de map van vorig jaar aangemaakt.
import { amsterdamYear } from "@/lib/format-nl";
import { BestandenPage } from "./BestandenPage";

export const metadata = { title: "Mijn bestanden — BoekBrug" };

export default async function BestandenServerPage() {
  const supabase = await createServerSupabaseClient();
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();

  if (!user) redirect("/login");

  // [WATERVAL] De jaarstructuur hangt niet aan het profiel — hij kent alleen user.id — en stond er
  // toch onder te wachten. Nu gaan ze samen de deur uit; de omleiding eronder gebeurt nog steeds
  // voordat er iets op het scherm komt.
  const [{ data: profile }] = await Promise.all([
    // [BOEK-033] Read onboarding_done + role in a single query
    supabase.from("profiles").select("onboarding_done, role").eq("id", user.id).single(),
    // [BOEK-033] Ensure year structure exists — idempotent, fast-path on built years
    ensureYearStructure(user.id, amsterdamYear()),
  ]);

  if (!profile?.onboarding_done) redirect("/onboarding");

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