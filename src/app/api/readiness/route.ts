// src/app/api/readiness/route.ts
// [READINESS] The owner's "ben ik klaar voor de boekhouder?" verdict for a quarter.
// A pure PROJECTION over the truth layer: it gathers the SAME signals the other surfaces
// already compute — invoice evidence (summarizeClosingPackage), bank reconciliation
// (bank-identity), till reconciliation (buildTurnoverClosing), and BTW completeness
// (computeResult + buildAangifte) — and hands them to buildReadiness for one score + the
// short missing/risks lists. No new financial logic; every figure traces to imported data.
// Owner-scoped (self). Read-only.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { summarizeClosingPackage, type Quarter } from "@/lib/closing-package";
import { computeResult, type ResultInvoice, type ResultBankTx, type ResultCashEntry } from "@/lib/financial-result";
import { turnoverNetOmzet, type DailyTurnover } from "@/lib/turnover";
import { buildTurnoverClosing } from "@/lib/turnover-closing";
import { buildAangifte, type AangifteCompleteness } from "@/lib/aangifte";
import { needsDocument } from "@/lib/bank-identity";
import { buildReadiness, type ReadinessSignals } from "@/lib/readiness";

export const dynamic = "force-dynamic";

function pad(n: number): string { return String(n).padStart(2, "0"); }
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// EU VAT prefixes (excl. NL) — the same honest rubriek-4b signal /api/aangifte uses.
const EU_VAT = /^(AT|BE|BG|CY|CZ|DE|DK|EE|ES|FI|FR|GR|EL|HR|HU|IE|IT|LT|LU|LV|MT|PL|PT|RO|SE|SI|SK)/i;

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year")) || now.getUTCFullYear();
  const quarter = ([1, 2, 3, 4].includes(Number(sp.get("quarter")))
    ? Number(sp.get("quarter"))
    : Math.floor(now.getUTCMonth() / 3) + 1) as Quarter;

  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;
  const quarterDays = Math.round((endD.getTime() - Date.UTC(year, startMonth, 1)) / 86400000) + 1;
  const quarterLabel = `Q${quarter} ${year}`;

  // service_role, every query scoped to this user (mirrors /api/closing-package/summary).
  const pipeline = createPipelineClient();

  // ── 1) Invoice evidence — REUSE summarizeClosingPackage (single source of truth) ──
  let summary;
  try {
    summary = await summarizeClosingPackage({ ownerId: user.id, year, quarter, supabase: pipeline });
  } catch (e) {
    const message = e instanceof Error ? e.message : "readiness summary failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const verifiedInvoiceCount = summary.outgoingCount + summary.incomingCount;
  const invoicesWithEvidence = summary.filesIncluded;

  // ── 2) Bank — transactions DATED in the quarter, and how many still need a bon ──
  const { data: bankRows } = await pipeline
    .from("bank_transactions")
    .select("amount, category, invoice_id, date, status, description, counterpart_name")
    .eq("user_id", user.id).gte("date", start).lte("date", end);
  const bank = bankRows ?? [];
  let undocumentedCount = 0;
  for (const t of bank) {
    if (t.status === "pending" && !t.invoice_id) {
      const stillOpen =
        t.category == null
          ? needsDocument(t.counterpart_name, t.description, t.amount ?? 0)
          : t.category === "kosten";
      if (stillOpen) undocumentedCount++;
    }
  }

  // ── 3) Invoices + cash for the VAT engine (same inputs as /api/aangifte) ──
  const { data: invRows } = await pipeline
    .from("invoices")
    .select("direction, status, total_ex_btw, btw_amount, client_btw_number, sender_id, receiver_id")
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .gte("invoice_date", start).lte("invoice_date", end);
  const invRaw = invRows ?? [];
  // [FIN-4] Infer a NULL direction from ownership — the SAME rule effectiveDirection uses
  // in the closing package — so a null-direction verified invoice is counted here too and
  // the readiness/aangifte screen never diverges from the ZIP.
  const effDir = (i: { direction: string | null; receiver_id: string | null }): "incoming" | "outgoing" =>
    i.direction === "incoming" || i.direction === "outgoing"
      ? i.direction
      : i.receiver_id === user.id ? "incoming" : "outgoing";
  const invoices: ResultInvoice[] = invRaw.map((i) => ({
    direction: effDir(i),
    status: i.status, total_ex_btw: i.total_ex_btw, btw_amount: i.btw_amount,
  }));

  const { data: cashRows } = await pipeline
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date")
    .eq("user_id", user.id).gte("entry_date", start).lte("entry_date", end);
  const cashEntries: ResultCashEntry[] = (cashRows ?? []).map((c) => ({
    direction: c.direction === "in" ? "in" : "out",
    amount: c.amount, category: c.category, btw_rate: c.btw_rate, date: c.entry_date,
  }));

  // ── 4) Turnover (+ buffered covered set for cross-quarter settlement lag) ──
  const startBuffer = shiftDays(start, -5);
  const { data: turnoverRows } = await pipeline
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", user.id).gte("turnover_date", startBuffer).lte("turnover_date", end);
  const allTurnover: DailyTurnover[] = (turnoverRows ?? []).map((t) => ({
    turnover_date: t.turnover_date,
    base_0: t.base_0 ?? 0, base_9: t.base_9 ?? 0, base_21: t.base_21 ?? 0,
    btw_9: t.btw_9 ?? 0, btw_21: t.btw_21 ?? 0,
    total_incl: t.total_incl, pin_amount: t.pin_amount, cash_amount: t.cash_amount, other_amount: t.other_amount,
  }));
  const turnover = allTurnover.filter((t) => t.turnover_date >= start);
  const coveredDates = new Set(
    allTurnover.filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0).map((t) => t.turnover_date),
  );

  // Till reconciliation exceptions (the retail triangle) — only when a till is used.
  let reconExceptions: ReadinessSignals["reconExceptions"] = [];
  if (turnover.length > 0) {
    const [posRes, cashOmzetRes] = await Promise.all([
      pipeline.from("bank_transactions").select("description, amount")
        .eq("user_id", user.id).eq("category", "pos_income")
        .gte("date", shiftDays(start, -5)).lte("date", shiftDays(end, 5)),
      pipeline.from("cash_entries").select("entry_date, amount")
        .eq("user_id", user.id).eq("category", "omzet")
        .gte("entry_date", start).lte("entry_date", end),
    ]);
    const posLines = (posRes.data ?? []).map((p) => ({ description: p.description, amount: p.amount }));
    const cashOmzet = (cashOmzetRes.data ?? []).map((c) => ({ date: c.entry_date, amount: c.amount }));
    const tc = buildTurnoverClosing(turnover, posLines, cashOmzet);
    reconExceptions = tc.exceptions.map((e) => ({ date: e.date, kind: e.kind, note: e.note, diff: e.diff }));
  }

  // ── 5) The VAT engine + concept aangifte (bank=[] — bank lines carry no BTW) ──
  const result = computeResult(invoices, [] as ResultBankTx[], cashEntries, turnover, coveredDates);
  const OUT_OK = new Set(["paid", "sent", "overdue"]);
  const IN_OK = new Set(["paid", "received"]);
  const completeness: AangifteCompleteness = {
    turnoverDays: turnover.length,
    quarterDays,
    incomingInvoiceCount: invRaw.filter((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "")).length,
    outgoingInvoiceCount: invRaw.filter((i) => effDir(i) === "outgoing" && OUT_OK.has(i.status ?? "")).length,
    hasEuPurchase: invRaw.some((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "") && typeof i.client_btw_number === "string" && EU_VAT.test(i.client_btw_number.trim())),
  };
  const aangifte = buildAangifte(result, completeness, quarterLabel);
  const hasUndecidableRate = aangifte.rows.some((r) => r.code === "1c");

  // ── 6) Assemble the signals → the verdict ──
  const signals: ReadinessSignals = {
    quarterLabel,
    verifiedInvoiceCount,
    invoicesWithEvidence,
    missingEvidence: [], // exact COUNT drives the score; specific numbers aren't surfaced here
    bankTxCount: bank.length,
    undocumentedCount,
    usesTurnover: turnover.length > 0,
    turnoverDays: turnover.length,
    reconExceptions,
    hasSales: result.salesByRate.length > 0 || result.cashOmzetZonderBtw > 0,
    cashOmzetZonderBtw: result.cashOmzetZonderBtw,
    quarterDays,
    hasUndecidableRate,
    hasEuPurchase: completeness.hasEuPurchase,
  };
  const report = buildReadiness(signals);

  return NextResponse.json({
    ok: true,
    year,
    quarter,
    report,
    // The concept BTW figures the owner can hand over (same as /api/aangifte).
    concept: {
      verschuldigd: aangifte.verschuldigd,
      voorbelasting: aangifte.voorbelasting,
      saldo: aangifte.saldo,
    },
  });
}
