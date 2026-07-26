// src/app/dashboard/upload/page.tsx
// [UPLOAD-HUB] One place to upload EVERYTHING — invoices, receipts, bank statements, any file.
// The scattered per-screen uploads (bank / incoming / kas / camera) all POST to the SAME smart
// router (/api/intake), which classifies each file and sends it to the right destination. This
// page just gives the owner a single door with MULTI-FILE selection + a live per-file result list.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import UploadClient from "./UploadClient";

export const metadata = { title: "Uploaden — BoekBrug" };

export default async function UploadPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <UploadClient />;
}
