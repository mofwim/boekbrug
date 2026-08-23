// src/lib/package-freshness.ts
// [PAKKET-VERS] Is the ZIP on the accountant's disk still the administration?
//
// The download is a copy, and a copy starts aging the moment it is made. An accountant pulls the
// Q2 package on 5 July; on 12 July the client photographs a June receipt that was still in the
// glovebox. The administration now contains a cost the package does not, the accountant books the
// quarter from the file on his disk, and nobody is wrong at any single step — the aangifte is
// simply missing a receipt and the first person to notice is the client, months later, asking why
// a cost he definitely handed in is not in his result.
//
// A shared folder has exactly this problem and cannot even name it. This module can, because the
// app holds both halves of the sentence: WHEN the package was pulled (the accountant.package_
// downloaded audit row that /api/closing-package writes) and WHAT has been added to the quarter
// since (rows whose created_at/updated_at lies after that moment). "Een ontworpen overdracht in
// plaats van een gedeelde map" is the product's own pitch — this is that sentence made checkable.
//
// ── The membership rules are the PACKAGE's rules, imported, not restated ──
//
// A freshness count is only honest if it counts precisely what would have landed in the ZIP.
// Restating the membership here — "verified means sent/paid/overdue", "a shared doc belongs to the
// quarter its period tag names" — would be the duplicate-authority defect this session has already
// found four times (groundingBlocksAutoBooking, documentCheckBlocks, vendorGroundingText,
// settleNoticeText): a literal copy that drifts the day closing-package.ts changes, after which
// this module confidently reports staleness about a package with different contents. So the two
// judgement calls that HAVE a function — isVerifiedForPackage, effectiveDirection — are imported
// from closing-package.ts and CALLED, and the [PAKKET-VERS] gate pins those calls.
//
// ── What "changed" means, and what it deliberately does not ──
//
// Counted: rows ADDED since the download, and invoices TOUCHED since it (updated_at) — an invoice
// that sat unverified at download time and was verified afterwards enters the package without a
// new created_at, and a corrected amount changes the sheets the ZIP carries. Not counted: edits to
// sources that keep no updated_at (cash, turnover, bank), and deletions. The sentence therefore
// says "bijgekomen of gewijzigd" about what it saw and never claims the package is proven
// identical — absence of evidence here is not evidence of absence, and the one thing this module
// must never do is talk an accountant OUT of re-downloading.
//
// Pure: the route reads, this decides. Tested in package-freshness.test.ts.

import { isVerifiedForPackage, effectiveDirection, type Quarter } from "./closing-package";
import { quarterRange } from "./kasboek";

/** The invoice columns the freshness rules need — a structural slice of an invoices row. */
export interface FreshInvoiceRow {
  direction: string | null;
  status: string | null;
  sender_id: string | null;
  receiver_id: string | null;
  invoice_date: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** The document columns the freshness rules need. */
export interface FreshDocRow {
  doc_type: string | null;
  period: string | null;
  shared: boolean | null;
  trashed: boolean | null;
  invoice_id: string | null;
  created_at: string | null;
}

/** A dated row from bank_transactions, cash_entries or daily_turnover, already mapped. */
export interface FreshDatedRow {
  /** The date that decides quarter membership (date / entry_date / turnover_date). */
  docDate: string | null;
  createdAt: string | null;
}

export interface PackageFreshnessInput {
  /** The audit row's created_at of the accountant's LAST download of this quarter. */
  downloadedAt: string;
  ownerId: string;
  year: number;
  quarter: Quarter;
  invoices: FreshInvoiceRow[];
  documents: FreshDocRow[];
  bank: FreshDatedRow[];
  cash: FreshDatedRow[];
  turnover: FreshDatedRow[];
}

export interface PackageFreshness {
  downloadedAt: string;
  invoices: number;
  documents: number;
  bank: number;
  cash: number;
  turnover: number;
  total: number;
  /** One Dutch sentence for the werkboard row. The accountant module is Dutch-only by design. */
  sentence: string;
}

const MONTHS_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** '2026-07-05T09:12:00+00:00' → '5 jul'. The year is on the board already; the day is the news. */
function nlDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS_NL[Number(m[2]) - 1] ?? m[2]}`;
}

/** Strictly after the download. An unparseable timestamp counts as touched — the safe side for a
 *  figure whose whole job is to send someone back for a fresh copy. */
function after(ts: string | null, downloadedAtMs: number): boolean {
  if (!ts) return false;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? true : ms > downloadedAtMs;
}

const isoDay = (s: string | null): string | null =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;

export function packageFreshness(input: PackageFreshnessInput): PackageFreshness {
  const { downloadedAt, ownerId, year, quarter } = input;
  const { start, end } = quarterRange(year, quarter);
  const periodTag = `${year}-Q${quarter}`;
  const downloadedAtMs = Date.parse(downloadedAt);
  const inQuarter = (d: string | null): boolean => {
    const day = isoDay(d);
    return day !== null && day >= start && day <= end;
  };

  // ── Invoices: the package's own judgement, then "touched since" ──
  // A NULL invoice_date does NOT disqualify: [DATE-GAP] in closing-package.ts puts dateless
  // verified invoices in the package precisely because range filters drop them silently.
  let invoices = 0;
  for (const r of input.invoices) {
    if ((r.status ?? "") === "archived") continue;
    if (r.invoice_date !== null && !inQuarter(r.invoice_date)) continue;
    const direction = effectiveDirection(r, ownerId);
    if (!isVerifiedForPackage({ direction, status: r.status })) continue;
    if (after(r.updated_at, downloadedAtMs) || after(r.created_at, downloadedAtMs)) invoices += 1;
  }

  // ── Documents: the two ways a file lands in the ZIP ──
  //   · a bankafschrift tagged with this period, or an untagged one uploaded inside the quarter;
  //   · a shared loose document (bon, contract) whose period tag names this quarter.
  let documents = 0;
  for (const d of input.documents) {
    if (d.trashed === true) continue;
    if (!after(d.created_at, downloadedAtMs)) continue;
    const isStatement =
      d.doc_type === "bankafschrift" && (d.period === periodTag || (d.period === null && inQuarter(d.created_at)));
    const isSharedLoose = d.shared === true && d.invoice_id === null && d.period === periodTag;
    if (isStatement || isSharedLoose) documents += 1;
  }

  const countDated = (rows: FreshDatedRow[]): number => {
    let n = 0;
    for (const r of rows) if (inQuarter(r.docDate) && after(r.createdAt, downloadedAtMs)) n += 1;
    return n;
  };
  const bank = countDated(input.bank);
  const cash = countDated(input.cash);
  const turnover = countDated(input.turnover);

  const total = invoices + documents + bank + cash + turnover;

  // The sentence names its parts, so "7 stukken" never sends someone hunting through the wrong
  // list. Order: the sources an accountant checks first.
  const parts: string[] = [];
  const part = (n: number, one: string, many: string) => { if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`); };
  part(invoices, "factuur", "facturen");
  part(documents, "document", "documenten");
  part(bank, "bankregel", "bankregels");
  part(cash, "kasboeking", "kasboekingen");
  part(turnover, "omzetdag", "omzetdagen");

  const sentence =
    total === 0
      ? `Pakket opgehaald op ${nlDay(downloadedAt)}. Sindsdien is er in dit kwartaal niets bijgekomen.`
      : `Pakket opgehaald op ${nlDay(downloadedAt)} — sindsdien ${parts.join(", ")} bijgekomen of gewijzigd. Haal het pakket opnieuw op.`;

  return { downloadedAt, invoices, documents, bank, cash, turnover, total, sentence };
}

/**
 * The download moments, out of the raw audit rows. entity_id is `${ownerId}:${year}-Q${quarter}`;
 * the LAST download per owner wins, because the accountant works from the newest copy on his disk.
 * Rows for other quarters or malformed ids are ignored, never guessed at.
 */
export function lastDownloadPerOwner(
  rows: Array<{ entity_id: string | null; created_at: string | null }>,
  year: number,
  quarter: Quarter,
): Map<string, string> {
  const suffix = `:${year}-Q${quarter}`;
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.entity_id || !r.created_at || !r.entity_id.endsWith(suffix)) continue;
    const ownerId = r.entity_id.slice(0, r.entity_id.length - suffix.length);
    if (!ownerId) continue;
    const prev = out.get(ownerId);
    if (!prev || Date.parse(r.created_at) > Date.parse(prev)) out.set(ownerId, r.created_at);
  }
  return out;
}
