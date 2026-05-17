// src/app/api/bestanden/classify/route.ts
// [BOEK-033] AI Classification — classify uploaded document and suggest folder
// Uses classifyDocument from @/lib/ai + findFolderByPath from @/lib/bestanden

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { classifyDocument } from "@/lib/ai";
import { findFolderByPath } from "@/lib/bestanden";

const NL_MONTHS: Record<number, string> = {
  1: "januari", 2: "februari", 3: "maart",
  4: "april",   5: "mei",      6: "juni",
  7: "juli",    8: "augustus", 9: "september",
  10: "oktober", 11: "november", 12: "december",
};

function monthToQuarter(month: number): number {
  return Math.ceil(month / 3);
}

function buildPathLabel(year: number, quarter: number, month?: number, type?: string): string {
  const parts = [String(year), `Q${quarter}`];
  if (type === "bank") { parts.push("Bank"); return parts.join(" / "); }
  if (month) parts.push(NL_MONTHS[month]);
  if (type === "facturen") parts.push("Facturen");
  if (type === "kosten")   parts.push("Kosten");
  return parts.join(" / ");
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json() as { documentId: string; fileName: string };
  if (!body.documentId) return NextResponse.json({ error: "documentId vereist" }, { status: 400 });

  try {
    // Get the document's file_url to read content for AI
    const { data: doc } = await supabase
      .from("documents")
      .select("file_url, file_type, file_name")
      .eq("id", body.documentId)
      .eq("user_id", user.id)
      .single();

    if (!doc) return NextResponse.json({ type: "unknown", folderId: null, folderPath: "" });

    // Call AI classification
    const classification = await classifyDocument(
      doc.file_name,
      doc.file_type
    );

    // Map AI result to folder path
    const now = new Date();
    const year = classification.date
      ? new Date(classification.date).getFullYear()
      : now.getFullYear();
    const month = classification.date
      ? new Date(classification.date).getMonth() + 1
      : now.getMonth() + 1;
    const quarter = monthToQuarter(month);

    let folderType: "facturen" | "kosten" | "bank" | undefined;
    if (classification.type === "invoice")  folderType = "facturen";
    if (classification.type === "receipt")  folderType = "kosten";
    if (classification.type === "bank")     folderType = "bank";

    if (!folderType || classification.type === "unknown") {
      // Update document ai fields
      await supabase.from("documents")
        .update({ ai_processed: true, ai_doc_type: classification.type })
        .eq("id", body.documentId).eq("user_id", user.id);
      return NextResponse.json({ type: "unknown", folderId: null, folderPath: "" });
    }

    // Find folder id in DB
    const folderId = await findFolderByPath(user.id, {
      year,
      quarter,
      month: folderType !== "bank" ? month : undefined,
      type: folderType,
    });

    const folderPath = buildPathLabel(year, quarter, folderType !== "bank" ? month : undefined, folderType);

    // Update document ai fields
    await supabase.from("documents")
      .update({
        ai_processed: true,
        ai_doc_type: classification.type,
        ai_suggested_folder: folderId,
      })
      .eq("id", body.documentId).eq("user_id", user.id);

    return NextResponse.json({
      type: classification.type,
      folderId,
      folderPath,
    });
  } catch (err) {
    console.error("[BOEK-033] classify error:", err);
    // Return unknown on any error — never crash the upload flow
    return NextResponse.json({ type: "unknown", folderId: null, folderPath: "" });
  }
}