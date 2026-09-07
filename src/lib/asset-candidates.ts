// src/lib/asset-candidates.ts
// [BEDRIJFSMIDDEL] Which purchase invoices are worth ASKING about — never deciding about.
//
// Measured on the live administration before this was written: ~260 purchase invoices of € 450
// or more in twenty months, and all but one are stock — the weekly meat, the wholesaler, the
// packaging. An amount alone says nothing. So the question is only put for a purchase that is
// large enough AND comes from a supplier this administration hardly ever buys from: a butcher
// buys ovens once and meat every week. The rest is a door the owner can open himself, on the
// register screen, for any invoice at all.
//
// The owner's "nee, dit is inkoop" is remembered per invoice (asset_dismissals); a registered
// invoice is never a candidate again. The threshold follows the btw regime (depreciation.ts).

import { assetThreshold } from "./depreciation";

export interface CandidateInvoiceRow {
  id: string;
  invoice_date: string | null;
  invoice_number: string | null;
  client_name: string | null;
  supplier_id: string | null;
  total_ex_btw: number | null;
  total_inc_btw: number | null;
  invoice_type?: string | null;
  status: string | null;
}

export interface AssetCandidate {
  invoiceId: string;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  supplierName: string;
  /** The amount compared to the threshold, in the owner's regime. */
  amount: number;
  /** How many purchase invoices this supplier has in the window — the reason it is asked. */
  supplierInvoices: number;
}

/** A supplier that appears at most this often in the window is "rarely bought from". */
export const RARE_SUPPLIER_MAX_INVOICES = 2;

const CANDIDATE_STATUSES = new Set(["received", "paid"]);

function supplierKey(r: CandidateInvoiceRow): string {
  return r.supplier_id ?? (r.client_name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function assetCandidates(
  rows: readonly CandidateInvoiceRow[],
  opts: { btwDeductible: boolean; registered: ReadonlySet<string>; dismissed: ReadonlySet<string> },
): AssetCandidate[] {
  const perSupplier = new Map<string, number>();
  for (const r of rows) {
    if (!CANDIDATE_STATUSES.has(r.status ?? "")) continue;
    const k = supplierKey(r);
    if (k) perSupplier.set(k, (perSupplier.get(k) ?? 0) + 1);
  }
  const out: AssetCandidate[] = [];
  for (const r of rows) {
    if (!CANDIDATE_STATUSES.has(r.status ?? "")) continue;
    if (opts.registered.has(r.id) || opts.dismissed.has(r.id)) continue;
    const ex = Number(r.total_ex_btw) || 0, inc = Number(r.total_inc_btw) || 0;
    // A creditnota is money coming back, never an asset going in.
    if ((r.invoice_type ?? "") === "creditnota" || inc < 0 || ex < 0) continue;
    const { compared, isAboveThreshold } = assetThreshold({ totalExBtw: ex, totalIncBtw: inc, btwDeductible: opts.btwDeductible });
    if (!isAboveThreshold) continue;
    const k = supplierKey(r);
    const n = k ? perSupplier.get(k) ?? 1 : 1;
    if (n > RARE_SUPPLIER_MAX_INVOICES) continue;
    out.push({
      invoiceId: r.id, invoiceDate: r.invoice_date, invoiceNumber: r.invoice_number,
      supplierName: (r.client_name ?? "").trim() || "—", amount: compared, supplierInvoices: n,
    });
  }
  return out.sort((a, b) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? ""));
}
