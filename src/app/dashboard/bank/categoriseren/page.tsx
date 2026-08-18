// src/app/dashboard/bank/categoriseren/page.tsx
// [BANK-IDENTITY] Server wrapper — auth guard, then the self-contained client.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import CategoriseClient from "./CategoriseClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Categoriseren — BoekBrug" };

export default async function CategoriseerPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <CategoriseClient />;
}
