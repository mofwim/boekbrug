// src/app/dashboard/upload/page.tsx
// [UPLOAD-HUB] One place to upload EVERYTHING — invoices, receipts, bank statements, any file.
// The scattered per-screen uploads (bank / incoming / kas / camera) all POST to the SAME smart
// router (/api/intake), which classifies each file and sends it to the right destination. This
// page just gives the owner a single door with MULTI-FILE selection + a live per-file result list.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import UploadClient from "./UploadClient";

export const metadata = { title: "Uploaden — BoekBrug" };

export default async function UploadPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <UploadClient />;
}
