// src/app/dashboard/voertuigen/page.tsx
// [VOERTUIG] Server wrapper — auth guard, then the self-contained vehicles screen.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import VoertuigenClient from "./VoertuigenClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Voertuigen — BoekBrug" };

export default async function VoertuigenPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <VoertuigenClient />;
}
