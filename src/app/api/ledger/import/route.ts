// src/app/api/ledger/import/route.ts
// [LEDGER-IMPORT] Two-step, human-in-the-loop import of a bookkeeper grootboek export
// (Kiwi "OVERZICHT"/"KASBOEK" per account: 550100 = PIN, 570000 = kas) into ledger_daily.
// User-scoped (RLS server client).
//
//   1. PREVIEW  — POST multipart/form-data with `file` (the account .xls/.xlsx export).
//                 The SheetJS adapter → cell matrix → the PURE parser (parseLedgerSheet) →
//                 per-day gross totals + warnings. NOTHING is written; the owner reviews first.
//   2. COMMIT   — POST application/json { kind, accountNr?, rows: [{ledger_date, received, spent}] }
//                 Upserts one row per (user, day, kind); a re-import updates.
//
// IMPORTANT — this is a CROSS-CHECK WITNESS, not money. ledger_daily never reaches the P&L:
// the reconciliation triangle only compares its gross PIN against the till's PIN (Leg A) and
// raises a break on a mismatch. Revenue/cost still come solely from daily_turnover / invoices /
// cash_entries. So this route deliberately does NOT touch any money total.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { sheetBytesToMatrix } from "@/lib/xlsx-adapter";
import { parseLedgerSheet, ledgerDailyTotals, type LedgerKind } from "@/lib/ledger-import";

const MAX_BYTES = 10 * 1024 * 1024; // a grootboek export is tiny; generous.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: LedgerKind[] = ["pin", "cash", "bank", "other"];

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";

  // ── 2) COMMIT — the owner-reviewed per-day totals ──
  if (contentType.includes("application/json")) {
    let body: { kind?: unknown; accountNr?: unknown; rows?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
    const kind = KINDS.includes(body.kind as LedgerKind) ? (body.kind as LedgerKind) : null;
    if (!kind) return NextResponse.json({ error: "ongeldige grootboek-soort (pin/cash/bank/other)" }, { status: 400 });
    const accountNr = typeof body.accountNr === "string" && body.accountNr.trim() ? body.accountNr.trim().slice(0, 32) : null;
    const rows = Array.isArray(body.rows) ? (body.rows as { ledger_date?: unknown; received?: unknown; spent?: unknown }[]) : null;
    if (!rows || rows.length === 0) return NextResponse.json({ error: "geen rijen om op te slaan" }, { status: 400 });

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const records = [];
    for (const r of rows) {
      if (!r || typeof r.ledger_date !== "string" || !ISO_DATE.test(r.ledger_date)) {
        return NextResponse.json({ error: `ongeldige datum in een rij: ${String(r?.ledger_date)}` }, { status: 400 });
      }
      records.push({
        user_id: user.id,
        ledger_date: r.ledger_date,
        kind,
        received: num(r.received),
        spent: num(r.spent),
        account_nr: accountNr,
        source: "ledger_xlsx",
        updated_at: new Date().toISOString(),
      });
    }

    // One row per (user, day, kind): a re-import of the same account+day UPDATES.
    const { error } = await supabase
      .from("ledger_daily")
      .upsert(records, { onConflict: "user_id,ledger_date,kind" });
    if (error) return NextResponse.json({ error: "kon het grootboek niet opslaan" }, { status: 500 });

    return NextResponse.json({ ok: true, committed: records.length, kind });
  }

  // ── 1) PREVIEW — parse + total per day, write nothing ──
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

  const { ledger, warnings } = parseLedgerSheet(matrix);
  if (!ledger) {
    return NextResponse.json({
      ok: false,
      error: "Geen herkenbare grootboek-export (Datum / Ontvangen / Uitgaven) gevonden.",
      warnings,
    }, { status: 422 });
  }

  // Per-day gross totals — the witness the triangle consumes.
  const daily = ledgerDailyTotals(ledger);
  const rows = [...daily.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ledger_date, t]) => ({ ledger_date, received: t.received, spent: t.spent }));

  return NextResponse.json({
    ok: true,
    preview: true,
    kind: ledger.kind,
    accountNr: ledger.accountNr,
    title: ledger.title,
    openingBalance: ledger.openingBalance,
    count: rows.length,
    rows,
    warnings,
  });
}
