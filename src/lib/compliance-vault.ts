// src/lib/compliance-vault.ts
// [KLUIS] Compliance-kluis (anchor gateway #5) — pure retention + completeness math.
// NO I/O. The vault turns what's already stored (invoices + documents) into the
// legally-framed 7-year archive the Belastingdienst requires, and an honest
// per-year/per-quarter completeness picture. Every number here is COUNTED from the
// owner's real data — never estimated, never invented. The door stays open (an
// export always works); the value is the organized truth, not a cage.
//
// Dutch fiscale bewaarplicht (Art. 52 AWR): 7 years for the general administratie
// (10 years for data on onroerende zaken — out of scope here; we state the 7-year
// rule and don't pretend to track the real-estate exception).

export const RETENTION_YEARS = 7;

/** The last calendar year through which year Y's records must be kept. Records for
 *  fiscal year Y must be retained for 7 years after the end of that year, i.e.
 *  through 31 December of (Y + 7). 2023 → keep through 2030, discardable from 2031. */
export function keepThroughYear(year: number): number {
  return year + RETENTION_YEARS;
}

/** Is year Y still within the mandatory retention window as of `currentYear`? */
export function isWithinRetention(year: number, currentYear: number): boolean {
  return currentYear <= keepThroughYear(year);
}

/** The years the owner should currently be holding, newest first: the current year
 *  back to the oldest still-mandatory year (currentYear − 7). */
export function retentionWindow(currentYear: number): number[] {
  const years: number[] = [];
  for (let y = currentYear; y >= currentYear - RETENTION_YEARS; y--) years.push(y);
  return years;
}

// ─── Inputs (subsets of the real rows) ────────────────────────────────────────

export interface VaultInvoice {
  invoice_date: string | null; // ISO — the year/quarter bucket
  direction: string | null;    // 'outgoing' | 'incoming'
  invoice_type: string | null; // 'factuur' | 'creditnota' | 'offerte' | 'pro_forma'
  status: string | null;
  total_inc_btw: number | null;
}
export interface VaultDocument {
  doc_type: string | null; // 'factuur' | 'bankafschrift' | 'overig' | ...
  year: number | null;
  period: string | null;   // e.g. '2026-Q2'
  trashed?: boolean | null;
}

// ─── Per-quarter / per-year completeness ──────────────────────────────────────

export interface QuarterSummary {
  quarter: 1 | 2 | 3 | 4;
  outgoingCount: number;
  incomingCount: number;
  outgoingTotal: number;   // sum incl BTW (real money, for a sanity glance)
  bankStatements: number;  // bankafschrift documents tagged to this quarter
  hasActivity: boolean;    // any invoice this quarter
  missingBankStatement: boolean; // activity but no bank statement — a neutral gap flag
}

export interface YearSummary {
  year: number;
  keepThroughYear: number;
  withinRetention: boolean;
  outgoingCount: number;
  incomingCount: number;
  documentCount: number;      // non-trashed documents tagged to this year
  bankStatements: number;
  outgoingTotal: number;
  quarters: QuarterSummary[]; // always 4, Q1..Q4
  gaps: string[];             // human-readable, honest completeness notes (may be empty)
}

const isRealInvoice = (t: string | null) => t === "factuur" || t === "creditnota";

/** Quarter (1–4) of an ISO date, read straight from the month digits — NO Date, so
 *  no timezone shift (a UTC-parse + local-read, or vice-versa, moved first-of-quarter
 *  dates a quarter early on non-UTC servers) and no NaN from a malformed date. Returns
 *  null for anything without a valid 01–12 month, so it never mis-buckets. */
function quarterOf(iso: string): number | null {
  const m = /^\d{4}-(\d{2})/.exec(iso);
  if (!m) return null;
  const month = Number(m[1]);
  return month >= 1 && month <= 12 ? Math.floor((month - 1) / 3) + 1 : null;
}

/** Which quarter a document belongs to — from its period ('2026-Q2' or '2026-06'). */
function docQuarter(period: string | null): number | null {
  if (!period) return null;
  const q = period.match(/Q([1-4])/i);
  if (q) return Number(q[1]);
  // Fall back to a month in the period ('2026-06' → Q2).
  return quarterOf(period);
}

/**
 * Build the completeness picture for one fiscal year from the owner's real rows.
 * Counts only — a cash-only shop legitimately has zero bank statements, so a missing
 * statement is surfaced as a neutral note, never an error.
 */
export function summarizeYear(
  year: number,
  currentYear: number,
  invoices: VaultInvoice[],
  documents: VaultDocument[]
): YearSummary {
  const inYear = invoices.filter((i) => i.invoice_date?.slice(0, 4) === String(year) && isRealInvoice(i.invoice_type));
  const docsInYear = documents.filter((d) => d.year === year && !d.trashed);
  const bankDocs = docsInYear.filter((d) => d.doc_type === "bankafschrift");
  // Statements we can't place in a quarter (period is null/monthless). If the year has
  // any of these, we must NOT claim a specific quarter's statement is "missing" — we
  // have statements, we just can't attribute them. Suppressing avoids a false alarm.
  const unattributedBankDocs = bankDocs.filter((d) => docQuarter(d.period) === null).length;

  const quarters: QuarterSummary[] = ([1, 2, 3, 4] as const).map((q) => {
    const qInv = inYear.filter((i) => i.invoice_date && quarterOf(i.invoice_date) === q);
    const outgoing = qInv.filter((i) => i.direction === "outgoing");
    const incoming = qInv.filter((i) => i.direction === "incoming");
    const bankStatements = bankDocs.filter((d) => docQuarter(d.period) === q).length;
    const hasActivity = qInv.length > 0;
    return {
      quarter: q,
      outgoingCount: outgoing.length,
      incomingCount: incoming.length,
      outgoingTotal: outgoing.reduce((s, i) => s + (i.total_inc_btw ?? 0), 0),
      bankStatements,
      hasActivity,
      // Only an honest "missing" when the quarter has activity, no statement of its
      // own, AND there are no unattributable statements that could be covering it.
      missingBankStatement: hasActivity && bankStatements === 0 && unattributedBankDocs === 0,
    };
  });

  const outgoingCount = inYear.filter((i) => i.direction === "outgoing").length;
  const incomingCount = inYear.filter((i) => i.direction === "incoming").length;
  const bankStatements = bankDocs.length;
  const outgoingTotal = inYear.filter((i) => i.direction === "outgoing").reduce((s, i) => s + (i.total_inc_btw ?? 0), 0);

  const gaps: string[] = [];
  const missingQ = quarters.filter((q) => q.missingBankStatement).map((q) => `Q${q.quarter}`);
  if (missingQ.length > 0) {
    gaps.push(`Geen bankafschrift voor ${missingQ.join(", ")} — upload het afschrift zodat je administratie compleet is.`);
  }
  if (outgoingCount === 0 && incomingCount === 0 && docsInYear.length === 0) {
    gaps.push("Nog geen stukken voor dit jaar.");
  }

  return {
    year,
    keepThroughYear: keepThroughYear(year),
    withinRetention: isWithinRetention(year, currentYear),
    outgoingCount,
    incomingCount,
    documentCount: docsInYear.length,
    bankStatements,
    outgoingTotal,
    quarters,
    gaps,
  };
}

/** Summaries for every year in the retention window that actually has data, newest
 *  first. Years with no activity AND no documents are dropped so the vault shows the
 *  owner's real history, not a wall of empty years. */
export function summarizeVault(
  currentYear: number,
  invoices: VaultInvoice[],
  documents: VaultDocument[]
): YearSummary[] {
  return retentionWindow(currentYear)
    .map((y) => summarizeYear(y, currentYear, invoices, documents))
    .filter((s) => s.outgoingCount > 0 || s.incomingCount > 0 || s.documentCount > 0);
}
