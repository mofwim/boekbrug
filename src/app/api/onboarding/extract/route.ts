// src/app/api/onboarding/extract/route.ts
// [BOEK-015] Extract company registration details from uploaded invoice
//
// Flow:
//   1. Receive documentId + mimeType from OnboardingWizard
//   2. Fetch file from Supabase Storage using document's file_url
//   3. Convert to base64
//   4. Call extractCompanyDetails from @/lib/ai
//   5. Return: { found, company_name, kvk_number, btw_number, iban, address }
//
// Safe: never throws — returns { found: false } on any error

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { extractCompanyDetails } from "@/lib/ai";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [COST] Per-user ceiling on the AI company-details extraction (Claude vision).
  const rl = await checkRateLimit({ userId: user.id, endpoint: "/api/onboarding/extract", ...RATE_LIMITS.AI_OCR });
  if (!rl.allowed) return rateLimitResponse(rl);

  const body = await req.json();
  const { documentId, mimeType, fileName } = body;

  if (!documentId) {
    return NextResponse.json({ found: false, error: "documentId verplicht" }, { status: 400 });
  }

  try {
    // Step 1: verify document belongs to user
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("file_url, file_type, file_name")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (docError || !doc) {
      console.error("[BOEK-015] document not found:", docError?.message);
      return NextResponse.json({ found: false });
    }

    // Step 2: download from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(doc.file_url);

    if (downloadError || !fileData) {
      console.error("[BOEK-015] file download failed:", downloadError?.message);
      return NextResponse.json({ found: false });
    }

    // Step 3: Blob → base64
    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    // Step 4: call extractCompanyDetails from @/lib/ai
    const resolvedMimeType = mimeType ?? doc.file_type ?? "application/pdf";
    const resolvedFileName = fileName ?? doc.file_name ?? "document";

    const result = await extractCompanyDetails(base64, resolvedMimeType, resolvedFileName);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[BOEK-015] extract route error:", error);
    return NextResponse.json({ found: false });
  }
}