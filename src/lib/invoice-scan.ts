// src/lib/invoice-scan.ts
// [INVOICE-SCAN] How many booked purchase invoices are wrong, and which quarter do they sit in?
// Pure, no I/O.
//
// ── WHY THIS EXISTS ──
// Everything built before this answers "is THIS invoice wrong?" — a badge on a card, a hint in a
// message. Useful when you are already looking at that card. Useless for the question the owner
// actually has after seeing two of them: HOW MANY MORE ARE THERE?
//
// That question has real weight, because these are not display bugs. A credit note booked as a
// debt inflates what you think you owe AND adds input tax that should have been subtracted. An
// invoice whose breakdown does not add up pushes a wrong deductible amount into the return. So
// "how many" is really two questions:
//
//   · how much money is standing wrong in the books right now, and
//   · which QUARTERS does it touch — because a quarter you have already filed is not a screen to
//     fix, it is a correction to file.
//
// Without this, the honest answer to "did we get them all?" was "nobody knows". A list of 429
// invoices cannot be checked by eye, and the two that were noticed were noticed by accident.
//
// ── WHAT IT DOES NOT DO ──
// It changes nothing and proposes no repair. It counts, groups by quarter, and hands back the ids
// so the screen can show exactly those rows. Every finding here is one the owner still has to open
// and decide on — the same rule as everywhere in this money line.

import { quarterKeyOf } from "./quarter";
import { looksLikeCreditnota, creditnotaSignConflict } from "./creditnota-signal";
import { reconcileBtw } from "./btw-reconcile";
import { round2 } from "./invoice-totals";

/** The highest Dutch btw rate. No blend of 0/9/21 exceeds it — so above this is impossible. */
const MAX_NL_RATE = 21;

/** The three ways a booked invoice can be wrong, in the order they cost money. */
export type ScanKind =
  /** The app itself says creditnota, and the amount sits there as a debt. Certain. */
  | "sign_conflict"
  /** The supplier's own numbering says credit note; ours says debt. Suspicion. */
  | "credit_suspect"
  /** ex + btw does not equal the total. The breakdown is broken. */
  | "arithmetic";

export type ScanRow = {
  id: string;
  invoice_number: string | null;
  client_name: string | null;
  invoice_date: string | null;
  invoice_type?: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
  total_inc_btw: number | null;
};

export type ScanFinding = {
  id: string;
  kind: ScanKind;
  /** "2026-Q1", or null when the invoice carries no usable date. */
  quarter: string | null;
  /** What this row currently contributes to the books, signed as stored. */
  amount: number;
};

export type QuarterTally = {
  quarter: string | null;
  signConflict: number;
  creditSuspect: number;
  arithmetic: number;
  /** Every finding's stored total in this quarter — the size of what is standing wrong. */
  amount: number;
};

export type InvoiceScan = {
  findings: ScanFinding[];
  /** Newest quarter first; a null quarter (undated invoices) sorts last. */
  quarters: QuarterTally[];
  total: number;
  /** How many rows were examined — so "0 findings" is distinguishable from "nothing was read". */
  scanned: number;
};

/**
 * One invoice's verdict, or null when nothing is wrong with it.
 *
 * The order is the order of certainty, and a row gets ONE verdict — the most certain one. A credit
 * note booked as a debt usually also fails the arithmetic gate, and reporting it twice would make
 * the count say more invoices are wrong than there are.
 */
function verdictFor(row: ScanRow, vendorNumbers: readonly (string | null | undefined)[]): ScanKind | null {
  if (creditnotaSignConflict({ invoiceType: row.invoice_type, totalIncBtw: row.total_inc_btw })) {
    return "sign_conflict";
  }
  if (looksLikeCreditnota({
    invoiceNumber: row.invoice_number,
    totalIncBtw: row.total_inc_btw,
    invoiceType: row.invoice_type,
    vendorNumbers,
  }).suspected) {
    return "credit_suspect";
  }
  // Only when a breakdown was actually stored. A row that carries just a total (both ex and btw
  // absent) is not a contradiction — it is an unread breakdown, which the intake gate already
  // reports in its own words and which no amount of counting here would clarify.
  if (row.total_ex_btw != null && row.btw_amount != null) {
    if (!reconcileBtw(row.total_ex_btw, row.btw_amount, row.total_inc_btw).ok) return "arithmetic";
    // TWO gates, not one. Checking only the sum misses an entire class, and the real invoice that
    // proved it is the potato wholesaler: stored 26.00 + 13.42 = 39.42 reconciles perfectly and is
    // still completely wrong — on paper a returned container of −408.00 makes the total −109.58.
    // What gives it away is the rate: 13.42 over 26.00 is 52%, and no Dutch rate or blend reaches
    // that. Magnitude ratio, mirroring safecore and the confirm modal, so a credit note carrying
    // positive goods-btw over a negative net base is not falsely flagged.
    const ex = row.total_ex_btw;
    if (Math.abs(ex) > 0.005) {
      const rate = Math.round(Math.abs(row.btw_amount / ex) * 100);
      if (rate > MAX_NL_RATE) return "arithmetic";
    }
  }
  return null;
}

/**
 * Scan every booked purchase invoice and group what is wrong by quarter.
 *
 * `rows` should be the FULL set the owner has, not a filtered view: the credit-note signal needs
 * every document number a supplier used in order to see that they keep two kinds apart, and a
 * count over a filtered list would answer a question nobody asked.
 */
export function scanInvoices(rows: readonly ScanRow[]): InvoiceScan {
  // Numbers per supplier, built once. Keyed on a trimmed lowercase name — the same key the screen
  // uses — so a supplier written with a trailing space is not treated as a second company.
  const byVendor = new Map<string, string[]>();
  for (const r of rows) {
    const key = (r.client_name ?? "").trim().toLowerCase();
    if (!key || !r.invoice_number) continue;
    const list = byVendor.get(key);
    if (list) list.push(r.invoice_number);
    else byVendor.set(key, [r.invoice_number]);
  }

  const findings: ScanFinding[] = [];
  for (const r of rows) {
    const vendorNumbers = byVendor.get((r.client_name ?? "").trim().toLowerCase()) ?? [];
    const kind = verdictFor(r, vendorNumbers);
    if (!kind) continue;
    findings.push({
      id: r.id,
      kind,
      quarter: quarterKeyOf(r.invoice_date),
      amount: Number(r.total_inc_btw ?? 0),
    });
  }

  const perQuarter = new Map<string, QuarterTally>();
  for (const f of findings) {
    const key = f.quarter ?? "";
    const t = perQuarter.get(key) ?? { quarter: f.quarter, signConflict: 0, creditSuspect: 0, arithmetic: 0, amount: 0 };
    if (f.kind === "sign_conflict") t.signConflict++;
    else if (f.kind === "credit_suspect") t.creditSuspect++;
    else t.arithmetic++;
    t.amount = round2(t.amount + f.amount);
    perQuarter.set(key, t);
  }

  // Newest quarter first — that is where an unfiled return still is, and therefore where a
  // correction is still just a correction. Undated invoices sort last: they belong to no quarter,
  // so they cannot be placed on this timeline at all.
  const quarters = [...perQuarter.values()].sort((a, b) => {
    if (a.quarter === b.quarter) return 0;
    if (a.quarter === null) return 1;
    if (b.quarter === null) return -1;
    return b.quarter.localeCompare(a.quarter);
  });

  return { findings, quarters, total: findings.length, scanned: rows.length };
}

/** The ids of every finding, for a screen that wants to show exactly those rows. */
export function scanFindingIds(scan: InvoiceScan): Set<string> {
  return new Set(scan.findings.map((f) => f.id));
}
