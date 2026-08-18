// src/app/dashboard/aangifte/page.tsx
// [AANGIFTE] Server wrapper — auth guard, then the concept BTW-aangifte client.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import AangifteClient from "./AangifteClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Concept BTW-aangifte — BoekBrug" };

export default async function AangiftePage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <AangifteClient />;
}
