// src/app/dashboard/kassa/page.tsx
// [KASSA] Server wrapper — auth guard, then the self-contained counter.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import KassaClient from "./KassaClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kassa — BoekBrug" };

export default async function KassaPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <KassaClient />;
}
