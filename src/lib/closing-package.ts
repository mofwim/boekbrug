// src/lib/closing-package.ts
// [CLOSING-PACKAGE] Build ONE ZIP per quarter for the accountant: original
// invoices/receipts (PDF, not regenerated) + bank statement (passthrough) +
// a RAW BTW overview. No UBL, no vat_due, only verified invoices, honest about
// gaps. Grounded in a real accountant request (facturen/bonnen + MT940).
//
// Two PDF sources (Phase A finding):
//   - OUTGOING (sales): the generated PDF lives at invoices.pdf_url (FACTUUR-A,
//     best-effort — may be missing for failed renders / pre-FACTUUR-A invoices).
//   - INCOMING (purchases) + bank statement: documents table (invoice_id link
//     for invoices; doc_type='bankafschrift' for statements).
//
// Discipline:
//   - Filter on STORED status, never recomputed overdue — a ZIP must freeze
//     what was true, reproducible on every download (Edit 6).
//   - Only verified invoices (no 'processing') — AI prepares, human confirms.
//   - RAW BTW numbers only (turnover + BTW per rate, in/out separated). The
//     accountant computes the aangifte; we never compute vat_due.
//   - Every gap (missing PDF, missing bank statement) is a WARNING in the
//     overview, never a silent omission (Edit 5 / trust rule 6).
//
// Mirrors account-export.ts: a pure assemble (node-testable) + an orchestrator
// (fetch + parallel download, then assemble). Reuses quarterly.ts + export.ts.

import JSZip from "jszip";
// [CLOSING-PACKAGE-PAYDATE] pdf-lib stamps a small "Betaald op: DD-MM-YYYY" line
// on the first page of each PAID invoice. Mechanical text-draw at fixed
// coordinates — no content parsing, no AI. Requires `npm install pdf-lib`.
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PipelineClient } from "./supabase-pipeline";
import {
  quarterStartDate,
  quarterEndDate,
  buildQuarterlySummary,
  buildZzpSummary,
  type InvoiceForQuarterly,
} from "./quarterly";
import { calcBtwRate } from "./export";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Quarter = 1 | 2 | 3 | 4;

/** An invoice row as needed by the package (superset of InvoiceForQuarterly). */
export interface PackageInvoice {
  id: string;
  invoice_number: string | null;
  client_name: string | null;       // on incoming, this is the vendor
  status: string | null;
  direction: string;                 // 'outgoing' | 'incoming'
  total_ex_btw: number | null;
  btw_amount: number | null;
  total_inc_btw: number | null;
  invoice_date: string | null;
  due_date: string | null;
  pdf_url: string | null;            // outgoing PDF (FACTUUR-A)
  document_id: string | null;        // link to documents (incoming original)
  marked_paid_at: string | null;     // [CLOSING-PACKAGE-PAYDATE] fallback payment date (estimate)
  // [FIN-4] ownership — used to infer a NULL direction so a verified row is
  // never silently dropped from the package.
  sender_id: string | null;
  receiver_id: string | null;
}

/**
 * [CLOSING-PACKAGE-PAYDATE] Resolved payment date for one PAID invoice.
 *   - date      : ISO "YYYY-MM-DD" (or null if we genuinely have none).
 *   - estimated : false when it comes from a linked bank transaction (real
 *                 settlement date); true when it falls back to marked_paid_at
 *                 (the moment the human confirmed — an approximation).
 * `null` stays `null`: we never invent a date. Honest fallback (SAFECORE).
 */
export interface PaymentDateInfo {
  date: string | null;
  estimated: boolean;
}

/** A file already downloaded from Storage, ready to drop into the ZIP. */
export interface PackageFile {
  path: string;                      // storage path
  name: string;                      // display name
  bytes: Uint8Array;
}

export interface ClosingPackageWarning {
  code: string;                      // machine code
  message: string;                   // Dutch, human-readable
}

export interface ClosingPackageSummary {
  quarter: string;                   // "Q1 2026"
  outgoingCount: number;
  incomingCount: number;
  filesIncluded: number;
  bankStatementIncluded: boolean;
  warnings: ClosingPackageWarning[];
  generatedAt: string;               // ISO
}

export interface ClosingPackageResult {
  zipBytes: Buffer;
  summary: ClosingPackageSummary;
}

// Verified status sets (Phase A confirmed against the enum). 'processing'
// excluded — unverified must not reach the accountant.
const OUTGOING_VERIFIED = new Set(["sent", "paid", "overdue"]);
const INCOMING_VERIFIED = new Set(["received", "paid"]);

export function isVerifiedForPackage(inv: { direction: string; status: string | null }): boolean {
  const s = inv.status ?? "";
  if (inv.direction === "outgoing") return OUTGOING_VERIFIED.has(s);
  if (inv.direction === "incoming") return INCOMING_VERIFIED.has(s);
  return false;
}

/**
 * [FIN-4] Effective direction: the stored value, or — when it is null — inferred
 * from ownership (the owner is the receiver of an incoming invoice, the sender of
 * an outgoing one). Ensures a verified row with a null direction is attributed to
 * a bucket instead of being silently dropped from the package.
 */
export function effectiveDirection(
  inv: { direction: string | null; receiver_id: string | null },
  ownerId: string
): "incoming" | "outgoing" {
  if (inv.direction === "incoming" || inv.direction === "outgoing") return inv.direction;
  return inv.receiver_id === ownerId ? "incoming" : "outgoing";
}

// ─── Helpers (pure) ─────────────────────────────────────────────────────────────

const EUR = (n: number) => n.toFixed(2).replace(".", ",");
const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");

// ─── [CLOSING-PACKAGE-PAYDATE] Payment-date helpers ─────────────────────────────

/** ISO "YYYY-MM-DD" → Dutch "DD-MM-YYYY". Returns "" on malformed input. */
function formatNlDate(iso: string | null): string {
  if (!iso) return "";
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return "";
  const [y, m, d] = parts;
  return `${d}-${m}-${y}`;
}

/**
 * Stamp a "Betaald op: DD-MM-YYYY[ (geschat)]" line on the FIRST page in TWO
 * places — bottom-right and top-center — at 24pt. Positions are computed from
 * the actual text width (widthOfTextAtSize) so the label stays inside the page
 * regardless of page size or date length. Best-effort: any failure (encrypted
 * PDF, image-only scan wrapped oddly, parse error) returns the ORIGINAL bytes
 * unchanged so the invoice is still included — a stamp must never drop a
 * document. Pure-ish: takes bytes + a date, returns bytes. No I/O, no DB.
 */
async function stampPaymentDate(
  pdfBytes: Uint8Array,
  info: PaymentDateInfo
): Promise<Uint8Array> {
  if (!info.date) return pdfBytes; // nothing honest to write
  try {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pages = doc.getPages();
    if (pages.length === 0) return pdfBytes;
    const page = pages[0];
    const { width, height } = page.getSize();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const label = `Betaald op: ${formatNlDate(info.date)}${info.estimated ? " (geschat)" : ""}`;
    const color = rgb(0, 0, 0);          // black text
    const highlight = rgb(1, 1, 0);      // yellow background
    const margin = 24;

    // Target 24pt, but shrink to fit narrow pages (receipts, small scans) so the
    // label never overflows the page edge. Never below 8pt (still legible).
    const maxTextWidth = Math.max(1, width - 2 * margin);
    let size = 24;
    while (size > 8 && font.widthOfTextAtSize(label, size) > maxTextWidth) {
      size -= 1;
    }
    const textWidth = font.widthOfTextAtSize(label, size);
    const textHeight = font.heightAtSize(size);
    const pad = size * 0.15; // small padding around the text inside the highlight

    // Draw a yellow rectangle behind the text, then the black text on top —
    // pdf-lib has no native highlight, so we emulate it. drawText's y is the
    // baseline; the glyph box sits from (y - descender) up to (y + ascender),
    // so we pad around textHeight for a clean band.
    const drawStamp = (x: number, y: number) => {
      page.drawRectangle({
        x: x - pad,
        y: y - pad,
        width: textWidth + pad * 2,
        height: textHeight + pad * 2,
        color: highlight,
      });
      page.drawText(label, { x, y, size, font, color });
    };

    // Bottom-right: right edge minus text width, small bottom margin.
    drawStamp(Math.max(margin, width - textWidth - margin), margin + pad);

    // Top-center: horizontally centered, near the top edge.
    drawStamp(Math.max(margin, (width - textWidth) / 2), height - size - margin);

    return await doc.save();
  } catch {
    return pdfBytes; // include the original rather than fail the package
  }
}

/**
 * For a set of PAID invoices, resolve each one's payment date in ONE query.
 * Priority: linked bank transaction date (real) → marked_paid_at (estimate) →
 * null (honest — never invented). A bank transaction is considered linked when
 * its invoice_id points at the invoice, REGARDLESS of the transaction's own
 * status: even a partially-linked multi-invoice transaction (status still
 * 'pending') carries a genuine settlement date. When several transactions link
 * the same invoice (rare), the latest date wins.
 */
async function resolvePaymentDates(
  supabase: PipelineClient,
  paidInvoices: PackageInvoice[]
): Promise<Map<string, PaymentDateInfo>> {
  const result = new Map<string, PaymentDateInfo>();
  const ids = paidInvoices.map((i) => i.id);
  if (ids.length === 0) return result;

  const { data: txRows } = await supabase
    .from("bank_transactions")
    .select("invoice_id, date")
    .in("invoice_id", ids);

  const bankDateByInvoice = new Map<string, string>();
  for (const row of (txRows ?? []) as Array<{ invoice_id: string | null; date: string | null }>) {
    if (!row.invoice_id || !row.date) continue;
    const prev = bankDateByInvoice.get(row.invoice_id);
    // Keep the latest linked transaction date if an invoice has more than one.
    if (!prev || row.date > prev) bankDateByInvoice.set(row.invoice_id, row.date);
  }

  for (const inv of paidInvoices) {
    const bankDate = bankDateByInvoice.get(inv.id);
    if (bankDate) {
      result.set(inv.id, { date: bankDate.slice(0, 10), estimated: false });
    } else if (inv.marked_paid_at) {
      result.set(inv.id, { date: inv.marked_paid_at.slice(0, 10), estimated: true });
    } else {
      result.set(inv.id, { date: null, estimated: true });
    }
  }
  return result;
}

/** CSV cell escaper (semicolon-separated, Excel NL). */
function esc(v: string | number): string {
  const s = String(v ?? "");
  return s.includes(";") || s.includes("\n") || s.includes('"')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/** Map a PackageInvoice to the quarterly lib's shape (computes btw_rate). */
function toQuarterly(inv: PackageInvoice): InvoiceForQuarterly {
  return {
    id: inv.id,
    invoice_number: inv.invoice_number,
    client_name: inv.client_name,
    status: inv.status,
    direction: inv.direction,
    total_ex_btw: inv.total_ex_btw,
    btw_amount: inv.btw_amount,
    total_inc_btw: inv.total_inc_btw,
    btw_rate: calcBtwRate(inv.btw_amount, inv.total_ex_btw),
    invoice_date: inv.invoice_date,
    due_date: inv.due_date ?? undefined,
  };
}

/** Build the inhoudslijst + RAW BTW overview CSV. */
export function buildOverviewCsv(
  quarterLabel: string,
  outgoing: PackageInvoice[],
  incoming: PackageInvoice[],
  warnings: ClosingPackageWarning[],
  paymentDates: Map<string, PaymentDateInfo>
): string {
  const lines: string[] = [];

  lines.push(`BoekBrug — Kwartaaloverzicht ${quarterLabel}`);
  lines.push("");

  // ── RAW BTW overview, per rate, in/out separated (NO vat_due) ──
  lines.push("BTW-overzicht (ruwe cijfers — de boekhouder berekent de aangifte)");
  lines.push(["Richting", "Tarief", "Omzet excl. BTW", "BTW-bedrag"].map(esc).join(";"));

  for (const [label, set] of [["Uitgaand (verkoop)", outgoing], ["Inkomend (inkoop)", incoming]] as const) {
    const byRate = new Map<number, { excl: number; btw: number }>();
    for (const inv of set) {
      const rate = calcBtwRate(inv.btw_amount, inv.total_ex_btw);
      const cur = byRate.get(rate) ?? { excl: 0, btw: 0 };
      cur.excl += inv.total_ex_btw ?? 0;
      cur.btw += inv.btw_amount ?? 0;
      byRate.set(rate, cur);
    }
    // [BTW-RATE-GUARD] Print the standard NL rates first (21/9/0), then ANY
    // other rate present — e.g. a blended rate from a mixed-rate invoice whose
    // btw_amount/total_ex_btw derive to something like 17%. Previously the loop
    // only printed [21,9,0], so such an invoice's turnover + BTW vanished from
    // this overview (a silent omission). Now an unexpected % row surfaces it so
    // the accountant checks the source invoice instead of the amount being lost.
    const knownRates = [21, 9, 0];
    const otherRates = [...byRate.keys()]
      .filter((r) => !knownRates.includes(r))
      .sort((a, b) => b - a);
    for (const rate of [...knownRates, ...otherRates]) {
      const v = byRate.get(rate);
      if (v && (v.excl !== 0 || v.btw !== 0)) {
        lines.push([label, `${rate}%`, EUR(v.excl), EUR(v.btw)].map(esc).join(";"));
      }
    }
  }
  lines.push("");

  // ── Content list ──
  lines.push("Inhoud van dit pakket");
  lines.push(["Richting", "Factuurnummer", "Naam", "Datum factuur", "Datum betaling", "Bedrag incl. BTW", "Status"].map(esc).join(";"));
  for (const inv of [...outgoing, ...incoming]) {
    const pay = paymentDates.get(inv.id);
    const payCell =
      inv.status === "paid" && pay?.date
        ? `${formatNlDate(pay.date)}${pay.estimated ? " (geschat)" : ""}`
        : "—";
    lines.push([
      inv.direction === "outgoing" ? "Uitgaand" : "Inkomend",
      inv.invoice_number ?? "—",
      inv.client_name ?? "—",
      inv.invoice_date ?? "—",
      payCell,
      EUR(inv.total_inc_btw ?? 0),
      inv.status ?? "—",
    ].map(esc).join(";"));
  }
  lines.push("");

  // ── Warnings (honest about gaps) ──
  if (warnings.length > 0) {
    lines.push("Let op — ontbrekende of onvolledige onderdelen");
    for (const w of warnings) lines.push(esc(w.message));
  } else {
    lines.push("Geen ontbrekende onderdelen gedetecteerd.");
  }

  return lines.join("\r\n");
}

// ─── Assembly (no network — fully node-testable) ────────────────────────────────

interface AssembleInput {
  year: number;
  quarter: Quarter;
  clientName: string;
  outgoing: PackageInvoice[];
  incoming: PackageInvoice[];
  /** invoiceId → downloaded PDF (outgoing via pdf_url, incoming via documents) */
  pdfByInvoice: Map<string, PackageFile>;
  /** the bank statement file(s) for the quarter (passthrough), if any */
  bankFiles: PackageFile[];
  /** optional kilometer registration files the owner uploaded */
  kilometerFiles: PackageFile[];
  /** [BRUG-FILES-SHARED] general docs the owner explicitly shared for this quarter
   *  (kassa-reports, contracts, etc.) — shared=true, tied to the quarter via period.
   *  Not invoices and not bank statements; passthrough into overige-documenten/. */
  sharedFiles: PackageFile[];
  /** [CLOSING-PACKAGE-PAYDATE] invoiceId → resolved payment date, for PAID
   *  invoices only. Drives the stamp, the date-prefixed filename, and the
   *  betaald/ vs openstaand/ split. Absent id → treated as no payment date. */
  paymentDates: Map<string, PaymentDateInfo>;
  /** [BANK-COVERAGE] true when bank_transactions exist for this quarter — the
   *  honest "do we have bank data" signal (statement files upload after the
   *  quarter closes, so their presence alone under-reports coverage). */
  hasBankData: boolean;
  warnings: ClosingPackageWarning[];
}

export async function assembleClosingPackageZip(input: AssembleInput): Promise<ClosingPackageResult> {
  const { year, quarter, clientName, outgoing, incoming, pdfByInvoice, bankFiles, kilometerFiles, sharedFiles, paymentDates, hasBankData } = input;
  const warnings = [...input.warnings];
  const quarterLabel = `Q${quarter} ${year}`;
  const zip = new JSZip();

  let filesIncluded = 0;

  // ── facturen-en-bonnen/{uitgaand,inkomend}/{betaald,openstaand}/ ──
  // [CLOSING-PACKAGE-PAYDATE] Split each direction into paid vs open:
  //   - betaald/    → PAID invoices, sorted by INVOICE date (tax period is set by
  //                   invoice_date under factuurstelsel — payment date never moves
  //                   an invoice to another quarter), filename PREFIXED with the
  //                   invoice date, and the PAYMENT date STAMPED on page 1.
  //   - openstaand/ → not-yet-paid invoices (sent/overdue/received), sorted by
  //                   due_date, NO stamp (there is no payment to record).
  // A verified invoice with no stored PDF stays an honest warning, as before.
  const sections: Array<{
    dir: "uitgaand" | "inkomend";
    bucket: "betaald" | "openstaand";
    set: PackageInvoice[];
  }> = [
    { dir: "uitgaand", bucket: "betaald", set: outgoing.filter((i) => i.status === "paid") },
    { dir: "uitgaand", bucket: "openstaand", set: outgoing.filter((i) => i.status !== "paid") },
    { dir: "inkomend", bucket: "betaald", set: incoming.filter((i) => i.status === "paid") },
    { dir: "inkomend", bucket: "openstaand", set: incoming.filter((i) => i.status !== "paid") },
  ];

  for (const { dir, bucket, set } of sections) {
    // Sort: betaald by invoice_date (tax order), openstaand by due_date.
    const sortKey = (inv: PackageInvoice) =>
      (bucket === "betaald" ? inv.invoice_date : inv.due_date) ?? "9999-99-99";
    const ordered = [...set].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    for (const inv of ordered) {
      const file = pdfByInvoice.get(inv.id);
      const datePrefix = (inv.invoice_date ?? "0000-00-00").slice(0, 10);
      const baseName = `${datePrefix}_${safe(inv.client_name ?? "onbekend")}_${safe(inv.invoice_number ?? inv.id)}`;

      if (!file) {
        // Honest gap: a verified invoice with no stored PDF (outgoing render
        // failed / pre-FACTUUR-A, or incoming without a linked document).
        warnings.push({
          code: "pdf_missing",
          message: `Factuur ${inv.invoice_number ?? inv.id} (${dir}) — origineel PDF niet gevonden, niet bijgevoegd.`,
        });
        continue;
      }

      let bytes = file.bytes;
      if (bucket === "betaald") {
        const info = paymentDates.get(inv.id);
        if (info && info.date) {
          bytes = await stampPaymentDate(bytes, info);
        } else {
          // Paid but no resolvable payment date — include unstamped, warn.
          warnings.push({
            code: "payment_date_missing",
            message: `Factuur ${inv.invoice_number ?? inv.id} is betaald maar heeft geen betaaldatum — bijgevoegd zonder stempel.`,
          });
        }
      }

      zip.file(`facturen-en-bonnen/${dir}/${bucket}/${baseName}.pdf`, bytes);
      filesIncluded++;
    }
  }

  // ── bankafschrift/ (passthrough) ──
  for (const bf of bankFiles) {
    zip.file(`bankafschrift/${safe(bf.name)}`, bf.bytes);
    filesIncluded++;
  }
  // [BANK-COVERAGE] Distinguish "no bank data at all" from "data present but the
  // original file wasn't attached". The old code warned on bankFiles.length===0,
  // which fired on nearly every package: the statement is uploaded AFTER the
  // quarter closes, so it was rarely matched — a false "missing" that trained
  // the accountant to ignore warnings. hasBankData (transactions dated in the
  // quarter) is the real coverage signal.
  if (!hasBankData) {
    warnings.push({
      code: "bank_missing",
      message: "Geen banktransacties of bankafschrift gevonden voor dit kwartaal — upload het bankafschrift zodat het wordt meegeleverd.",
    });
  } else if (bankFiles.length === 0) {
    warnings.push({
      code: "bank_file_missing",
      message: "Banktransacties zijn aanwezig, maar het originele bankafschrift-bestand kon niet automatisch worden bijgevoegd.",
    });
  }

  // ── kilometers/ (optional — not a BoekBrug feature; passthrough if present) ──
  // No "missing" warning: BoekBrug doesn't track kilometer registration and it
  // only applies to owners who drive a business car, so an unconditional warning
  // fired on 100% of packages — pure noise that trained the accountant to ignore
  // warnings. When a real kilometer feature exists, add a conditional warning
  // that fires only when it actually applies. Passthrough hook kept for that day.
  for (const kf of kilometerFiles) {
    zip.file(`kilometers/${safe(kf.name)}`, kf.bytes);
    filesIncluded++;
  }

  // ── overige-documenten/ ([BRUG-FILES-SHARED] owner-shared general docs) ──
  // Files the owner explicitly shared for this quarter that are not invoices or
  // bank statements (e.g. kassa-reports). Passthrough, no AI, included raw.
  for (const sf of sharedFiles) {
    zip.file(`overige-documenten/${safe(sf.name)}`, sf.bytes);
    filesIncluded++;
  }

  // ── overzicht.csv + overzicht.json ──
  const overviewCsv = buildOverviewCsv(quarterLabel, outgoing, incoming, warnings, paymentDates);
  zip.file("overzicht.csv", "\uFEFF" + overviewCsv);

  // RAW summary numbers (reuse quarterly lib — same logic the owner sees).
  const allQuarterly = [...outgoing, ...incoming].map(toQuarterly);
  const fullSummary = buildQuarterlySummary(allQuarterly, year, quarter);
  const zzpSummary = buildZzpSummary(allQuarterly, year, quarter, "all");

  const summary: ClosingPackageSummary = {
    quarter: quarterLabel,
    outgoingCount: outgoing.length,
    incomingCount: incoming.length,
    filesIncluded,
    bankStatementIncluded: bankFiles.length > 0,
    warnings,
    generatedAt: new Date().toISOString(),
  };

  zip.file(
    "overzicht.json",
    JSON.stringify(
      {
        beschrijving: `BoekBrug kwartaalpakket ${quarterLabel} voor ${clientName}`,
        kwartaal: quarterLabel,
        gegenereerd_op: summary.generatedAt,
        uitgaand_aantal: outgoing.length,
        inkomend_aantal: incoming.length,
        bestanden_bijgevoegd: filesIncluded,
        bankafschrift_bijgevoegd: summary.bankStatementIncluded,
        // RAW numbers only — accountant computes the aangifte.
        btw_overzicht: {
          omzet_per_tarief: fullSummary.btwBreakdown,
          uitgaand_incl: zzpSummary.totalIn,
          inkomend_incl: zzpSummary.totalOut,
          btw_uitgaand: zzpSummary.totalBtwIn,
          btw_inkomend: zzpSummary.totalBtwOut,
        },
        waarschuwingen: warnings,
      },
      null,
      2
    )
  );

  const zipBytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { zipBytes, summary };
}

// ─── Orchestrator (fetch + parallel download, then assemble) ────────────────────

const INVOICE_FIELDS =
  "id, invoice_number, client_name, status, direction, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date, pdf_url, document_id, marked_paid_at, sender_id, receiver_id" as const;

/**
 * [BRIDGE-HUB Overzicht] Lightweight summary of a client's quarter — WITHOUT
 * downloading any file or building the ZIP. Used by the Brug "Overzicht" tab to
 * answer the accountant's real question ("is this quarter ready to close?")
 * before they download. Same fetch + verify logic as buildClosingPackageZip,
 * but it only checks whether evidence EXISTS (paths present), never fetches it.
 *
 * Honest by construction: counts come from verified invoices only; warnings are
 * the real gaps (an invoice with no PDF path, no bank statement). No invented
 * completeness score, no facturen-vs-bonnen split we don't track.
 */
export async function summarizeClosingPackage(args: {
  ownerId: string;
  year: number;
  quarter: Quarter;
  supabase: PipelineClient;
}): Promise<ClosingPackageSummary> {
  const { ownerId, year, quarter, supabase } = args;
  const start = quarterStartDate(year, quarter);
  const end = quarterEndDate(year, quarter);
  const warnings: ClosingPackageWarning[] = [];

  const { data: invData, error: invErr } = await supabase
    .from("invoices")
    .select(INVOICE_FIELDS)
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .neq("status", "archived");
  if (invErr) throw new Error(`[CLOSING-PACKAGE] summary query failed: ${invErr.message}`);

  // [FIN-4] Never silently drop a verified row with a NULL direction: infer it
  // from ownership (mirrors the quarterly route). Previously isVerifiedForPackage
  // returned false on a null direction, so such an invoice vanished from the
  // package while it still counted on the accountant's screen.
  const all = (invData ?? []).map((raw) => {
    const row = raw as unknown as PackageInvoice;
    return { ...row, direction: effectiveDirection(row, ownerId) };
  });
  const verified = all.filter(isVerifiedForPackage);
  const outgoing = verified.filter((i) => i.direction === "outgoing");
  const incoming = verified.filter((i) => i.direction === "incoming");

  // Count how many verified invoices actually have a retrievable PDF path.
  // outgoing → pdf_url ; incoming → document_id (resolved to a file_url).
  let withPdf = 0;
  const missingPdf: string[] = [];

  for (const inv of outgoing) {
    if (inv.pdf_url) withPdf++;
    else missingPdf.push(inv.invoice_number ?? inv.id);
  }

  const incomingDocIds = incoming.map((i) => i.document_id).filter((x): x is string => !!x);
  let docUrlById = new Map<string, boolean>();
  if (incomingDocIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, file_url")
      .in("id", incomingDocIds);
    const rows = (docs ?? []) as unknown as Array<{ id: string; file_url: string | null }>;
    docUrlById = new Map(rows.map((d) => [d.id, !!d.file_url]));
  }
  for (const inv of incoming) {
    const has = inv.document_id ? docUrlById.get(inv.document_id) === true : false;
    if (has) withPdf++;
    else missingPdf.push(inv.invoice_number ?? inv.id);
  }

  // [BANK-COVERAGE] "Do we have bank data for this quarter?" is answered by the
  // bank TRANSACTIONS dated in the quarter — NOT the statement file's upload
  // time. A Q1 statement is uploaded in Q2 (after the quarter closes), so the
  // old created_at filter almost always missed it and falsely reported "geen
  // bankafschrift" in the readiness panel. Parsed transactions are the honest
  // coverage signal.
  const { data: bankTx } = await supabase
    .from("bank_transactions")
    .select("id")
    .eq("user_id", ownerId)
    .gte("date", start)
    .lte("date", end)
    .limit(1);
  const bankStatementIncluded = (bankTx ?? []).length > 0;

  // Honest warnings — the real gaps, listed specifically.
  if (verified.length === 0) {
    warnings.push({ code: "no_invoices", message: "Geen geverifieerde facturen in dit kwartaal." });
  }
  if (missingPdf.length > 0) {
    warnings.push({
      code: "missing_pdf",
      message:
        missingPdf.length === 1
          ? `1 factuur zonder PDF (${missingPdf[0]}).`
          : `${missingPdf.length} facturen zonder PDF.`,
    });
  }
  if (!bankStatementIncluded) {
    warnings.push({ code: "no_bank_statement", message: "Geen banktransacties gevonden voor dit kwartaal — upload het bankafschrift." });
  }

  return {
    quarter: `Q${quarter} ${year}`,
    outgoingCount: outgoing.length,
    incomingCount: incoming.length,
    filesIncluded: withPdf,
    bankStatementIncluded,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildClosingPackageZip(args: {
  ownerId: string;
  year: number;
  quarter: Quarter;
  supabase: PipelineClient;
}): Promise<ClosingPackageResult> {
  const { ownerId, year, quarter, supabase } = args;
  const start = quarterStartDate(year, quarter);
  const end = quarterEndDate(year, quarter);
  const warnings: ClosingPackageWarning[] = [];

  let clientName = "Onbekend";
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_name, full_name")
    .eq("id", ownerId)
    .maybeSingle();
  if (profile) clientName = profile.company_name || profile.full_name || "Onbekend";

  // Invoices of the quarter (both directions). Filter on STORED status only
  // (verified sets), within the quarter date range.
  const { data: invData, error: invErr } = await supabase
    .from("invoices")
    .select(INVOICE_FIELDS)
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .neq("status", "archived");
  if (invErr) throw new Error(`[CLOSING-PACKAGE] invoices query failed: ${invErr.message}`);

  // [FIN-4] Never silently drop a verified row with a NULL direction: infer it
  // from ownership (mirrors the quarterly route). Previously isVerifiedForPackage
  // returned false on a null direction, so such an invoice vanished from the
  // package while it still counted on the accountant's screen.
  const all = (invData ?? []).map((raw) => {
    const row = raw as unknown as PackageInvoice;
    return { ...row, direction: effectiveDirection(row, ownerId) };
  });
  const verified = all.filter(isVerifiedForPackage);
  const outgoing = verified.filter((i) => i.direction === "outgoing");
  const incoming = verified.filter((i) => i.direction === "incoming");

  // ── Resolve PDF storage paths ──
  // outgoing → invoices.pdf_url ; incoming → documents.file_url via document_id.
  const pathByInvoice = new Map<string, { path: string; name: string }>();

  for (const inv of outgoing) {
    if (inv.pdf_url) {
      pathByInvoice.set(inv.id, { path: inv.pdf_url, name: `${inv.invoice_number ?? inv.id}.pdf` });
    }
  }

  const incomingDocIds = incoming.map((i) => i.document_id).filter((x): x is string => !!x);
  if (incomingDocIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, file_url, file_name")
      .in("id", incomingDocIds);
    const docRows = (docs ?? []) as unknown as Array<{
      id: string;
      file_url: string | null;
      file_name: string | null;
    }>;
    const docById = new Map(docRows.map((d) => [d.id, d]));
    for (const inv of incoming) {
      const d = inv.document_id ? docById.get(inv.document_id) : null;
      if (d?.file_url) {
        pathByInvoice.set(inv.id, { path: d.file_url, name: d.file_name ?? `${inv.invoice_number ?? inv.id}` });
      }
    }
  }

  // ── Bank statement(s) for the quarter (doc_type='bankafschrift') ──
  // [FIN-10] Select the statement FILE by its coverage PERIOD (tagged at upload
  // from the transaction date range), not by upload time: a Q1 statement is
  // uploaded in Q2, so the old created_at window missed it and the ZIP shipped
  // without the statement the accountant needs. Two simple queries — statements
  // tagged for this quarter, plus a legacy fallback (period NULL → the old
  // created_at window, so pre-tagging uploads still surface) — merged + de-duped.
  const stmtPeriod = `${year}-Q${quarter}`;
  const [{ data: taggedStmts }, { data: legacyStmts }] = await Promise.all([
    supabase
      .from("documents")
      .select("file_url, file_name")
      .eq("user_id", ownerId)
      .eq("doc_type", "bankafschrift")
      .eq("period", stmtPeriod),
    supabase
      .from("documents")
      .select("file_url, file_name")
      .eq("user_id", ownerId)
      .eq("doc_type", "bankafschrift")
      .is("period", null)
      .gte("created_at", start)
      .lte("created_at", `${end}T23:59:59`),
  ]);
  const bankRows = [...(taggedStmts ?? []), ...(legacyStmts ?? [])] as unknown as Array<{
    file_url: string | null;
    file_name: string | null;
  }>;
  const bankPaths: Array<{ path: string; name: string }> = [];
  const seenBankPath = new Set<string>();
  for (const d of bankRows) {
    if (!d.file_url || seenBankPath.has(d.file_url)) continue;
    seenBankPath.add(d.file_url);
    bankPaths.push({ path: d.file_url, name: d.file_name ?? "bankafschrift" });
  }

  // ── Download everything in parallel; a failed file → warning, not a crash ──
  async function dl(path: string, name: string): Promise<PackageFile | null> {
    try {
      const { data, error } = await supabase.storage.from("documents").download(path);
      if (error || !data) return null;
      const bytes = new Uint8Array(await data.arrayBuffer());
      return { path, name, bytes };
    } catch {
      return null;
    }
  }

  const pdfEntries = await Promise.all(
    [...pathByInvoice.entries()].map(async ([invId, p]) => {
      const f = await dl(p.path, p.name);
      return [invId, f] as const;
    })
  );
  const pdfByInvoice = new Map<string, PackageFile>();
  for (const [invId, f] of pdfEntries) {
    if (f) pdfByInvoice.set(invId, f);
  }

  const bankFilesRaw = await Promise.all(bankPaths.map((p) => dl(p.path, p.name)));
  const bankFiles = bankFilesRaw.filter((f): f is PackageFile => f !== null);

  // [BANK-COVERAGE] Real coverage signal: bank transactions DATED in the quarter,
  // not the statement file's upload time. Statements are uploaded after the
  // quarter closes (aangifte deadline is the month after), so a created_at-based
  // check falsely reported "geen bankafschrift" on almost every package.
  const { data: bankTxRows } = await supabase
    .from("bank_transactions")
    .select("id")
    .eq("user_id", ownerId)
    .gte("date", start)
    .lte("date", end)
    .limit(1);
  const hasBankData = (bankTxRows ?? []).length > 0;

  // ── [BRUG-FILES-SHARED] Owner-shared general docs for this quarter ──
  // shared=true (the field the accountant RLS reads), tied to the quarter via
  // period='{year}-Q{n}'. Exclude invoices (invoice_id set) and bank statements
  // (doc_type='bankafschrift') — those already have their own ZIP sections.
  const sharedPeriod = `${year}-Q${quarter}`;
  const { data: sharedDocs } = await supabase
    .from("documents")
    .select("file_url, file_name, doc_type, invoice_id")
    .eq("user_id", ownerId)
    .eq("shared", true)
    .eq("period", sharedPeriod)
    .eq("trashed", false)
    .is("invoice_id", null);
  const sharedRows = (sharedDocs ?? []) as unknown as Array<{
    file_url: string | null;
    file_name: string | null;
    doc_type: string | null;
    invoice_id: string | null;
  }>;
  const sharedPaths = sharedRows
    .filter((d) => !!d.file_url && d.doc_type !== "bankafschrift")
    .map((d) => ({ path: d.file_url as string, name: d.file_name ?? "document" }));
  const sharedFilesRaw = await Promise.all(sharedPaths.map((p) => dl(p.path, p.name)));
  const sharedFiles = sharedFilesRaw.filter((f): f is PackageFile => f !== null);

  // ── [CLOSING-PACKAGE-PAYDATE] Resolve payment dates for PAID invoices (one query) ──
  const paidInvoices = [...outgoing, ...incoming].filter((i) => i.status === "paid");
  const paymentDates = await resolvePaymentDates(supabase, paidInvoices);

  return assembleClosingPackageZip({
    year,
    quarter,
    clientName,
    outgoing,
    incoming,
    pdfByInvoice,
    bankFiles,
    kilometerFiles: [], // not a feature yet; passthrough hook reserved
    sharedFiles,
    paymentDates,
    hasBankData,
    warnings,
  });
}