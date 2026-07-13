// src/app/api/turnover/import/route.ts
// [TURNOVER-IMPORT] Two-step, human-in-the-loop import of a till Z-report into
// daily_turnover. User-scoped (RLS server client).
//
//   1. PREVIEW  — POST multipart/form-data with `file` (an .xls/.xlsx/.csv Z-report).
//                 The SheetJS adapter → cell matrix → the PURE normalizer → returns the
//                 normalized rows + warnings. NOTHING is written; the owner reviews first.
//   2. COMMIT   — POST application/json { rows: DailyTurnover[] } (the reviewed rows).
//                 Upserts into daily_turnover (one row per day; a re-import updates).
//
// The parser (xlsx-adapter) is isolated; this route only orchestrates. It never guesses:
// preview warnings are shown to the owner, and only the owner's confirmed rows are stored.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { sheetBytesToMatrix } from "@/lib/xlsx-adapter";
import { normalizeTurnoverSheet } from "@/lib/turnover-import";
import type { DailyTurnover } from "@/lib/turnover";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB — a Z-report is tiny; this is generous.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";

  // ── 2) COMMIT — the owner-reviewed rows ──
  if (contentType.includes("application/json")) {
    let body: { rows?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
    const rows = Array.isArray(body.rows) ? (body.rows as DailyTurnover[]) : null;
    if (!rows || rows.length === 0) return NextResponse.json({ error: "geen rijen om op te slaan" }, { status: 400 });

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const nullableNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const records = [];
    for (const r of rows) {
      if (!r || typeof r.turnover_date !== "string" || !ISO_DATE.test(r.turnover_date)) {
        return NextResponse.json({ error: `ongeldige datum in een rij: ${String(r?.turnover_date)}` }, { status: 400 });
      }
      records.push({
        user_id: user.id,
        turnover_date: r.turnover_date,
        base_0: num(r.base_0), base_9: num(r.base_9), base_21: num(r.base_21),
        btw_9: num(r.btw_9), btw_21: num(r.btw_21),
        total_incl: nullableNum(r.total_incl),
        pin_amount: nullableNum(r.pin_amount),
        cash_amount: nullableNum(r.cash_amount),
        other_amount: nullableNum(r.other_amount),
        source: "z_report",
      });
    }

    // One row per day: a re-import of the same date UPDATES (the unique constraint
    // daily_turnover_unique_day (user_id, turnover_date) drives the upsert).
    const { error } = await supabase
      .from("daily_turnover")
      .upsert(records, { onConflict: "user_id,turnover_date" });
    if (error) return NextResponse.json({ error: "kon dagomzet niet opslaan" }, { status: 500 });

    return NextResponse.json({ ok: true, committed: records.length });
  }

  // ── 1) PREVIEW — parse + normalize, write nothing ──
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "verwacht een bestand" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "geen bestand ontvangen" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "bestand is leeg of te groot (max 10MB)" }, { status: 400 });
  }

  let matrix;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer()); // binary-safe (never file.text())
    matrix = sheetBytesToMatrix(bytes);
  } catch {
    return NextResponse.json({ error: "kon het bestand niet lezen als spreadsheet" }, { status: 422 });
  }

  const { rows, warnings } = normalizeTurnoverSheet(matrix);
  return NextResponse.json({ ok: true, preview: true, count: rows.length, rows, warnings });
}
