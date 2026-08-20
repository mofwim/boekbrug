// src/app/dashboard/dagomzet/page.tsx
// [TURNOVER-IMPORT] Server wrapper — auth guard, then the self-contained import client.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import DagomzetImportClient from "./DagomzetImportClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dagomzet — BoekBrug" };

export default async function DagomzetPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // [KOR-FACTUUR] Read here, the same way /dashboard/invoice/new reads it: under the KOR the owner
  // charges no btw, so the hand-typed day must offer the 0% box and nothing else. Read fail-open —
  // false is what every owner outside the scheme gets, and the write refuses regardless.
  // Read apart and tolerantly so this screen still works where the kor column has not landed.
  let korActive = false;
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase
      .from("profiles").select("kor_active").eq("id", user.id).maybeSingle();
    korActive = Boolean(data?.kor_active);
  } catch {
    /* no kor column yet → the ordinary three-rate day, exactly as before */
  }
  // [COHERENCE-DAGOMZET] TurnoverInsights is rendered ONCE, inside DagomzetImportClient
  // (at the top, above the import panel), so it lives in the same 640px centered
  // container and remounts after a commit via refreshTick. It used to also render here
  // at page level — a second, full-bleed, non-refreshing copy that read as a rendering
  // bug and could drift out of sync after an import. Removed.
  return <DagomzetImportClient korActive={korActive} />;
}
