// src/app/api/aangifte/route.ts
// [AANGIFTE] Read-only CONCEPT BTW-aangifte for a quarter. Fetches the same sources as
// /api/result, runs the one reconciliation engine (computeResult), and maps it to the
// Belastingdienst rubrieken (buildAangifte). Every figure is derived from the owner's
// own imported data; the response carries honest completeness notes. User-scoped (RLS).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { computeResult, toResultBankTx, cardBudgetBound, type ResultInvoice, type ResultBankTx, type ResultCashEntry } from "@/lib/financial-result";
import { turnoverNetOmzet, type DailyTurnover } from "@/lib/turnover";
import { buildAangifte, type AangifteCompleteness } from "@/lib/aangifte";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { quarterFromParams } from "@/lib/quarter";
import { fetchAllRows } from "@/lib/supabase-paginate";

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

  const sp = req.nextUrl.searchParams;
  // [QUARTER] Honour ?year&quarter (bounded), else default to the LAST COMPLETED quarter —
  // the app-wide default (quarter.ts). A bare hit no longer returns the open quarter.
  const { year, quarter } = quarterFromParams((k) => sp.get(k));

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

  // Invoices (both directions) in the quarter. [PAGINATION] paged past the 1000-row cap.
  const invRaw = await fetchAllRows((from, to) => pipeline
    .from("invoices")
    .select("direction, status, total_ex_btw, btw_amount, client_btw_number, sender_id, receiver_id")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("id", { ascending: true }).range(from, to));
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
  const bankRows = await fetchAllRows((from, to) => pipeline
    .from("bank_transactions")
    .select("amount, category, invoice_id, date, description, counterpart_name")
    .eq("user_id", ownerId).gte("date", start).lte("date", end)
    .order("id", { ascending: true }).range(from, to));
  // [SETTLE] The card-settlement de-dup is derived by the shared toResultBankTx mapper, so
  // /api/result, /api/readiness AND the closing package all agree on the same quarter and the
  // same covered-day witness rule (incl. an acquirer payout the owner mis-tapped as 'omzet').
  const bankTx: ResultBankTx[] = bankRows.map(toResultBankTx);

  const cashRows = await fetchAllRows((from, to) => pipeline
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date, document_id")
    .eq("user_id", ownerId).gte("entry_date", start).lte("entry_date", end)
    .order("id", { ascending: true }).range(from, to));
  const cashEntries: ResultCashEntry[] = cashRows.map((c) => ({
    direction: c.direction === "in" ? "in" : "out",
    amount: c.amount, category: c.category, btw_rate: c.btw_rate, date: c.entry_date,
    document_id: (c as { document_id?: string | null }).document_id ?? null, // [CASH-COST-VAT]
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

  const coveredBudget = new Map(
    allTurnover
      .filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0)
      .map((t) => [t.turnover_date, cardBudgetBound(t)] as const),
  );
  const result = computeResult(invoices, bankTx, cashEntries, turnover, coveredDates, 0, coveredBudget);

  // Honest completeness — counts of the ACTUAL data behind each figure.
  const OUT_OK = new Set(["paid", "sent", "overdue"]);
  const IN_OK = new Set(["paid", "received"]);

  // [DATELESS] A verified invoice with NO invoice_date is silently dropped by the date-range
  // fetch above, so it is NOT in the figures — count those separately so the concept can warn
  // instead of quietly understating omzet/voorbelasting. (Matches the ZIP's dateless warning.)
  const datelessRaw = await fetchAllRows((from, to) => pipeline
    .from("invoices")
    .select("status, receiver_id, direction")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .is("invoice_date", null)
    .order("id", { ascending: true }).range(from, to));
  const datelessVerifiedCount = datelessRaw.filter((i) => {
    const dir = i.direction === "incoming" || i.direction === "outgoing"
      ? i.direction : (i.receiver_id === ownerId ? "incoming" : "outgoing");
    return dir === "incoming" ? IN_OK.has(i.status ?? "") : OUT_OK.has(i.status ?? "");
  }).length;

  const completeness: AangifteCompleteness = {
    turnoverDays: turnover.length,
    quarterDays,
    incomingInvoiceCount: invRaw.filter((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "")).length,
    outgoingInvoiceCount: invRaw.filter((i) => effDir(i) === "outgoing" && OUT_OK.has(i.status ?? "")).length,
    hasEuPurchase: invRaw.some((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "") && typeof i.client_btw_number === "string" && EU_VAT.test(i.client_btw_number.trim())),
    datelessVerifiedCount,
  };

  const aangifte = buildAangifte(result, completeness, `Q${quarter} ${year}`);
  return NextResponse.json({ ok: true, year, quarter, aangifte });
}
