// src/app/api/aangifte/route.ts
// [AANGIFTE] Read-only CONCEPT BTW-aangifte for a quarter. Fetches the same sources as
// /api/result, runs the one reconciliation engine (computeResult), and maps it to the
// Belastingdienst rubrieken (buildAangifte). Every figure is derived from the owner's
// own imported data; the response carries honest completeness notes. User-scoped (RLS).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { computeResult, type ResultInvoice, type ResultBankTx, type ResultCashEntry } from "@/lib/financial-result";
import { parsePosSettlement, turnoverNetOmzet, type DailyTurnover } from "@/lib/turnover";
import { buildAangifte, type AangifteCompleteness } from "@/lib/aangifte";
import { resolveQuarterOwner } from "@/lib/accountant-access";

function pad(n: number): string { return String(n).padStart(2, "0"); }
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// EU VAT prefixes (excl. NL) — a cheap, honest signal that a purchase may be intra-EU
// (rubriek 4b), which this concept does NOT auto-compute.
const EU_VAT = /^(AT|BE|BG|CY|CZ|DE|DK|EE|ES|FI|FR|GR|EL|HR|HU|IE|IT|LT|LU|LV|MT|PL|PT|RO|SE|SI|SK)/i;

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const sp = req.nextUrl.searchParams;
  // Bounded year: a missing or absurd value falls back to the current year, so an
  // out-of-range input can never produce a nonsense quarter ("NaN dagen") in the notes.
  const yr = Number(sp.get("year"));
  const year = Number.isInteger(yr) && yr >= 2000 && yr <= 2100 ? yr : now.getUTCFullYear();
  const quarter = ([1, 2, 3, 4].includes(Number(sp.get("quarter")))
    ? Number(sp.get("quarter"))
    : Math.floor(now.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;

  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;
  const quarterDays = Math.round((endD.getTime() - Date.UTC(year, startMonth, 1)) / 86400000) + 1;

  // [ACCOUNTANT-TRUTH] Dual-path: own concept, OR a linked client's concept for an
  // accountant (same authorization as /api/closing-package). The data queries below use
  // the service-role pipeline scoped to ownerId — an accountant cannot read a client's
  // rows through RLS, so this route's reads move from the session client to the pipeline.
  const owner = await resolveQuarterOwner(supabase, user.id, sp.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const ownerId = owner.ownerId;
  const pipeline = createPipelineClient();

  // Invoices (both directions) in the quarter.
  const { data: invRows } = await pipeline
    .from("invoices")
    .select("direction, status, total_ex_btw, btw_amount, client_btw_number, sender_id, receiver_id")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end);
  const invRaw = invRows ?? [];
  // [FIN-4] Never drop a verified row with a NULL direction: infer it from ownership
  // (owner is the receiver of an incoming invoice) — the SAME rule effectiveDirection
  // applies in the closing package. Without this, a null-direction sale is silently
  // omitted here while the ZIP counts it → the two concept figures diverge.
  const effDir = (i: { direction: string | null; receiver_id: string | null }): "incoming" | "outgoing" =>
    i.direction === "incoming" || i.direction === "outgoing"
      ? i.direction
      : i.receiver_id === ownerId ? "incoming" : "outgoing";
  const invoices: ResultInvoice[] = invRaw.map((i) => ({
    direction: effDir(i),
    status: i.status, total_ex_btw: i.total_ex_btw, btw_amount: i.btw_amount,
  }));

  // Bank + cash (same de-dup inputs as /api/result).
  const { data: bankRows } = await pipeline
    .from("bank_transactions")
    .select("amount, category, invoice_id, date, description")
    .eq("user_id", ownerId).gte("date", start).lte("date", end);
  const bankTx: ResultBankTx[] = (bankRows ?? []).map((b) => ({
    amount: b.amount, category: b.category, invoice_id: b.invoice_id,
    settleDate: b.category === "pos_income" ? (parsePosSettlement(b.description).date ?? b.date) : null,
  }));

  const { data: cashRows } = await pipeline
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date")
    .eq("user_id", ownerId).gte("entry_date", start).lte("entry_date", end);
  const cashEntries: ResultCashEntry[] = (cashRows ?? []).map((c) => ({
    direction: c.direction === "in" ? "in" : "out",
    amount: c.amount, category: c.category, btw_rate: c.btw_rate, date: c.entry_date,
  }));

  // Turnover (widened covered set for the cross-quarter settlement lag).
  const bufD = new Date(Date.UTC(year, startMonth, 1));
  bufD.setUTCDate(bufD.getUTCDate() - 5);
  const startBuffer = `${bufD.getUTCFullYear()}-${pad(bufD.getUTCMonth() + 1)}-${pad(bufD.getUTCDate())}`;
  const { data: turnoverRows } = await pipeline
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", ownerId).gte("turnover_date", startBuffer).lte("turnover_date", end);
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

  const result = computeResult(invoices, bankTx, cashEntries, turnover, coveredDates);

  // Honest completeness — counts of the ACTUAL data behind each figure.
  const OUT_OK = new Set(["paid", "sent", "overdue"]);
  const IN_OK = new Set(["paid", "received"]);
  const completeness: AangifteCompleteness = {
    turnoverDays: turnover.length,
    quarterDays,
    incomingInvoiceCount: invRaw.filter((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "")).length,
    outgoingInvoiceCount: invRaw.filter((i) => effDir(i) === "outgoing" && OUT_OK.has(i.status ?? "")).length,
    hasEuPurchase: invRaw.some((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "") && typeof i.client_btw_number === "string" && EU_VAT.test(i.client_btw_number.trim())),
  };

  const aangifte = buildAangifte(result, completeness, `Q${quarter} ${year}`);
  return NextResponse.json({ ok: true, year, quarter, aangifte });
}
