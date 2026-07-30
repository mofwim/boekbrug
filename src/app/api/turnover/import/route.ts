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
import { detectSheetKind } from "@/lib/detect-file";
import type { DailyTurnover } from "@/lib/turnover";
import { logAuditAction, getClientIP } from "@/lib/audit";

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

    // [DAGOMZET-DUP-DAY] Refuse a payload that names the same day twice, and NAME the day.
    // Postgres cannot apply ON CONFLICT DO UPDATE to one row twice in a single statement
    // ("command cannot affect row a second time"), so such a file failed the whole import with
    // the flat "kon dagomzet niet opslaan" below — nothing pointing at the duplicate date, and
    // nothing the owner could act on. Nothing was written, which is right; the silence was not.
    //
    // Deliberately not resolved automatically: summing two rows for one day would double the
    // omzet if the file simply repeats a day, and keeping the last would silently drop a second
    // shift. Both guesses land in the BTW. The owner knows which their file is; the app does not.
    const seenDays = new Map<string, number>();
    for (const r of records) seenDays.set(r.turnover_date, (seenDays.get(r.turnover_date) ?? 0) + 1);
    const dupDays = [...seenDays.entries()].filter(([, n]) => n > 1).map(([d]) => d).sort();
    if (dupDays.length > 0) {
      const shown = dupDays.slice(0, 5).join(", ");
      const more = dupDays.length > 5 ? ` (en ${dupDays.length - 5} andere)` : "";
      return NextResponse.json(
        {
          error: "dubbele_dag",
          detail:
            `Dit bestand bevat meerdere regels voor dezelfde dag: ${shown}${more}. ` +
            `Er is niets opgeslagen. Staat er per dag één totaal in je Z-rapport? Verwijder dan de ` +
            `dubbele regel. Zijn het losse shifts van dezelfde dag? Tel ze eerst bij elkaar op — ` +
            `anders zou de omzet van die dag dubbel in je BTW terechtkomen.`,
        },
        { status: 400 },
      );
    }

    // One row per day: a re-import of the same date UPDATES (the unique constraint
    // daily_turnover_unique_day (user_id, turnover_date) drives the upsert).
    const { error } = await supabase
      .from("daily_turnover")
      .upsert(records, { onConflict: "user_id,turnover_date" });
    if (error) return NextResponse.json({ error: "kon dagomzet niet opslaan" }, { status: 500 });

    // [DAGOMZET-AUDIT] This is a money mutation into the BTW-authoritative daily_turnover — audit it
    // (the intake/reprocess paths already do). Constraint (4): every money write is auditable.
    await logAuditAction({
      userId: user.id, action: "turnover.auto_imported", entityType: "turnover", entityId: user.id,
      newValue: {
        via: "dagomzet_manual_commit",
        days: records.map((r) => r.turnover_date),
        count: records.length,
        total_incl: records.reduce((s, r) => s + (r.total_incl ?? 0), 0),
      },
      ipAddress: getClientIP(req),
    });

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

  // [DETECT] A grootboek/kas export (OVERZICHT/KASBOEK) is NOT a Z-report — its per-rate
  // omzet columns are absent, so the normalizer would return a confusing "no_header". Catch
  // it and point the owner to the right place instead of a dead end.
  if (detectSheetKind(matrix) === "ledger") {
    return NextResponse.json({
      ok: false,
      wrongKind: "ledger",
      error: "Dit lijkt een grootboek/kas-overzicht (OVERZICHT/KASBOEK), geen kassa-Z-rapport. De dagomzet-import verwacht een Z-rapport met 'Omzet incl.' en BTW-tarief kolommen.",
    }, { status: 422 });
  }

  const { rows, warnings } = normalizeTurnoverSheet(matrix);
  return NextResponse.json({ ok: true, preview: true, count: rows.length, rows, warnings });
}

// [DAGOMZET-DELETE] Clear a booked turnover day. A wrong-date/wrong-month row fed the BTW return and
// there was no way to reverse it (re-import only overwrites the SAME date). This removes exactly one
// day (?date=YYYY-MM-DD) for the owner and audits the reversal. Reversible + audited (constraint 4).
export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date");
  if (!date || !ISO_DATE.test(date)) return NextResponse.json({ error: "ongeldige of ontbrekende datum" }, { status: 400 });

  // Capture the row first so the audit records exactly what was removed (and a no-op is a clean 404).
  const { data: existing } = await supabase
    .from("daily_turnover").select("turnover_date, total_incl, source")
    .eq("user_id", user.id).eq("turnover_date", date).maybeSingle();
  if (!existing) return NextResponse.json({ error: "geen dagomzet op deze datum" }, { status: 404 });

  const { error } = await supabase
    .from("daily_turnover").delete().eq("user_id", user.id).eq("turnover_date", date);
  if (error) return NextResponse.json({ error: "kon dagomzet niet verwijderen" }, { status: 500 });

  await logAuditAction({
    userId: user.id, action: "turnover.auto_imported", entityType: "turnover", entityId: user.id,
    oldValue: { turnover_date: existing.turnover_date, total_incl: existing.total_incl, source: existing.source },
    newValue: { via: "dagomzet_delete", removed_day: date },
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, removed: date });
}
