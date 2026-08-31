// src/app/api/account/export/route.ts
// [BOEK-032] Account data export (GDPR) — builds a ZIP of the user's own data
// and emails a best-effort summary. Idempotent & safe to repeat.
//
// Flow: verify session → build ZIP (service_role, every query scoped to
//       user.id) → mark deletion_requests.export_confirmed = true (opens the
//       delete gate) → best-effort summary email (email_confirmed only on a
//       real send) → return the ZIP as a download.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { buildAccountExportZip } from "@/lib/account-export";
import { sendAccountExportSummary } from "@/lib/email";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

type Built = Awaited<ReturnType<typeof buildAccountExportZip>>;

export async function POST(_req: NextRequest) {
  const supabaseSession = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabaseSession.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [DIEP-3] Bounded like its siblings — the day-end audit found this one uncapped.
  const limited = await checkRateLimit({ userId: user.id, endpoint: "account-export", ...RATE_LIMITS.HEAVY_EXPORT });
  if (!limited.allowed) return rateLimitResponse(limited);

  // Build the ZIP via service_role; buildAccountExportZip scopes every query
  // to this user.id (service_role bypasses RLS — handoff lesson 3).
  const pipeline = createPipelineClient();
  let built: Built;
  try {
    built = await buildAccountExportZip({ userId: user.id, supabase: pipeline });
  } catch (e) {
    console.error("[BOEK-032] export build failed:", e);
    return NextResponse.json({ error: "Export mislukt" }, { status: 500 });
  }
  const { zipBytes, summary } = built;

  // Open the delete gate: export_confirmed = true.
  // No UNIQUE(user_id) on deletion_requests → manual select-then-insert/update.
  const { data: existing } = await pipeline
    .from("deletion_requests")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  let rowId = existing?.id ?? null;
  if (rowId) {
    await pipeline
      .from("deletion_requests")
      .update({ export_confirmed: true })
      .eq("id", rowId);
  } else {
    const { data: inserted } = await pipeline
      .from("deletion_requests")
      .insert({ user_id: user.id, export_confirmed: true })
      .select("id")
      .single();
    rowId = inserted?.id ?? null;
  }

  // Best-effort summary email. email_confirmed = true ONLY on a real send —
  // we never record a notification that didn't actually go out (honest state).
  if (user.email) {
    try {
      await sendAccountExportSummary({
        toEmail: user.email,
        invoiceCount: summary.invoiceCount,
        fileCount: summary.fileCount,
        skippedCount: summary.skipped.length,
        generatedAt: summary.generatedAt,
        // [EXPORT-REGISTERS] The receipt names what the archive holds, not a subset of it.
        registerCounts: summary.registerCounts,
      });
      if (rowId) {
        await pipeline
          .from("deletion_requests")
          .update({ email_confirmed: true })
          .eq("id", rowId);
      }
    } catch (e) {
      console.error("[BOEK-032] export summary email failed (non-fatal):", e);
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  // Buffer → Uint8Array: a Buffer doesn't cleanly satisfy BodyInit under newer
  // @types/node; a plain Uint8Array is a BufferSource and is unambiguous.
  return new NextResponse(new Uint8Array(zipBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="boekbrug-export-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}