// src/app/api/cashflow/route.ts
// [VOORUIT] How much money there will be in 7 and in 30 days.
//
// The rule lives in src/lib/cashflow-forecast.ts and is tested there. This route only ASSEMBLES
// its inputs — the bank total and the lines since, the drawer, the open purchase invoices, the
// open sales invoices with each client's measured pace, and eight weeks of till takings — and
// decides nothing. Same shape as /api/btw-reservation, for the same reason: the screen paints
// first and asks for this afterwards, so Vandaag stays as fast as the [WATERVAL] work made it.
//
// ── WHICH READS MAY DEGRADE, AND WHICH MAY NOT ──
// The two invoice reads carry the claim. A failed one becomes NO answer (503), never an empty
// list — an empty list here reads as "nothing to pay", the exact [NO-FALSE-CLEAR] lie this
// codebase refuses on Vandaag. The bank, drawer, pace and takings reads feed figures that the
// engine can honestly do without: each failure becomes null, and the engine turns null into a
// named caveat rather than a zero.
//
// Read-only. service_role, every query pinned to the authenticated user.

import { NextResponse } from "next/server";
import { readExcludedBankIds } from "@/lib/bank-ignored-excluded";
import { getSessionUser } from "@/lib/session-user";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { bankBalanceOf } from "@/lib/bank-balance";
import { computeDrawerBalance } from "@/lib/cash";
import { liveCashEntries } from "@/lib/cash-live";
import { amsterdamToday } from "@/lib/format-nl";
import { addDays } from "@/lib/recurring";
import { dayNumberFromIso } from "@/lib/invoice-reminders";
import { openAmountSigned } from "@/lib/partial-payment";
import { creditedTotalsFrom, filterOpenReceivables, fullyCreditedIdsFrom } from "@/lib/credited-invoices";
import { detectPaymentDifferences } from "@/lib/payment-difference";
import { clientPaymentBehaviour } from "@/lib/client-payment-behaviour";
import { belongsToIncassoSupplier, incassoSupported, readIncassoSuppliers, type IncassoSupplier } from "@/lib/incasso-settle";
import {
  forecastCashflow,
  takingsFromTillDays,
  type ForecastPayable,
  type ForecastReceivable,
} from "@/lib/cashflow-forecast";

export const dynamic = "force-dynamic";

/** How far back the till average looks. Eight weeks: long enough to hold a slow fortnight. */
const TAKINGS_SPAN_DAYS = 56;
/** How far back a client's paid invoices are read for their pace. */
const PACE_SPAN_DAYS = 365;

type InvoiceRow = {
  id: string;
  client_name: string | null;
  supplier_id?: string | null;
  invoice_date: string | null;
  due_date: string | null;
  status: string | null;
  payment_date: string | null;
  total_inc_btw: number | null;
  amount_paid: number | null;
  invoice_type?: string | null;
};

const SELECT = "id, client_name, supplier_id, invoice_date, due_date, status, payment_date, total_inc_btw, amount_paid, invoice_type";

/** The pace map's key: the client as the invoices name them, trimmed and lowered. */
function clientKey(name: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pipeline = createPipelineClient();
  const today = amsterdamToday();
  const todayNum = dayNumberFromIso(today);

  // ── The two reads that carry the claim ────────────────────────────────────────────
  const [payRows, recvRows] = await Promise.all([
    fetchAllRows<InvoiceRow>((from, to) => pipeline
      .from("invoices").select(SELECT)
      .eq("receiver_id", user.id).eq("direction", "incoming")
      .in("status", ["received", "sent", "overdue"])
      .order("id", { ascending: true }).range(from, to)).catch(() => null),
    fetchAllRows<InvoiceRow>((from, to) => pipeline
      .from("invoices").select(SELECT)
      .eq("sender_id", user.id).eq("direction", "outgoing")
      .in("status", ["sent", "overdue"])
      .order("id", { ascending: true }).range(from, to)).catch(() => null),
  ]);
  if (payRows == null || recvRows == null) {
    console.error("[VOORUIT] invoice read failed — refusing to answer", {
      userId: user.id, payFailed: payRows == null, recvFailed: recvRows == null,
    });
    return NextResponse.json({ error: "read_failed" }, { status: 503 });
  }

  // ── Everything else, concurrently. Each may degrade to null and be NAMED by the engine. ──
  type PeriodRow = { document_id: string | null; iban: string | null; period_end: string | null; closing_balance: number | null };
  type TxRow = { id: string; date: string | null; amount: number | null; statement_document_id: string | null };
  type TillRow = { turnover_date: string | null; pin_amount: number | null; cash_amount: number | null };

  const [periodRows, txRows, kasParts, paidRows, incasso, creditRows] = await Promise.all([
    (async (): Promise<PeriodRow[] | null> => {
      try {
        // bank_statement_periods is not in the generated types → relaxed client, as /api/daily-truth.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (pipeline as any)
          .from("bank_statement_periods").select("document_id, iban, period_end, closing_balance")
          .eq("user_id", user.id).order("period_end", { ascending: false }).limit(400);
        return error ? null : ((data ?? []) as PeriodRow[]);
      } catch { return null; }
    })(),
    fetchAllRows<TxRow>((from, to) => pipeline
      .from("bank_transactions").select("id, date, amount, statement_document_id").eq("user_id", user.id)
      .order("id", { ascending: true }).range(from, to)).catch(() => null),
    // [CASH-LEDGER] The drawer, the SAME figure the Kas page shows — mirrors /api/daily-truth.
    (async () => {
      const liveCash = await liveCashEntries(pipeline);
      return Promise.all([
        fetchAllRows((from, to) => liveCash.only(pipeline
          .from("cash_entries").select("direction, amount, entry_date, category").eq("user_id", user.id))
          .order("id", { ascending: true }).range(from, to)).catch(() => null),
        fetchAllRows<TillRow>((from, to) => pipeline
          .from("daily_turnover").select("turnover_date, pin_amount, cash_amount").eq("user_id", user.id)
          .order("id", { ascending: true }).range(from, to)).catch(() => null),
        pipeline.from("profiles").select("kas_opening_balance").eq("id", user.id).maybeSingle(),
      ]);
    })(),
    recvRows.length > 0
      ? fetchAllRows<InvoiceRow>((from, to) => pipeline
          .from("invoices").select(SELECT)
          .eq("sender_id", user.id).eq("direction", "outgoing").eq("status", "paid")
          .gte("payment_date", addDays(today, -PACE_SPAN_DAYS))
          .order("id", { ascending: true }).range(from, to)).catch(() => null)
      : [],
    (async (): Promise<IncassoSupplier[] | null> => {
      try {
        if (!(await incassoSupported(pipeline))) return [];
        return await readIncassoSuppliers(pipeline, user.id);
      } catch { return null; }
    })(),
    // [CREDIT-BRON] No status filter here: a creditnota that was itself settled still credits
    // the invoice it names. Read last, apart from the status-filtered reads above.
    recvRows.length > 0
      ? fetchAllRows<{ original_invoice_id: string | null; total_inc_btw: number | null }>((from, to) => pipeline
          .from("invoices").select("original_invoice_id, total_inc_btw")
          .eq("sender_id", user.id).eq("invoice_type", "creditnota")
          .not("original_invoice_id", "is", null)
          .order("id", { ascending: true }).range(from, to)).catch(() => null)
      : [],
  ]);

  // ── Bank: the last statement's closing balance, plus the lines since ──────────────
  const balance = bankBalanceOf((periodRows ?? []).map((r) => ({
    iban: r.iban, periodEnd: r.period_end, closingBalance: r.closing_balance,
  })));
  // A line dated after asOf is, for one account, by definition not inside that closing balance:
  // a statement ending later would have moved asOf. With several accounts the line cannot be
  // placed, so only lines after the NEWEST statement count — and the engine says so.
  //
  // Two more rules, both about a line that must NOT move the figure:
  //  · [WAAROM-WACHT-BANK] a line the owner set aside (privé, dubbel, niet van mij) is not money
  //    of this administration — the same exclusion the result engine applies;
  //  · an account WITHOUT a declared balance (a CSV import beside an MT940 account) has lines
  //    too, and adding them to the other account's closing balance shows a euro that is neither
  //    account's. When the balance is partial, only lines from statements of the accounts whose
  //    balance IS known count; the rest cannot be placed and the note already says the balance
  //    is partial.
  let netSinceAsOf: number | null = null;
  let bankBalance = balance.balance;
  if (bankBalance !== null && balance.asOf) {
    if (txRows == null) {
      console.error("[VOORUIT] bank lines unreadable — the balance is withheld rather than shown stale", { userId: user.id });
      bankBalance = null;
    } else {
      const since = balance.accounts > 1
        ? (periodRows ?? []).reduce<string>((m, r) => (r.period_end && r.period_end > m ? r.period_end : m), balance.asOf)
        : balance.asOf;
      const excluded = await readExcludedBankIds({ client: pipeline, userId: user.id, start: since, end: "2999-12-31" });
      let placeable: Set<string> | null = null;
      if (balance.partial) {
        const key = (iban: string | null) => (iban ?? "").trim() || "(zonder iban)";
        const withBalance = new Set((periodRows ?? []).filter((r) => r.closing_balance !== null && r.period_end).map((r) => key(r.iban)));
        placeable = new Set((periodRows ?? []).filter((r) => r.document_id && withBalance.has(key(r.iban))).map((r) => r.document_id as string));
      }
      netSinceAsOf = txRows.reduce((s, t) => {
        if (!t.date || t.date <= since || excluded.has(t.id)) return s;
        if (placeable && (!t.statement_document_id || !placeable.has(t.statement_document_id))) return s;
        return s + (Number(t.amount) || 0);
      }, 0);
    }
  }

  // ── Kas ───────────────────────────────────────────────────────────────────────────
  const [cashRows, drawerTill, kasProf] = kasParts;
  let kas: number | null = null;
  const till = (drawerTill ?? []) as TillRow[];
  if (cashRows != null && drawerTill != null && kasProf.error == null) {
    const opening = Number((kasProf.data as { kas_opening_balance?: number | null } | null)?.kas_opening_balance ?? 0) || 0;
    const tillCash = till.reduce((s, t) => s + (Number(t.cash_amount) || 0), 0);
    const used = cashRows.length > 0 || tillCash !== 0 || opening !== 0;
    // No drawer at all — no entries, no cash takings, no opening balance — is a drawer of € 0,
    // not an unknown one: "de kas telt niet mee" over a shop that has no kas is noise.
    if (!used) kas = 0;
    if (used) {
      kas = computeDrawerBalance({
        openingBalance: opening,
        entries: (cashRows as { direction: string | null; amount: number; entry_date?: string | null; category?: string | null }[]).map((e) => ({
          direction: e.direction === "in" ? "in" : "out",
          amount: e.amount,
          date: e.entry_date ?? null,
          category: e.category ?? null,
        })),
        tillDays: till.map((t) => ({ date: t.turnover_date, cash_amount: t.cash_amount })),
      });
    }
  } else {
    console.error("[VOORUIT] kas read failed — the drawer is left out and named", { userId: user.id });
  }

  // ── Payables ──────────────────────────────────────────────────────────────────────
  if (incasso == null) console.error("[VOORUIT] incasso suppliers unreadable — nothing is marked incasso", { userId: user.id });
  const payables: ForecastPayable[] = payRows.map((r) => ({
    id: r.id,
    name: r.client_name ?? "",
    dueDate: r.due_date,
    open: openAmountSigned(r),
    incasso: incasso != null && belongsToIncassoSupplier(r, incasso) !== null,
  })).filter((p) => p.open !== 0);

  // ── Receivables: net of creditnotas, net of known payment differences ─────────────
  const recv = creditRows == null ? recvRows : filterOpenReceivables(recvRows, fullyCreditedIdsFrom(creditRows, recvRows));
  const creditedByInvoice = creditedTotalsFrom(creditRows ?? []);
  const creditedOn = (id: string) => creditedByInvoice.get(id) ?? 0;
  const differences = detectPaymentDifferences({
    invoices: recv.map((r) => ({
      id: r.id, status: r.status, total_inc_btw: r.total_inc_btw, amount_paid: r.amount_paid,
      last_payment_date: r.payment_date ?? null, credited_inc_btw: creditedOn(r.id),
    })),
    today,
  });
  const differenceOn = new Map(differences.differences.map((d) => [d.invoiceId, d.remainder]));

  if (paidRows == null) console.error("[VOORUIT] paid invoices unreadable — due dates stand in for the clients' pace", { userId: user.id });
  const paidByClient = new Map<string, InvoiceRow[]>();
  for (const r of paidRows ?? []) {
    const k = clientKey(r.client_name);
    if (!k) continue;
    paidByClient.set(k, [...(paidByClient.get(k) ?? []), r]);
  }
  const paceOf = (name: string | null): number | null => {
    const rows = paidByClient.get(clientKey(name));
    if (!rows) return null;
    if (todayNum === null) return null;
    return clientPaymentBehaviour(rows, todayNum).pace?.medianDaysAfterInvoice ?? null;
  };
  const receivables: ForecastReceivable[] = recv.map((r) => ({
    id: r.id,
    name: r.client_name ?? "",
    invoiceDate: r.invoice_date,
    dueDate: r.due_date,
    open: Math.max(0, openAmountSigned(r, creditedOn(r.id)) - (differenceOn.get(r.id) ?? 0)),
    expectedDays: paceOf(r.client_name),
  })).filter((x) => x.open > 0);

  // ── Takings: the last eight weeks of booked till days ─────────────────────────────
  const takings = drawerTill == null
    ? null
    : takingsFromTillDays(till.filter((t) => t.turnover_date && t.turnover_date > addDays(today, -TAKINGS_SPAN_DAYS) && t.turnover_date <= today), TAKINGS_SPAN_DAYS, today);

  const forecast = forecastCashflow({
    today,
    bank: { balance: bankBalance, asOf: balance.asOf, partial: balance.partial, netSinceAsOf, accounts: balance.accounts },
    kas,
    payables,
    receivables,
    takings,
  });

  return NextResponse.json(forecast);
}
