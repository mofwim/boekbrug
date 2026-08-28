// src/app/dashboard/aangifte/page.tsx
// [AANGIFTE] Server wrapper — auth guard, then the concept BTW-aangifte client.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import AangifteClient from "./AangifteClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Concept BTW-aangifte — BoekBrug" };

export default async function AangiftePage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // [ZELF-INDIENEN] Heeft deze ondernemer een boekhouder?
  //
  // De conceptbanner op dit scherm zei tegen iedereen "Je boekhouder controleert en dient in" —
  // onvoorwaardelijk, ook tegen de helft van de gebruikers die er geen heeft. Voor hen was dat
  // niet alleen onwaar maar geruststellend onwaar: het beschrijft iemand die het overneemt.
  //
  // Hier gelezen en niet in de client, om twee redenen: deze pagina is toch al force-dynamic (er
  // komt dus geen cache-beslissing bij kijken), en het antwoord is er dan vóór de eerste verf —
  // een banner die eerst het ene zegt en een tel later het andere is over een belastingaangifte
  // de verkeerde manier om van gedachten te veranderen.
  //
  // ⚠ Drie standen, niet twee. Een MISLUKTE lezing is niet "geen boekhouder": dan zou een
  // haperende verbinding een ondernemer mét boekhouder de instructie geven om zelf in te dienen,
  // naast de aangifte die zijn boekhouder al indient. Bij null zwijgt de banner over wie indient.
  let hasAccountant: boolean | null = null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("accountant_clients")
      .select("accountant_id")
      .eq("zzper_id", user.id)
      .maybeSingle();
    if (!error) hasAccountant = !!data?.accountant_id;
  } catch {
    /* null → de banner zegt alleen wat hij zeker weet */
  }

  return <AangifteClient hasAccountant={hasAccountant} />;
}
