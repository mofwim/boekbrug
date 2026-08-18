// src/app/dashboard/klaar/page.tsx
// [READINESS] Server wrapper — auth guard, then the owner's readiness screen.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import KlaarClient from "./KlaarClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ben ik klaar? — BoekBrug" };

export default async function KlaarPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <KlaarClient />;
}
