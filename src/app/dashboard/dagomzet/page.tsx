// src/app/dashboard/dagomzet/page.tsx
// [TURNOVER-IMPORT] Server wrapper — auth guard, then the self-contained import client.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import DagomzetImportClient from "./DagomzetImportClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dagomzet — BoekBrug" };

export default async function DagomzetPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // [COHERENCE-DAGOMZET] TurnoverInsights is rendered ONCE, inside DagomzetImportClient
  // (at the top, above the import panel), so it lives in the same 640px centered
  // container and remounts after a commit via refreshTick. It used to also render here
  // at page level — a second, full-bleed, non-refreshing copy that read as a rendering
  // bug and could drift out of sync after an import. Removed.
  return <DagomzetImportClient />;
}
