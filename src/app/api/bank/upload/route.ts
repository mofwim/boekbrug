// src/app/api/bank/upload/route.ts
// [BOEK-016] Upload + parse + store a bank statement.
// Thin shell over importBankStatement (src/lib/bank-ingest.ts) — the SINGLE source of
// truth for parse → dedup → insert → raw-passthrough, shared with the intake bank path
// so the two entry points can never diverge. Auth is here; all the work is there.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { importBankStatement } from "@/lib/bank-ingest";

const MAX_BYTES = 5_000_000; // 5 MB — bank statements are small text/XML

export async function POST(req: NextRequest) {
  // Auth — session client (RLS). A user may only upload for themselves.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Read the uploaded file.
  let filename = "afschrift";
  let fileType = "text/plain";
  let fileBuffer: Buffer | null = null;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no_file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }
    filename = file.name || "afschrift";
    fileType = file.type || "text/plain";
    fileBuffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }
  if (!fileBuffer) {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const pipeline = createPipelineClient();
  const result = await importBankStatement({
    buffer: fileBuffer,
    filename,
    fileType,
    userId: user.id,
    pipeline,
  });

  // [VREEMD-BESTAND] Geweigerd met reden — niets geboekt, geen dekking geclaimd.
  if (result.refused) {
    return NextResponse.json({ error: result.refused, refused: true }, { status: 422 });
  }

  return NextResponse.json({
    // [BANK-INSERT-LUID] Niet ok wanneer de transactie-insert zelf faalde — het bestand staat er,
    // de regels niet, en "ok" zou dat verschil wegpoetsen. parseWarnings draagt de uitleg.
    ok: !result.insertFailed,
    insertFailed: result.insertFailed,
    format: result.format,
    accountIban: result.accountIban,
    parsed: result.parsed,
    inserted: result.inserted,
    skipped: result.skipped,
    statementStored: result.statementStored,
    parseWarnings: result.parseWarnings,
    autoBooked: result.autoBooked, // [BANK-AUTO-FEEDBACK] payments the import auto-booked
    // [BANK-BALANCE §2.6] Statement-completeness: null when it reconciles or can't be checked;
    // a Dutch "afschrift sluit niet aan — €X ontbreekt" message when a line is missing/dropped.
    balanceWarning: result.balanceWarning,
    balanceReconciliation: result.balanceReconciliation,
    // [STATEMENT-CONTINUITY] Sluit dit afschrift aan op het vorige? Een ontbrekende maand is
    // onzichtbaar in de bestanden die je WEL hebt — dit is het enige moment waarop de eigenaar
    // hem er zonder zoeken bij kan halen: hij heeft het bankportaal nu open.
    continuityWarning: result.continuityWarning,
  });
}
