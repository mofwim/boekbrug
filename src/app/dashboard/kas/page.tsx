// src/app/dashboard/kas/page.tsx
// [CASH-LEDGER] Server wrapper — auth guard, then the self-contained Kas client.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import KasClient from "./KasClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kas — BoekBrug" };

export default async function KasPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <KasClient />;
}
