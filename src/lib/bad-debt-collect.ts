// src/lib/bad-debt-collect.ts
// [BAD-DEBT] I/O collector shared by /api/aangifte, /api/readiness and the closing package, so all
// three flag the same reclaimable bad-debt BTW. Kept out of bad-debt.ts (pure). Under kasstelsel it
// short-circuits to nothing (no BTW was declared on an unpaid invoice). Best-effort: a query error
// degrades to "none" rather than blocking a money read.

import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import { detectBadDebt, type BadDebtInput, type BadDebtResult } from "./bad-debt";
import type { VatScheme } from "./vat-scheme";

const EMPTY: BadDebtResult = { eligible: [], totalReclaimableBtw: 0, usedInvoiceDateFallback: false };

/**
 * Find the owner's sales invoices whose BTW is reclaimable as a bad debt as of `asOf` (a period end
 * or today). Fetches the owner's OUTGOING invoices still in a declared-but-unpaid state (sent /
 * overdue) across all time — bad debt is about OLD receivables, so there is no date-range filter —
 * and hands them to the pure detector. Only under factuurstelsel.
 */
export async function collectBadDebt(
  pipeline: PipelineClient,
  ownerId: string,
  scheme: VatScheme,
  asOf: string,
): Promise<BadDebtResult> {
  if (scheme !== "factuur") return EMPTY;
  const rows = await fetchAllRows<{
    invoice_number: string | null; client_name: string | null; direction: string | null;
    status: string | null; invoice_date: string | null; due_date: string | null;
    total_ex_btw: number | null; btw_amount: number | null; total_inc_btw: number | null;
    amount_paid: number | null; receiver_id: string | null;
  }>((from, to) => pipeline
    .from("invoices")
    .select("invoice_number, client_name, direction, status, invoice_date, due_date, total_ex_btw, btw_amount, total_inc_btw, amount_paid, receiver_id")
    .eq("sender_id", ownerId)
    .in("status", ["sent", "overdue"])
    .order("id", { ascending: true }).range(from, to),
  ).catch(() => [] as never[]);

  const invoices: BadDebtInput[] = rows.map((r) => ({
    invoiceNumber: r.invoice_number,
    clientName: r.client_name,
    direction: r.direction === "incoming" || r.direction === "outgoing"
      ? r.direction
      : r.receiver_id === ownerId ? "incoming" : "outgoing",
    status: r.status,
    invoiceDate: r.invoice_date,
    dueDate: r.due_date,
    totalExBtw: r.total_ex_btw,
    btwAmount: r.btw_amount,
    totalIncBtw: r.total_inc_btw,
    amountPaid: r.amount_paid,
  }));
  return detectBadDebt({ scheme, asOf, invoices });
}
