// src/app/dashboard/bedrijfsmiddelen/page.tsx
// [BEDRIJFSMIDDEL] Server wrapper — auth guard, then the register screen.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import BedrijfsmiddelenClient from "./BedrijfsmiddelenClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bedrijfsmiddelen — BoekBrug" };

export default async function BedrijfsmiddelenPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <BedrijfsmiddelenClient />;
}
