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
// [SEC-STORAGE-PATH] A row check is not a path check — see the header of storage-path.ts.
import { toStoragePath, pathBelongsToOwner } from "./storage-path";
// [SLUIS] The content sniff that decides whether an .xml really is an invoice — see the block
// that uses it in the orchestrator below.
import { looksLikeInvoiceXmlBytes } from "./e-invoice";
import {
  quarterStartDate,
  quarterEndDate,
  buildQuarterlySummary,
  buildZzpSummary,
  type InvoiceForQuarterly,
} from "./quarterly";
import { calcBtwRate } from "./export";
import { csvCell } from "./csv-safe";
import { formatEuroNL } from "./format-nl";
import { buildTurnoverClosing, type TurnoverClosing } from "./turnover-closing";
import { turnoverNetOmzet, type DailyTurnover } from "./turnover";
import { reconcileTriangle, bankNetByDay, buildCardReconciliationCsv, type TriangleResult } from "./triangle";
// [KAS-ZACHT] A removed cash movement counts in no total — one definition, see cash-live.ts.
import { liveCashEntries } from "./cash-live";
import { buildKasboek, openingBalanceForQuarter, kasboekToMatrix, removedInQuarter, type KasEntry, type KasTurnoverDay, type RemovedKasEntry, type Quarter as KasQuarter } from "./kasboek";
import { matrixToXlsxBytes } from "./xlsx-adapter";
import type { EftSettlement } from "./eft-parser";
import {
  computeResult,
  toResultBankTx,
  cardBudgetBound,
  type ResultInvoice,
  type ResultCashEntry,
  type ResultBankTx,
} from "./financial-result";
import {
  buildAangifte,
  buildAangifteCsv,
  type ConceptAangifte,
  type AangifteCompleteness,
  privegebruikNote,
} from "./aangifte";
// [ICP] Rubriek 3b + the separate ICP-opgaaf, keyed on the customers' EU VAT numbers.
import {
  buildIcp, buildIcpCsv, icpNote, buildForeignPurchases, buildForeignPurchaseCsv, foreignPurchaseNote,
  type IcpInvoice, type IcpResult, type ForeignPurchaseResult,
} from "./icp";
import { fetchAllRows, fetchAllRowsForIds } from "./supabase-paginate";
// [PACKAGE-ART29] Both sides of art. 29 Wet OB — see the call site for why they belong here.
import { collectBadDebt, collectVatClawback } from "./bad-debt-collect";
import { BAD_DEBT_MIN_EUR } from "./bad-debt";
import { collectRegimeFlags, type RegimeInvoiceRef } from "./regime-collect";
import { regimeFlagNote } from "./regime-flags";
import { resolveSchemeSettlements, mergeSchemeOpts } from "./kas-payment-events-fetch";
// [RUBRIEK-SPLIT] Omzet per BTW rate from the invoice's own lines — the same helper the aangifte
// and the result engine use, so the accountant's package cannot show different rubrieken.
import { fetchRateShares } from "./btw-rate-split-fetch";
import { collectVatExemption } from "./vat-exemption-collect";
import { exemptShareOf } from "./vat-exemption";
import { round2 } from "./invoice-totals";

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
  client_btw_number: string | null;  // [AANGIFTE] EU-VAT signal for rubriek 4b (not auto-computed)
  marked_paid_at: string | null;     // [CLOSING-PACKAGE-PAYDATE] fallback payment date (estimate)
  // [HERTIKKEN] factuur | creditnota. Zonder deze kolom is een creditnota in de inhoudslijst
  // alleen aan een minteken te herkennen, en dat is precies het soort verschil waar een
  // boekhouder een half uur aan kwijt is als hij het pas bij het inboeken ontdekt.
  invoice_type: string | null;
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
  filesIncluded: number;             // total files in the ZIP (invoices-with-PDF + bank + shared)
  // [READINESS-EVIDENCE] How many INVOICES carry a source document (PDF). This is the ONLY
  // invoice-evidence count; filesIncluded also folds in bank-statement + shared files and must
  // NEVER be read as an invoice-evidence signal (that inflated readiness to a false 100%).
  invoicesWithPdf: number;
  // [EVIDENCE] WELKE facturen de PDF missen — de nummers, niet alleen het aantal. Werd
  // hierboven al berekend en daarna weggegooid; een telling stuurt de score, maar alleen
  // de lijst maakt er een handeling van ("Zonder PDF: F-2026-014, F-2026-021").
  // Begrensd op 50 namen: daarboven is het geen zin meer maar een muur tekst, en de
  // telling in invoicesWithPdf blijft hoe dan ook exact.
  missingEvidence: string[];
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
): Promise<{ dates: Map<string, PaymentDateInfo>; complete: boolean }> {
  const result = new Map<string, PaymentDateInfo>();
  const ids = paidInvoices.map((i) => i.id);
  if (ids.length === 0) return { dates: result, complete: true };

  // [PAYDATE-READ-HONEST] This was `.in("invoice_id", ids)` in one unchunked, unpaged query with
  // its error discarded — the exact shape supabase-paginate.ts was written to replace, and it says
  // why: an id list travels in the URL at ~39 bytes per uuid, so a few hundred paid invoices
  // outgrow the proxy's header buffer and the call dies with a 414; and the response is capped at
  // ~1000 rows regardless. supabase-js reports both as an ordinary `error`, never an exception, so
  // a caller reading only `data` sees "no transactions" and carries on.
  //
  // What that silence did here is the opposite of this function's own promise. Every paid invoice
  // fell back to marked_paid_at — an ESTIMATE — or to nothing, across the whole package, and the
  // accountant received estimated payment dates where real bank dates existed. On kasstelsel the
  // payment date decides the quarter, so that is not a cosmetic downgrade.
  //
  // fetchAllRowsForIds chunks the list AND pages each chunk AND throws, so this is now all rows or
  // a stated failure. The failure still does not sink the package — the dates degrade exactly as
  // before — but it stops being invisible: `complete: false` becomes a warning in overzicht.csv.
  let txRows: Array<{ invoice_id: string | null; date: string | null }> = [];
  let complete = true;
  try {
    txRows = await fetchAllRowsForIds<{ invoice_id: string | null; date: string | null }, string>(
      ids,
      (chunk, from, to) =>
        supabase
          .from("bank_transactions")
          .select("invoice_id, date")
          .in("invoice_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
    );
  } catch (e) {
    console.error("[PAYDATE-READ-HONEST] bank payment-date read failed — dates degrade to estimates, and the package says so", {
      invoiceCount: ids.length,
      error: e instanceof Error ? e.message : String(e),
    });
    complete = false;
  }

  const bankDateByInvoice = new Map<string, string>();
  for (const row of txRows) {
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
  return { dates: result, complete };
}

/** CSV cell escaper (semicolon-separated, Excel NL). Delegates to the shared csvCell so a
 *  vendor-controlled cell (e.g. an AI-extracted supplier name '=HYPERLINK(...)') is
 *  formula-injection-neutralised before it reaches the accountant's Excel — not just RFC-quoted. */
function esc(v: string | number): string {
  return csvCell(v);
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
  // [HERTIKKEN] De bedragen erbij die BoekBrug al heeft uitgelezen.
  //
  // Deze lijst droeg alleen het totaal incl. btw. De boekhouder moest daardoor 60 facturen
  // openen en het bedrag exclusief, het btw-bedrag en het tarief met de hand overtikken —
  // precies de cijfers die de AI bij binnenkomst al van de bon heeft gelezen. Zijn echte
  // knelpunt is niet het ONTVANGEN van de stukken, het is het INTIKKEN ervan.
  //
  // Bewust in DEZE ene lijst en niet als tweede CSV ernaast: één bestand dat compleet is,
  // leest beter dan twee bestanden waarvan je moet raden welke je nodig hebt.
  //
  // 'Type' scheidt een creditnota van een factuur — die was tot nu toe alleen aan een
  // minteken te herkennen.
  lines.push(["Richting", "Type", "Factuurnummer", "Naam", "Datum factuur", "Datum betaling", "Bedrag excl. BTW", "BTW bedrag", "BTW tarief %", "Bedrag incl. BTW", "Status"].map(esc).join(";"));
  for (const inv of [...outgoing, ...incoming]) {
    const pay = paymentDates.get(inv.id);
    const payCell =
      inv.status === "paid" && pay?.date
        ? `${formatNlDate(pay.date)}${pay.estimated ? " (geschat)" : ""}`
        : "—";
    const rate = calcBtwRate(inv.btw_amount, inv.total_ex_btw);
    lines.push([
      inv.direction === "outgoing" ? "Uitgaand" : "Inkomend",
      inv.invoice_type ?? "factuur",
      inv.invoice_number ?? "—",
      inv.client_name ?? "—",
      inv.invoice_date ?? "—",
      payCell,
      EUR(inv.total_ex_btw ?? 0),
      EUR(inv.btw_amount ?? 0),
      rate === null ? "—" : String(rate),
      // [TRUST-NUMBER] Show the real total: fall back to excl + BTW when total_inc_btw
      // wasn't stored, so an invoice that carries real amounts doesn't print €0,00 next
      // to a non-zero BTW-overzicht (a contradiction the accountant would trip over).
      EUR(inv.total_inc_btw ?? ((inv.total_ex_btw ?? 0) + (inv.btw_amount ?? 0))),
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

/** [TURNOVER-CLOSING] The retail till turnover CSV: per-rate summary, per-day payment
 *  reconciliation, and the exceptions list. RAW numbers only — the accountant computes
 *  the aangifte; we only hand over the reconciled evidence and flag what doesn't tie. */
export function buildTurnoverCsv(quarterLabel: string, tc: TurnoverClosing): string {
  const L: string[] = [];
  L.push(`BoekBrug — Dagomzet (kassa) ${quarterLabel}`);
  L.push("");

  L.push("Samenvatting per BTW-tarief (ruwe cijfers — de boekhouder berekent de aangifte)");
  L.push(["Tarief", "Omzet excl. BTW", "BTW"].map(esc).join(";"));
  for (const r of tc.summary.perRate) {
    if (r.net !== 0 || r.btw !== 0) L.push([`${r.rate}%`, EUR(r.net), EUR(r.btw)].map(esc).join(";"));
  }
  L.push(["Totaal", EUR(tc.summary.totalNet), EUR(tc.summary.totalBtw)].map(esc).join(";"));
  L.push(["Totaal incl. BTW", "", EUR(tc.summary.totalIncl)].map(esc).join(";"));
  L.push(["Betaald met PIN", EUR(tc.summary.totalPin), ""].map(esc).join(";"));
  L.push(["Betaald contant", EUR(tc.summary.totalCash), ""].map(esc).join(";"));
  L.push("");

  L.push("Betaalreconciliatie (kassa vs bank vs kasboek)");
  L.push(["Datum", "PIN kassa", "PIN bank", "Verschil", "Contant kassa", "Contant geteld", "Verschil"].map(esc).join(";"));
  for (const d of tc.reconciliation) {
    L.push([d.date, EUR(d.pinExpected), EUR(d.pinSettled), EUR(d.pinDiff), EUR(d.cashExpected), EUR(d.cashCounted), EUR(d.cashDiff)].map(esc).join(";"));
  }
  L.push("");

  if (tc.exceptions.length > 0) {
    L.push("Uitzonderingen — dagen die niet aansluiten (controleer deze)");
    L.push(["Datum", "Soort", "Toelichting", "Verschil"].map(esc).join(";"));
    for (const e of tc.exceptions) L.push([e.date, e.kind, e.note, EUR(e.diff)].map(esc).join(";"));
  } else {
    L.push("Geen uitzonderingen — alle dagen sluiten aan.");
  }

  return L.join("\r\n");
}

/** Shift an ISO 'YYYY-MM-DD' by whole days (for the settlement-lag window). */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  /**
   * [SLUIS] invoiceId → the supplier's OWN e-factuur XML, when he sent one.
   *
   * Why this is the most valuable byte in the package, and why it is here rather than in a
   * cleverer place: every intake tool an accountant uses — SnelStart's mailbox, Basecone,
   * TriFact365, Zenvoices, Exact's scan-en-herken — swallows ONE document at a time and hands
   * back a booking proposal it read with OCR. A PURCHASE invoice in UBL is the single exception:
   * it is read mechanically, straight into a booking, with the file attached and no OCR anywhere
   * in the chain. The supplier already sent it, the e-mail import already stored it (see
   * email-integration.ts — an e-factuur XML is deliberately not charged against the AI budget
   * because nothing about it costs a model), and until now the accountant never got it.
   *
   * It is written next to its PDF under the SAME base name. That is not cosmetic either: the
   * intake tools pair a PDF and an XML by filename and treat the pair as one document. Two names
   * make two documents out of one invoice.
   *
   * Optional so a caller that has no XMLs at all passes nothing. The orchestrator below always
   * passes it; the gate in closing-package-gates asserts that it does, because "forgot to pass
   * the map" and "this quarter had no e-facturen" produce an identical, silent, empty package.
   */
  xmlByInvoice?: Map<string, PackageFile>;
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
  /** [TURNOVER-CLOSING] Retail till turnover section (per-rate summary + payment
   *  reconciliation + exceptions), or null for a non-retail owner with no daily_turnover. */
  turnoverClosing?: TurnoverClosing | null;
  /** [TRIANGLE] Card reconciliation (kassa PIN ↔ terminal afrekening ↔ bank payout) with
   *  the acquirer commission and the days that don't tie out. null for a non-retail owner
   *  or when no terminal settlement / card payout exists for the quarter. */
  cardReconciliation?: TriangleResult | null;
  /** [AANGIFTE] The CONCEPT BTW-aangifte for the quarter — the SAME figures the owner
   *  sees on the app's aangifte screen (computed via the one reconciliation engine), so
   *  the accountant opens it next to the evidence in this ZIP. null when there is no
   *  sales data at all (nothing to declare yet). Never an invented filing. */
  conceptAangifte?: ConceptAangifte | null;
  /** [ICP] The concept ICP-opgaaf (intracommunautaire leveringen per BTW-nummer). A SEPARATE
   *  declaration from the BTW-aangifte, so it becomes its own file in the ZIP — never a rubriek
   *  of concept-btw-aangifte.csv, which is exactly how an owner would come to believe it was
   *  filed along with the rest. null/absent when the quarter has nothing intra-EU. */
  icp?: IcpResult | null;
  /** [ICP] The quarter's EU purchases (rubriek 4a/4b). A LISTING, never a calculation: the
   *  verlegde BTW and its matching deduction stay out of the concept on purpose. It becomes its
   *  own file so the accountant has the invoices in front of them instead of hunting for them. */
  euPurchases?: ForeignPurchaseResult | null;
  /** [KASBOEK] The cash book as the accountant's running-balance .xlsx (Kiwi layout): the
   *  till's daily cash takings + cash-book movements, with Beginsaldo/Uitgaven/Ontvangsten/
   *  Eindsaldo per day. A pure projection — books nothing into the P&L. null when the drawer
   *  has no life this quarter. */
  kasboekXlsx?: Uint8Array | null;
  warnings: ClosingPackageWarning[];
}

export async function assembleClosingPackageZip(input: AssembleInput): Promise<ClosingPackageResult> {
  const { year, quarter, clientName, outgoing, incoming, pdfByInvoice, bankFiles, kilometerFiles, sharedFiles, paymentDates, hasBankData, turnoverClosing, cardReconciliation, conceptAangifte, icp: icpForZip, euPurchases: euPurchasesForZip, kasboekXlsx } = input;
  // [SLUIS] Absent map = no e-facturen to add. Never a silent skip of a map that WAS handed over.
  const xmlByInvoice = input.xmlByInvoice ?? new Map<string, PackageFile>();
  const warnings = [...input.warnings];
  const quarterLabel = `Q${quarter} ${year}`;
  const zip = new JSZip();
  // [READINESS-EVIDENCE] Count INVOICE PDFs specifically (distinct from filesIncluded, which also
  // folds in bank + shared files) so the summary can report a true invoices-with-evidence figure.
  let invoicePdfCount = 0;
  // [SLUIS] How many invoices travel with the supplier's own e-factuur XML beside them. Reported
  // in overzicht.json, because it is the one number that tells the accountant how much of this
  // package books itself.
  let eInvoiceXmlCount = 0;

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

      // [EVIDENCE-EXT] The file keeps its OWN extension. Every entry used to be written as
      // `.pdf` whatever it actually was, so a photographed bon stored as a JPEG arrived in the
      // accountant's package as `2026-03-04_Sligro_26701681.pdf` — a file their reader refuses to
      // open. The evidence is intact and unreadable at the same time, which for a package whose
      // whole job is to be handed to someone else is the same as missing.
      //
      // Read off the STORAGE PATH, not the display name: the path is what the upload wrote and
      // always carries the real extension, while a display name comes from an e-mail attachment
      // or a camera and is frequently extension-less. Unknown → .pdf, which is what it was.
      const ext = /\.([a-z0-9]{1,5})$/i.exec(file.path)?.[1]?.toLowerCase() ?? "pdf";
      const isPdf = ext === "pdf";

      let bytes = file.bytes;
      if (bucket === "betaald") {
        const info = paymentDates.get(inv.id);
        if (info && info.date && isPdf) {
          bytes = await stampPaymentDate(bytes, info);
        } else if (info && info.date) {
          // [EVIDENCE-EXT] The stamp is drawn with pdf-lib, which cannot open an image. It
          // returned the bytes unchanged, so the file was silently unstamped — and the package
          // says elsewhere that a paid invoice carries its payment date on page 1. Say it instead.
          warnings.push({
            code: "payment_date_unstamped",
            message: `Factuur ${inv.invoice_number ?? inv.id} is een ${ext.toUpperCase()}-bestand — de betaaldatum kon er niet op gestempeld worden. Hij staat wel in de administratie.`,
          });
        } else {
          // Paid but no resolvable payment date — include unstamped, warn.
          warnings.push({
            code: "payment_date_missing",
            message: `Factuur ${inv.invoice_number ?? inv.id} is betaald maar heeft geen betaaldatum — bijgevoegd zonder stempel.`,
          });
        }
      }

      zip.file(`facturen-en-bonnen/${dir}/${bucket}/${baseName}.${ext}`, bytes);
      filesIncluded++;
      invoicePdfCount++;

      // [SLUIS] …and the supplier's own e-factuur beside it, under the SAME base name, because
      // that is what makes an intake tool treat the two files as ONE document instead of two.
      //
      // Guarded on the storage path rather than the extension: when the e-factuur XML is itself
      // the invoice's only evidence, `file` above IS that XML and it has already been written.
      // Writing it a second time would produce two entries with the same name — JSZip keeps the
      // last, so nothing visibly breaks, and the count in overzicht.json would quietly overstate
      // what is in the package.
      const eFactuur = xmlByInvoice.get(inv.id);
      if (eFactuur && eFactuur.path !== file.path) {
        zip.file(`facturen-en-bonnen/${dir}/${bucket}/${baseName}.xml`, eFactuur.bytes);
        filesIncluded++;
        eInvoiceXmlCount++;
      } else if (eFactuur) {
        // Same file, already written under its own .xml extension by the line above — it counts,
        // it is simply not written twice.
        eInvoiceXmlCount++;
      }
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

  // ── overzicht.csv is built LATER (after all warnings are collected) so the CSV's
  //    "Let op" section matches overzicht.json — see below. ──

  // \u2500\u2500 Kasboek.xlsx ([KASBOEK] running-balance cash book in the store's Kiwi layout) \u2500\u2500
  if (kasboekXlsx) { zip.file(`Kasboek-Q${quarter}-${year}.xlsx`, kasboekXlsx); filesIncluded++; }

  // ── dagomzet.csv (retail till turnover: summary + reconciliation + exceptions) ──
  const hasTurnover = !!turnoverClosing && turnoverClosing.summary.days > 0;
  if (hasTurnover && turnoverClosing) {
    zip.file("dagomzet.csv", "﻿" + buildTurnoverCsv(quarterLabel, turnoverClosing));
    if (turnoverClosing.exceptions.length > 0) {
      warnings.push({
        code: "turnover_exceptions",
        message: `Dagomzet: ${turnoverClosing.exceptions.length} dag(en) sluiten niet aan (zie dagomzet.csv) — controleer voor de aangifte.`,
      });
    }
  }

  // ── kaart-reconciliatie.csv (kassa PIN ↔ terminal ↔ bank + acquirer-commissie) ──
  // The card-takings tie-out the accountant otherwise does by hand: gross till PIN vs the
  // terminal afrekening vs the net bank payout, with the commission (BTW-vrij) and the days
  // that don't reconcile flagged. This is the reconciliation nothing else in the ZIP shows.
  if (cardReconciliation && cardReconciliation.days.length > 0) {
    zip.file("kaart-reconciliatie.csv", "﻿" + buildCardReconciliationCsv(quarterLabel, cardReconciliation));
    if (cardReconciliation.grossMismatchDays > 0) {
      warnings.push({
        code: "card_gross_mismatch",
        message: `Kaart-reconciliatie: ${cardReconciliation.grossMismatchDays} dag(en) waar kassa-PIN ≠ terminal-afrekening (zie kaart-reconciliatie.csv) — een echt verschil, controleer voor de aangifte.`,
      });
    }
  }

  // ── overzicht.csv — built HERE, after every warning (incl. turnover_exceptions and
  //    card_gross_mismatch above) is in `warnings`, so its "Let op" section matches
  //    overzicht.json instead of under-reporting the quarter's open points to the accountant.
  zip.file("overzicht.csv", "﻿" + buildOverviewCsv(quarterLabel, outgoing, incoming, warnings, paymentDates));

  // ── concept-btw-aangifte.csv (the concept mapped to Belastingdienst rubrieken) ──
  // Travels WITH the evidence (invoice PDFs, dagomzet.csv, bank statement) in this same
  // ZIP, so every rubriek figure is traceable to its source. RAW concept only, headed
  // "GEEN ingediende aangifte" — the accountant controleert en dient in.
  if (conceptAangifte) {
    zip.file("concept-btw-aangifte.csv", "﻿" + buildAangifteCsv(conceptAangifte));
  }

  // ── concept-icp-opgaaf.csv (intracommunautaire leveringen, per BTW-nummer) ──
  // Its OWN file, because the ICP is its own declaration: folding it into
  // concept-btw-aangifte.csv is exactly how an owner comes to believe it went along with the
  // rest. Written whenever there is anything intra-EU to say — including when there are only
  // PROBLEMS and no listable lines, since "nothing in the ZIP" is how an unfilable opgaaf goes
  // unnoticed until the boete.
  if (icpForZip && (icpForZip.lines.length > 0 || icpForZip.problems.length > 0)) {
    zip.file("concept-icp-opgaaf.csv", "﻿" + buildIcpCsv(icpForZip, quarterLabel));
    filesIncluded++;
  }

  // ── eu-inkopen.csv (rubriek 4a/4b) ──
  // The counterpart of the file above, and the one piece of quarter work this app deliberately
  // leaves to a human: which Dutch rate applies to a foreign purchase is a judgement, and for a
  // KOR or partly-exempt owner 4b and 5b stop cancelling. So it hands over the invoices instead
  // of a number — which is still the whole difference between "there are EU purchases" and a
  // list somebody can work from.
  if (euPurchasesForZip && euPurchasesForZip.purchases.length > 0) {
    zip.file("eu-inkopen.csv", "﻿" + buildForeignPurchaseCsv(euPurchasesForZip, quarterLabel));
    filesIncluded++;
  }

  // RAW summary numbers (reuse quarterly lib — same logic the owner sees).
  const allQuarterly = [...outgoing, ...incoming].map(toQuarterly);
  const zzpSummary = buildZzpSummary(allQuarterly, year, quarter, "all");
  // [BTW-DIRECTION] omzet_per_tarief is SALES per rate — it must be built from OUTGOING
  // invoices ONLY. Feeding [...outgoing,...incoming] bucketed purchase costs into the
  // "omzet" rate rows (a €800 purchase @21% inflated the 21% omzet to 1800/378 instead of
  // 1000/210), contradicting the sibling btw_uitgaand/btw_inkomend fields in the same JSON.
  const salesSummary = buildQuarterlySummary(outgoing.map(toQuarterly), year, quarter);

  const summary: ClosingPackageSummary = {
    quarter: quarterLabel,
    outgoingCount: outgoing.length,
    incomingCount: incoming.length,
    filesIncluded,
    invoicesWithPdf: invoicePdfCount, // [READINESS-EVIDENCE] invoice-evidence count only
    // [EVIDENCE] Deze variant telt de bestanden die de ZIP daadwerkelijk inpakte en houdt
    // geen factuurnummers bij; leeg is hier de eerlijke waarde, niet een vergeten veld.
    // De readiness-tekst valt dan terug op zijn algemene zin (readiness.ts:201-204).
    missingEvidence: [],
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
        // [SLUIS] Facturen die hun eigen e-factuur (UBL/CII) meebrengen. Voor deze regels hoeft
        // geen enkel boekhoudpakket te scannen: ze worden mechanisch ingelezen, en het bestand
        // staat onder dezelfde naam naast de PDF zodat een inleesdienst het als één document ziet.
        e_facturen_bijgevoegd: eInvoiceXmlCount,
        bankafschrift_bijgevoegd: summary.bankStatementIncluded,
        // RAW numbers only — accountant computes the aangifte.
        btw_overzicht: {
          omzet_per_tarief: salesSummary.btwBreakdown,
          uitgaand_incl: zzpSummary.totalIn,
          inkomend_incl: zzpSummary.totalOut,
          btw_uitgaand: zzpSummary.totalBtwIn,
          btw_inkomend: zzpSummary.totalBtwOut,
        },
        // [TURNOVER-CLOSING] Retail till turnover — the store's bulk revenue, per rate,
        // with the days that don't reconcile flagged. null for a non-retail owner.
        dagomzet: hasTurnover && turnoverClosing
          ? {
              dagen: turnoverClosing.summary.days,
              omzet_per_tarief: turnoverClosing.summary.perRate,
              totaal_excl_btw: turnoverClosing.summary.totalNet,
              totaal_btw: turnoverClosing.summary.totalBtw,
              totaal_incl_btw: turnoverClosing.summary.totalIncl,
              betaald_pin: turnoverClosing.summary.totalPin,
              betaald_contant: turnoverClosing.summary.totalCash,
              uitzonderingen: turnoverClosing.exceptions,
            }
          : null,
        // [AANGIFTE] The CONCEPT BTW-aangifte — same figures as the app's aangifte screen.
        // A concept ("geen ingediende aangifte"): the accountant controleert en dient in.
        // The rubriek BTW is derived from the evidence in THIS ZIP (invoices + dagomzet),
        // so every figure is traceable; the notes state what each one depends on.
        concept_btw_aangifte: conceptAangifte
          ? {
              is_concept: true,
              kwartaal: conceptAangifte.quarterLabel,
              rubrieken: conceptAangifte.rows,
              verschuldigd_5a: conceptAangifte.verschuldigd,
              voorbelasting_5b: conceptAangifte.voorbelasting,
              saldo_5g: conceptAangifte.saldo,
              omzet_zonder_tarief: conceptAangifte.cashOmzetZonderBtw,
              toelichting: conceptAangifte.notes,
            }
          : null,
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

// [BON-BETAALWIJZE] payment_method + payment_date + source horen hier thuis. Zonder die drie
// ontving de boekhouder een contante bon van 112,92 zonder te weten HOE er is betaald — zijn
// eerste vraag over elke bon, en juist bij contant de enige die hij niet zelf kan afleiden
// (geen bankregel om tegenaan te leggen). Precies de vraag die het gesprek naar WhatsApp
// terugstuurde, terwijl het antwoord al op het papier stond.
const INVOICE_FIELDS =
  "id, invoice_number, client_name, status, direction, invoice_type, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date, pdf_url, document_id, client_btw_number, marked_paid_at, payment_method, payment_date, source, sender_id, receiver_id" as const;

/**
 * [DATE-GAP] Verified invoices that carry NO invoice_date. Postgres range filters
 * (`.gte(...).lte(...)`) silently DROP NULL-date rows, so such an invoice belongs to
 * this owner and is verified, yet appears in NO quarter's package and NO concept
 * aangifte — its BTW just vanishes (voorbelasting too low / te-betalen too high) with
 * zero trace. This finds them so the package can WARN instead of losing them. Returns
 * the count + up-to-`cap` human labels.
 *
 * [NO-SILENT-EMPTY] `checked: false` when the query failed. This function exists to WARN, and a
 * warning-finder that answers "nothing to warn about" because it could not look is the most
 * misleading shape it could take: the invoices still vanish from every quarter, and now the package
 * has actively said they do not exist. Never throws — the package is still built — but the caller
 * gets to say which of the two it is.
 */
async function datelessVerifiedInvoices(
  supabase: PipelineClient,
  ownerId: string,
  cap = 10,
): Promise<{ count: number; labels: string[]; checked: boolean }> {
  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_FIELDS)
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .is("invoice_date", null)
    .neq("status", "archived");
  if (error) {
    console.error("[NO-SILENT-EMPTY] dateless-invoice check failed — the package says so", { ownerId, error: error.message });
    return { count: 0, labels: [], checked: false };
  }
  const verified = (data ?? [])
    .map((raw) => {
      const row = raw as unknown as PackageInvoice;
      return { ...row, direction: effectiveDirection(row, ownerId) };
    })
    .filter(isVerifiedForPackage);
  return {
    checked: true,
    count: verified.length,
    labels: verified.slice(0, cap).map((i) => i.invoice_number ?? i.id),
  };
}

/** A warning for dateless verified invoices, or null when there are none. Shared by the
 * ZIP builder and the preview summary so both tell the SAME truth. */
// Exported for its test: the difference between "none" and "could not look" is the whole point.
export function datelessWarning(d: { count: number; labels: string[]; checked: boolean }): ClosingPackageWarning | null {
  // [NO-SILENT-EMPTY] "We could not look" is not "there are none". A dateless verified invoice sits
  // in no quarter package and no concept aangifte — its BTW simply vanishes — so the accountant has
  // to know the difference between a package that checked and a package that could not.
  if (!d.checked) {
    return {
      code: "invoice_no_date",
      message:
        "We konden niet nagaan of er geverifieerde facturen ZONDER datum zijn. Die vallen buiten elk " +
        "kwartaalpakket en hun BTW/voorbelasting ontbreekt dan — controleer dit vóór je de aangifte indient.",
    };
  }
  if (d.count === 0) return null;
  const shown = d.labels.join(", ");
  const more = d.count > d.labels.length ? ` (+${d.count - d.labels.length} meer)` : "";
  return {
    code: "invoice_no_date",
    message:
      `${d.count} geverifieerde factu(u)r(en) hebben GEEN datum en vallen daardoor buiten elk ` +
      `kwartaalpakket — hun BTW/voorbelasting ontbreekt tot je een datum toekent: ${shown}${more}.`,
  };
}

/**
 * [FIN-10] The bank statement FILE paths for a quarter — the SAME two queries the ZIP
 * builder uses (period-tagged + legacy created_at fallback), extracted so the preview
 * summary can tell whether a statement file will actually be attached. Returns de-duped
 * {path,name}. Presence of transactions ≠ presence of the statement file.
 */
async function bankStatementPaths(
  supabase: PipelineClient,
  ownerId: string,
  year: number,
  quarter: Quarter,
): Promise<Array<{ path: string; name: string }>> {
  const start = quarterStartDate(year, quarter);
  const end = quarterEndDate(year, quarter);
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
  const rows = [...(taggedStmts ?? []), ...(legacyStmts ?? [])] as Array<{
    file_url: string | null;
    file_name: string | null;
  }>;
  const out: Array<{ path: string; name: string }> = [];
  const seen = new Set<string>();
  for (const d of rows) {
    if (!d.file_url || seen.has(d.file_url)) continue;
    seen.add(d.file_url);
    out.push({ path: d.file_url, name: d.file_name ?? "bankafschrift" });
  }
  return out;
}

/**
 * [BRUG-FILES-SHARED] Owner-shared general docs (kassabonnen, contracten, …) split into
 * the ones tied to THIS quarter (go in the ZIP) and a count of the ones the owner shared
 * but that belong to another quarter OR carry no quarter at all — those silently fall out
 * of every package, so the summary/ZIP can WARN instead of dropping them unseen. Excludes
 * invoices (own section) and bankafschriften (own section). Shared by the ZIP + the preview
 * so both count and warn identically.
 */
async function sharedDocsForQuarter(
  supabase: PipelineClient,
  ownerId: string,
  year: number,
  quarter: Quarter,
): Promise<{ paths: Array<{ path: string; name: string }>; outsideCount: number; checked: boolean }> {
  const sharedPeriod = `${year}-Q${quarter}`;
  // [NO-SILENT-EMPTY] Same rule as datelessVerifiedInvoices above. This read decides BOTH what goes
  // into the package and what the package warns about, so a dropped error shipped an accountant a
  // quarter with its shared documents missing and nothing saying they were ever expected.
  const { data, error } = await supabase
    .from("documents")
    .select("file_url, file_name, doc_type, invoice_id, period")
    .eq("user_id", ownerId)
    .eq("shared", true)
    .eq("trashed", false)
    .is("invoice_id", null);
  if (error) {
    console.error("[NO-SILENT-EMPTY] shared-document read failed — the package says so", { ownerId, error: error.message });
    return { paths: [], outsideCount: 0, checked: false };
  }
  const rows = (data ?? []) as Array<{
    file_url: string | null; file_name: string | null; doc_type: string | null; period: string | null;
  }>;
  const paths: Array<{ path: string; name: string }> = [];
  let outsideCount = 0;
  for (const d of rows) {
    if (!d.file_url || d.doc_type === "bankafschrift") continue; // not a general shared doc
    if (d.period === sharedPeriod) paths.push({ path: d.file_url, name: d.file_name ?? "document" });
    else outsideCount++; // shared, but another quarter / no quarter → not in THIS package
  }
  return { paths, outsideCount, checked: true };
}

// [PACKAGE-VOORBELASTING] A bank payment CODED as a business cost with no purchase invoice
// behind it — rent, telecom, insurance, a supplier paid straight from the account.
//
// WHY THIS IS ITS OWN WARNING
// A bare bank line carries no BTW document, so financial-result books it as a NET cost with
// zero voorbelasting. The euro is in the profit; the deductible BTW is not. The owner therefore
// pays MORE BTW than they owe — silently, because from the app's side nothing is missing: the
// line has a category, it is placed, every total adds up.
//
// It is NOT covered by 'bank_unresolved', and deliberately so: that one counts lines with NO
// category at all. Once auto-categorisation has learned "this counterpart is rent", the line
// gets a category and drops out of that warning entirely — which is exactly when this one has
// to take over. The two are disjoint by construction (category IS NULL vs category = 'kosten').
//
// readiness.ts already tells the OWNER this ([VOORBELASTING-RISK]), as a risk rather than a
// hard block. But a risk does not stop a hand-over, so the quarter could reach the accountant
// with deductible BTW missing and nothing in the package saying so. Same reasoning as
// [PACKAGE-UNVERIFIED]: the preview warned, the thing the accountant actually receives did not.
//
// 'fee' (bankkosten) is excluded on purpose — payment services are BTW-exempt (art. 11 lid 1-i
// Wet OB), so there is no voorbelasting to lose there and flagging it would be noise.
// The lines behind that warning. Scoped EXACTLY like readiness.ts's undocumentedCount — pending,
// no linked invoice, coded 'kosten' — so the owner's screen and the accountant's package can
// never quote two different numbers for the same thing. Debits only: a credit coded 'kosten'
// (a refund) has no voorbelasting to reclaim.
//
// Fail-soft, like every other completeness probe here: if the read fails, this one check lapses
// rather than taking the whole hand-over down with it.
async function costLinesWithoutInvoice(
  supabase: PipelineClient,
  ownerId: string,
  start: string,
  end: string,
): Promise<{ count: number; total: number }> {
  const rows = await fetchAllRows<{ id: string; amount: number | null }>((from, to) =>
    supabase
      .from("bank_transactions")
      .select("id, amount")
      .eq("user_id", ownerId)
      .eq("status", "pending")
      .eq("category", "kosten")
      .is("invoice_id", null)
      .lt("amount", 0)
      .gte("date", start)
      .lte("date", end)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch(() => [] as { id: string; amount: number | null }[]);
  const total = rows.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
  return { count: rows.length, total: round2(total) };
}

// [PACKAGE-VOORBELASTING-KAS] The same loss, one drawer over.
//
// financial-result claims voorbelasting on a cash cost ONLY when a bon is linked AND a rate is
// set ([CASH-COST-VAT]); without both it books the FULL GROSS as cost with €0 deductible. That
// is the right call — never invent a deduction — but it means a cash purchase whose paper
// receipt was never photographed quietly costs the owner the BTW on it.
//
// If anything this is the more common half: a cash purchase is exactly the one that comes with a
// paper slip that ends up in a coat pocket. readiness carries a general sentence about it
// ("Voorbelasting telt alleen ingevoerde inkoopfacturen/bonnen…"), but a sentence is not a
// number — nobody goes looking through a quarter of receipts for a note that is always there.
// A count and a euro figure is what makes someone go and look.
export function cashCostWithoutReceiptWarning(count: number, total: number): ClosingPackageWarning | null {
  if (count <= 0) return null;
  return {
    code: "cash_cost_without_receipt",
    message:
      `${count} contante kostenpost(en) van samen ${formatEuroNL(total)} hebben geen bon. ` +
      `Het bedrag telt volledig mee in de kosten, maar er is geen voorbelasting (5b) op ` +
      `terug te vragen zolang de bon ontbreekt.`,
  };
}

/** Cash costs booked without a receipt, from entries already in memory. Pure. */
export function cashCostsWithoutReceipt(
  entries: readonly { direction: string; amount: number | null; category: string | null; document_id?: string | null }[],
): { count: number; total: number } {
  let count = 0;
  let total = 0;
  for (const c of entries) {
    // Money OUT under 'kosten' with no linked document. A cash entry going IN under 'kosten' is a
    // refund OF a cost, which has no voorbelasting of its own to reclaim.
    if (c.direction !== "out" || c.category !== "kosten" || c.document_id) continue;
    count++;
    total += Math.abs(Number(c.amount) || 0);
  }
  return { count, total: round2(total) };
}

export function costWithoutInvoiceWarning(count: number, total: number): ClosingPackageWarning | null {
  if (count <= 0) return null;
  return {
    code: "bank_cost_without_invoice",
    message:
      `${count} banktransactie(s) van samen ${formatEuroNL(total)} zijn geboekt als zakelijke kosten, ` +
      `maar er hoort geen inkoopfactuur bij. Het bedrag telt wel mee in de kosten, de BTW erop ` +
      `NIET — zonder factuur is er geen voorbelasting (5b) om terug te vragen. Controleer of de ` +
      `facturen nog geleverd kunnen worden voordat de aangifte weggaat.`,
  };
}

/** A warning for shared files that fall outside this quarter's package, or null. Shared by
 *  the ZIP builder and the preview summary so both tell the SAME truth. */
// Exported for its test — "we could not look" and "there are none" must not read the same.
export function sharedOutsideWarning(outsideCount: number, checked = true): ClosingPackageWarning | null {
  if (!checked) {
    return {
      code: "shared_doc_other_quarter",
      message:
        "We konden de gedeelde bestanden nu niet ophalen. Er zitten daardoor mogelijk documenten " +
        "niet in dit pakket die er wel bij horen — controleer dit vóór je het naar je boekhouder stuurt.",
    };
  }
  if (outsideCount <= 0) return null;
  return {
    code: "shared_outside_quarter",
    message:
      `${outsideCount} gedeeld(e) bestand(en) hoort/horen bij een ander kwartaal of hebben geen ` +
      `kwartaal, en zitten NIET in dit pakket — controleer of ze bij dit kwartaal thuishoren.`,
  };
}

// [AANGIFTE] EU VAT prefixes (excl. NL) — a cheap, honest signal that a purchase may be
// intra-EU (rubriek 4b), which the concept aangifte does NOT auto-compute. Mirrors
// /api/aangifte so the closing package and the app screen never disagree.
const EU_VAT = /^(AT|BE|BG|CY|CZ|DE|DK|EE|ES|FI|FR|GR|EL|HR|HU|IE|IT|LT|LU|LV|MT|PL|PT|RO|SE|SI|SK)/i;

/** Whole calendar days in a quarter (for the concept-aangifte coverage note). */
function daysInQuarter(year: number, quarter: Quarter): number {
  const startMonth = (quarter - 1) * 3;
  const startMs = Date.UTC(year, startMonth, 1);
  const endMs = Date.UTC(year, startMonth + 3, 0); // day 0 of next-next month = last day
  return Math.round((endMs - startMs) / 86400000) + 1;
}

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
  // [KAS-ZACHT] Live movements only, resolved once for every cash read in this function.
  const liveCash = await liveCashEntries(supabase);
  const start = quarterStartDate(year, quarter);
  const end = quarterEndDate(year, quarter);
  const warnings: ClosingPackageWarning[] = [];

  // [PAGINATION] Page past the ~1000-row PostgREST cap: a busy shop's quarter can exceed it,
  // and a silent truncation would drop invoices from the count AND the readiness warning below.
  const invData = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from("invoices")
      .select(INVOICE_FIELDS)
      .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
      .gte("invoice_date", start)
      .lte("invoice_date", end)
      .neq("status", "archived")
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e: unknown) => {
    throw new Error(`[CLOSING-PACKAGE] summary query failed: ${e instanceof Error ? e.message : String(e)}`);
  });

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

  // [PACKAGE-READINESS] Imported invoices dated in this quarter STILL in the verify queue
  // (status 'processing') are real bills the owner hasn't confirmed. They don't count as
  // verified above, so without this they'd vanish from the package with zero signal — the
  // exact "missing invoice" the owner fears. Surface a warning so "afsluiten" is never auto-
  // green while unverified invoices sit unbooked. (Readiness enforces the block; here we only
  // report.) Only 'processing' — that IS the verify queue; a 'draft' is an unsent OUTGOING
  // sales invoice (not a legal invoice yet, and often an abandoned draft), a different concern
  // that must not falsely block the quarter close.
  const unverifiedInQuarter = all.filter((i) => i.status === "processing").length;

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
    // [SEC-STORAGE-PATH] Scoped to the owner, like the bankafschrift query below and unlike
    // these two reads before it. invoices.document_id is ordinary text on a row the owner may
    // write, and `supabase` here is service_role — so an id pointing at another tenant's
    // document was read by id and its bytes shipped inside this owner's quarter ZIP.
    const { data: docs } = await supabase
      .from("documents")
      .select("id, file_url")
      .eq("user_id", ownerId)
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
  const hasBankData = (bankTx ?? []).length > 0;

  // [BANK-ONOPGELOST] A bank line that reached the end of the quarter still PENDING and still
  // uncategorised is a euro nobody placed: it contributes 0 to omzet, kosten and voorbelasting
  // (financial-result.ts drops any line without a category), it asserts no payment, and nothing
  // in the handover says so. Seventeen warning codes covered other completeness gaps and none
  // covered this one — so the single thing the accountant most needs to be asked about arrived
  // as silence, and the owner's own "ik weet niet wat dit is" had nowhere to land.
  //
  // Deliberately counts EVERY unresolved line, not a flagged subset: the gap exists today, for
  // every owner, whether or not they ever press a button. Ignored lines (status 'not_found') are
  // out — those the owner answered, even if the answer was "not mine".
  const unresolvedBank = await fetchAllRows<{ id: string; amount: number | null }>((from, to) =>
    supabase
      .from("bank_transactions")
      .select("id, amount")
      .eq("user_id", ownerId)
      .eq("status", "pending")
      .is("category", null)
      .gte("date", start)
      .lte("date", end)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch(() => [] as { id: string; amount: number | null }[]);
  const unresolvedBankCount = unresolvedBank.length;
  const unresolvedBankTotal =
    round2(unresolvedBank.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0));

  // Whether the statement FILE will actually be attached — separate from "we have bank
  // data". Reported truthfully so the preview matches the ZIP (which two-tiers the same way).
  const bankFilePaths = await bankStatementPaths(supabase, ownerId, year, quarter);
  const bankStatementIncluded = bankFilePaths.length > 0;

  // [C#3] Owner-shared general docs for this quarter — counted so the preview
  // filesIncluded matches what the ZIP actually ships (invoices-with-PDF alone undercounted
  // it, since the ZIP also carries bank + shared files). [C#2] outsideCount → a warning.
  const shared = await sharedDocsForQuarter(supabase, ownerId, year, quarter);

  // Honest warnings — the real gaps, listed specifically.
  if (verified.length === 0) {
    warnings.push({ code: "no_invoices", message: "Geen geverifieerde facturen in dit kwartaal." });
  }
  // [PACKAGE-READINESS] Unverified invoices dated in the quarter → the owner must clear the
  // verify queue before closing, else these real bills never reach the accountant.
  if (unverifiedInQuarter > 0) {
    warnings.push({
      code: "unverified_in_queue",
      message:
        unverifiedInQuarter === 1
          ? "1 factuur staat nog in de verwerkingsrij — verifieer die voordat je afsluit."
          : `${unverifiedInQuarter} facturen staan nog in de verwerkingsrij — verifieer ze voordat je afsluit.`,
    });
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
  // [DATE-GAP] Verified invoices with no date never enter any quarter — warn, don't lose.
  const dateless = datelessWarning(await datelessVerifiedInvoices(supabase, ownerId));
  if (dateless) warnings.push(dateless);
  // Bank: mirror the ZIP's two-tier truth exactly. No data at all vs. data present but the
  // statement file isn't attached — the latter used to be invisible to the preview.
  if (!hasBankData) {
    warnings.push({ code: "no_bank_statement", message: "Geen banktransacties gevonden voor dit kwartaal — upload het bankafschrift." });
  } else if (!bankStatementIncluded) {
    warnings.push({ code: "bank_file_missing", message: "Banktransacties zijn aanwezig, maar het originele bankafschrift-bestand is (nog) niet bijgevoegd — upload het bankafschrift." });
  }
  // [BANK-ONOPGELOST] unshift, not push — and the reason is arithmetic, not taste. gapCount is
  // warnings.length, but both the owner mail and the accountant mail render only
  // `.slice(0, 3)` of the messages (quarter-close.ts). A busy quarter is exactly the one that
  // pushes this past index 3, and a busy quarter is exactly when an unplaced euro matters most —
  // so a plain push would truncate the owner's own open question away precisely when it counts.
  if (unresolvedBankCount > 0) {
    warnings.unshift({
      code: "bank_unresolved",
      message:
        `${unresolvedBankCount} banktransactie(s) van samen ${formatEuroNL(unresolvedBankTotal)} zijn nog niet ` +
        `geplaatst: geen factuur en geen categorie. Ze tellen daardoor in geen enkel cijfer mee — ` +
        `niet in omzet, niet in kosten en niet in de voorbelasting.`,
    });
  }
  // [PACKAGE-VOORBELASTING] Costs paid by bank with no purchase invoice — deductible BTW the
  // owner is about to leave on the table. See the helper for why this is separate from
  // 'bank_unresolved'.
  const costNoInvoice = await costLinesWithoutInvoice(supabase, ownerId, start, end);
  const costNoInvoiceWarning = costWithoutInvoiceWarning(costNoInvoice.count, costNoInvoice.total);
  if (costNoInvoiceWarning) warnings.push(costNoInvoiceWarning);

  // [C#2] Shared files that fall outside this quarter — warn, don't drop silently.
  const sharedOutside = sharedOutsideWarning(shared.outsideCount, shared.checked);
  if (sharedOutside) warnings.push(sharedOutside);

  return {
    quarter: `Q${quarter} ${year}`,
    outgoingCount: outgoing.length,
    incomingCount: incoming.length,
    // [C#3] Match what the ZIP actually ships: invoices-with-PDF + bank statement file(s)
    // + owner-shared docs for this quarter. (km is not a feature yet → 0.)
    filesIncluded: withPdf + bankFilePaths.length + shared.paths.length,
    invoicesWithPdf: withPdf, // [READINESS-EVIDENCE] invoice-evidence count only
    // [EVIDENCE] Doorgeven in plaats van weggooien. Zie de toelichting bij het type.
    missingEvidence: missingPdf.slice(0, 50),
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
  // [KAS-ZACHT] Live movements only — a removed line is out of the aangifte, out of the Kasboek
  // sheet and out of every total in this package. Resolved once for the three cash reads below.
  const liveCash = await liveCashEntries(supabase);
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
  // [REGIME-FLAGS] Owner's KOR declaration (drives the accountant-handoff flag, never a figure).
  // [DEPLOY-SAFE] Fetched in its OWN query — never folded into the clientName select above — so if
  // the regime_kor.sql migration lags this deploy, a missing column only nulls korActive (→ no
  // flags), and can NEVER break the client-name lookup or any figure in this package.
  const { data: korProfile } = await supabase
    .from("profiles").select("kor_active").eq("id", ownerId).maybeSingle();
  const korActive = !!(korProfile as { kor_active?: boolean | null } | null)?.kor_active;

  // Invoices of the quarter (both directions). Filter on STORED status only
  // (verified sets), within the quarter date range.
  // [PAGINATION] Page past the ~1000-row cap — this set feeds BOTH the evidence PDFs and
  // invoicesForResult (the concept aangifte money), so a silent truncation would understate it.
  const invData = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from("invoices")
      .select(INVOICE_FIELDS)
      .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
      .gte("invoice_date", start)
      .lte("invoice_date", end)
      .neq("status", "archived")
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e: unknown) => {
    throw new Error(`[CLOSING-PACKAGE] invoices query failed: ${e instanceof Error ? e.message : String(e)}`);
  });

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

  // [DATE-GAP] Verified invoices with NO invoice_date are dropped by the range filter
  // above and would vanish from BOTH the evidence and the concept aangifte with no trace.
  // Warn (with labels) so the accountant knows to assign a date instead of losing the BTW.
  const datelessZip = datelessWarning(await datelessVerifiedInvoices(supabase, ownerId));
  if (datelessZip) warnings.push(datelessZip);

  // [PACKAGE-UNVERIFIED] Mirror the summary's 'unverified_in_queue' warning into the ACTUAL ZIP.
  // Invoices still 'processing' (in the verify queue) are correctly excluded from the verified set,
  // but without this the downloaded overzicht.json/csv carried NO mention of them — voorbelasting
  // silently understated and the accountant had zero signal. The preview summary warned; the ZIP
  // (the thing the accountant actually receives) did not. Same wording as summarizeClosingPackage.
  const unverifiedInQuarterZip = all.filter((i) => i.status === "processing").length;
  if (unverifiedInQuarterZip > 0) {
    warnings.push({
      code: "unverified_in_queue",
      message:
        unverifiedInQuarterZip === 1
          ? "1 factuur staat nog in de verwerkingsrij — verifieer die voordat je afsluit."
          : `${unverifiedInQuarterZip} facturen staan nog in de verwerkingsrij — verifieer ze voordat je afsluit.`,
    });
  }

  // [PACKAGE-VOORBELASTING] Same mirror, for costs paid by bank with no purchase invoice. The
  // owner's readiness screen flags these as a risk, but a risk does not block a hand-over — so
  // without this the accountant receives a quarter with unclaimed voorbelasting and no signal.
  const costNoInvoiceZip = await costLinesWithoutInvoice(supabase, ownerId, start, end);
  const costNoInvoiceZipWarning = costWithoutInvoiceWarning(costNoInvoiceZip.count, costNoInvoiceZip.total);
  if (costNoInvoiceZipWarning) warnings.push(costNoInvoiceZipWarning);

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
    // [SEC-STORAGE-PATH] Scoped to the owner, like the bankafschrift query below and unlike
    // these two reads before it. invoices.document_id is ordinary text on a row the owner may
    // write, and `supabase` here is service_role — so an id pointing at another tenant's
    // document was read by id and its bytes shipped inside this owner's quarter ZIP.
    const { data: docs } = await supabase
      .from("documents")
      .select("id, file_url, file_name")
      .eq("user_id", ownerId)
      .in("id", incomingDocIds);
    const docRows = (docs ?? []) as unknown as Array<{
      id: string;
      file_url: string | null;
      file_name: string | null;
    }>;
    const docById = new Map(docRows.map((d) => [d.id, d]));
    for (const inv of incoming) {
      const d = inv.document_id ? docById.get(inv.document_id) : null;
      // …and the key must sit in this owner's own folder, not merely on a row that is theirs.
      const pad = toStoragePath(d?.file_url);
      if (d?.file_url && pathBelongsToOwner(pad, ownerId)) {
        pathByInvoice.set(inv.id, { path: pad, name: d.file_name ?? `${inv.invoice_number ?? inv.id}` });
      }
    }
  }

  // ── [SLUIS] The supplier's own e-factuur XML, per incoming invoice ──
  //
  // Found through documents.invoice_id, which the e-mail import writes back when it links a
  // stored file to the invoice it produced (email-integration.ts, "[BOEK-011] Link the document
  // back to the invoice"). That link is the only honest way to claim an XML belongs to a
  // particular invoice; anything looser would put one supplier's e-factuur next to another
  // supplier's PDF, under the same base name, which is worse than shipping nothing.
  //
  // Note what is NOT trusted here: the media type. A .xml arrives as application/xml, text/xml,
  // application/octet-stream or nothing at all depending on the mail server — e-invoice.ts says
  // so at length — so the type only narrows the candidates and the BYTES decide, below.
  const xmlPathByInvoice = new Map<string, { path: string; name: string }>();
  const incomingIds = incoming.map((i) => i.id);
  if (incomingIds.length > 0) {
    const { data: xmlDocs } = await supabase
      .from("documents")
      .select("invoice_id, file_url, file_name")
      .eq("user_id", ownerId)
      // A file the owner threw away is not evidence he wants delivered to his accountant.
      .eq("trashed", false)
      .in("invoice_id", incomingIds);
    for (const d of (xmlDocs ?? []) as unknown as Array<{
      invoice_id: string | null;
      file_url: string | null;
      file_name: string | null;
    }>) {
      if (!d.invoice_id || !d.file_url) continue;
      // Read the extension off the STORAGE PATH for the same reason [EVIDENCE-EXT] does: the path
      // is what the upload wrote, a display name from a mail attachment often carries none.
      const pad = toStoragePath(d.file_url);
      if (!/\.xml$/i.test(pad)) continue;
      // [SEC-STORAGE-PATH] A row check is not a path check — same guard as the PDF read above.
      if (!pathBelongsToOwner(pad, ownerId)) continue;
      if (xmlPathByInvoice.has(d.invoice_id)) continue; // one e-factuur per invoice; first wins
      xmlPathByInvoice.set(d.invoice_id, { path: pad, name: d.file_name ?? "e-factuur.xml" });
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

  // [SLUIS] …and the e-facturen, with the CONTENT deciding whether each really is one. A CAMT.053
  // bank statement is also XML, and an unrelated .xml attachment is also XML; shipping either one
  // beside a PDF under that PDF's name would tell an intake tool "this is the machine-readable
  // version of this invoice" about a file that is nothing of the kind. looksLikeInvoiceXmlBytes
  // reads the root element and nothing else, which is exactly the claim being made.
  const xmlEntries = await Promise.all(
    [...xmlPathByInvoice.entries()].map(async ([invId, p]) => {
      const f = await dl(p.path, p.name);
      if (!f || !looksLikeInvoiceXmlBytes(Buffer.from(f.bytes))) return [invId, null] as const;
      return [invId, f] as const;
    })
  );
  const xmlByInvoice = new Map<string, PackageFile>();
  for (const [invId, f] of xmlEntries) {
    if (f) xmlByInvoice.set(invId, f);
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
  // Shared via the single helper (same split as the preview): in-quarter → the ZIP;
  // outside-quarter → a [C#2] warning so a shared file that belongs elsewhere isn't
  // silently absent. Invoices + bankafschriften are excluded (their own sections).
  const shared = await sharedDocsForQuarter(supabase, ownerId, year, quarter);
  const sharedFilesRaw = await Promise.all(shared.paths.map((p) => dl(p.path, p.name)));
  const sharedFiles = sharedFilesRaw.filter((f): f is PackageFile => f !== null);
  const sharedOutside = sharedOutsideWarning(shared.outsideCount, shared.checked);
  if (sharedOutside) warnings.push(sharedOutside);

  // ── [CLOSING-PACKAGE-PAYDATE] Resolve payment dates for PAID invoices (one query) ──
  const paidInvoices = [...outgoing, ...incoming].filter((i) => i.status === "paid");
  const paymentDatesResult = await resolvePaymentDates(supabase, paidInvoices);
  const paymentDates = paymentDatesResult.dates;
  // [PAYDATE-READ-HONEST] The dates still degrade to marked_paid_at, exactly as they always did on
  // a missing link — but the accountant is told that these are estimates because a read failed,
  // not because no bank line exists. Those are different facts and only one of them is her problem.
  if (!paymentDatesResult.complete) {
    warnings.push({
      code: "paydate_read_failed",
      message:
        "De betaaldatums uit je bankafschrift konden niet volledig worden gelezen. De datums in dit pakket kunnen daardoor schattingen zijn (de datum waarop de factuur op betaald is gezet) in plaats van de echte bankdatum — controleer ze voordat je ze gebruikt.",
    });
  }

  // ── [TURNOVER-CLOSING] Retail till turnover for the quarter + its reconciliation ──
  // [COVERED-BUFFER] Fetch a 5-day PRE-quarter buffer too, so the covered-day de-dup below
  // matches /api/aangifte exactly: a card payout booked early this quarter that settles a
  // PREVIOUS-quarter till day (settleExact) must be suppressed here — without the buffer the
  // ZIP counted it AGAIN as omzet-zonder-tarief, disagreeing with the in-app concept.
  // [NO-SILENT-EMPTY] A failed read here answered "this shop had no till turnover this quarter",
  // which for a retailer is the single largest number in the package. Zero omzet is a conclusion
  // and must never be the shape of an outage; the package says so instead.
  const { data: turnoverRows, error: turnoverErr } = await supabase
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", ownerId)
    .gte("turnover_date", shiftDays(start, -5))
    .lte("turnover_date", end);
  if (turnoverErr) {
    console.error("[NO-SILENT-EMPTY] daily_turnover read failed — the package says so instead of reporting zero omzet", { ownerId, error: turnoverErr.message });
    warnings.push({
      code: "turnover_read_failed",
      message:
        "De dagomzet kon niet worden gelezen. Staat er kasomzet in dit kwartaal, dan ontbreekt die in dit pakket — bouw het opnieuw op voordat je het naar je boekhouder stuurt.",
    });
  }
  const allTurnover: DailyTurnover[] = (turnoverRows ?? []).map((t) => ({
    turnover_date: t.turnover_date,
    base_0: t.base_0 ?? 0, base_9: t.base_9 ?? 0, base_21: t.base_21 ?? 0,
    btw_9: t.btw_9 ?? 0, btw_21: t.btw_21 ?? 0,
    total_incl: t.total_incl, pin_amount: t.pin_amount, cash_amount: t.cash_amount, other_amount: t.other_amount,
  }));
  // dagomzet.csv + the triangle use strictly IN-quarter rows; the covered set uses the buffer.
  const turnover: DailyTurnover[] = allTurnover.filter((t) => t.turnover_date >= start);

  let turnoverClosing: TurnoverClosing | null = null;
  let cardReconciliation: TriangleResult | null = null;
  if (turnover.length > 0) {
    // pos_income lines over the quarter ± a settlement-lag buffer; the DAT date (parsed
    // inside buildTurnoverClosing) keys each settlement to its takings day.
    // [PAGINATION] All three MUST page past PostgREST's ~1000-row cap: a busy shop's quarter of
    // pos_income lines (several schemes/day + refunds) exceeds it, and a truncated fetch silently
    // understates pinSettled → fabricated pin breaks in the accountant-facing reconciliation
    // (and understated evidence). Same trap the cash_entries fetch below already avoids.
    const [posData, cashData, eftData] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("bank_transactions")
          .select("description, amount, date")
          .eq("user_id", ownerId)
          .eq("category", "pos_income")
          .gte("date", shiftDays(start, -5))
          .lte("date", shiftDays(end, 5))
          .order("id", { ascending: true })
          .range(from, to)).catch(() => []),
      fetchAllRows((from, to) =>
        liveCash.only(supabase
          .from("cash_entries")
          .select("entry_date, amount")
          .eq("user_id", ownerId)
          .eq("category", "omzet")
          .gte("entry_date", start)
          .lte("entry_date", end))
          .order("id", { ascending: true })
          .range(from, to)).catch(() => []),
      fetchAllRows((from, to) =>
        supabase
          .from("eft_settlements")
          .select("settlement_date, terminal_id, period_nr, shift_nr, period_start, period_end, first_trx, last_trx, gross_total, tx_count, by_scheme")
          .eq("user_id", ownerId)
          .gte("settlement_date", start)
          .lte("settlement_date", end)
          .order("id", { ascending: true })
          .range(from, to)).catch(() => []),
    ]);
    const posLines = posData.map((p) => ({ description: p.description, amount: p.amount }));
    const cashOmzet = cashData.map((c) => ({ date: c.entry_date, amount: c.amount }));
    turnoverClosing = buildTurnoverClosing(turnover, posLines, cashOmzet);

    // [TRIANGLE] Card reconciliation (kassa ↔ terminal ↔ bank). Only meaningful when the
    // store uploaded terminal afrekeningen; otherwise the days are 'incomplete' and it is
    // still an honest evidence sheet (what ties out, what doesn't).
    const eftSettlements: EftSettlement[] = eftData.map((e) => ({
      terminalId: e.terminal_id, periodNr: e.period_nr, shiftNr: e.shift_nr,
      periodStart: e.period_start, periodEnd: e.period_end, firstTrx: e.first_trx, lastTrx: e.last_trx,
      settlementDate: e.settlement_date, grossTotal: e.gross_total ?? 0, txCount: e.tx_count ?? 0,
      byScheme: (Array.isArray(e.by_scheme) ? e.by_scheme : []) as unknown as EftSettlement["byScheme"],
    }));
    const netByDay = bankNetByDay(posData.map((p) => ({ description: p.description, amount: p.amount, date: p.date })));
    // Keep only in-quarter takings days: the ±5-day fetch buffer exists to COMPLETE an
    // end-of-quarter day whose payout lands after quarter-end (DAT still in-quarter), not to
    // add prev/next-quarter rows to an accountant-facing sheet. Matches /api/result exactly.
    for (const k of [...netByDay.keys()]) if (k < start || k > end) netByDay.delete(k);
    // [LEDGER · Leg-A witness] The bookkeeper's PIN grootboek (ledger_daily kind='pin') as an
    // independent GROSS cross-check — fed to the triangle ONLY as pinLedgerByDay (a break on
    // mismatch), never a money source. In-quarter days only, matching /api/result.
    const pinLedgerRows = await fetchAllRows<{ ledger_date: string; received: number | null; spent: number | null }>((from, to) =>
      supabase.from("ledger_daily").select("ledger_date, received, spent")
        .eq("user_id", ownerId).eq("kind", "pin")
        .gte("ledger_date", start).lte("ledger_date", end)
        // [PAGE-KEY] ledger_date is unique per (user, date, KIND) — up to four rows a day — so a
        // .range() page boundary is not stable over it alone: ties may come back in a different
        // order per query, repeating some days and dropping others. The id makes the order total.
        .order("ledger_date", { ascending: true }).order("id", { ascending: true }).range(from, to)).catch(() => []);
    // NET PIN (received − spent) — matches /api/result and the till's net-of-refunds pin_amount.
    const pinLedgerByDay = new Map<string, number>();
    for (const r of (pinLedgerRows ?? [])) if (r.ledger_date) pinLedgerByDay.set(r.ledger_date, (Number(r.received) || 0) - (Number(r.spent) || 0));
    const tri = reconcileTriangle({ turnover, eftSettlements, bankNetByDay: netByDay, pinLedgerByDay });
    // Only attach when there is a card figure to show (a terminal settlement or a payout).
    if (eftSettlements.length > 0 || netByDay.size > 0) cardReconciliation = tri;
  }

  // ── [AANGIFTE] Concept BTW-aangifte — the SAME figures as the app's aangifte screen ──
  // Computed via the one reconciliation engine (computeResult), so the ZIP and the app
  // never diverge. The aangifte's rubriek BTW still comes only from invoices + rated cash +
  // turnover — a bank line carries no BTW document. But a bank line categorized
  // 'omzet'/'pos_income' with no invoice or Z-report IS revenue with no rate, and must be
  // surfaced as omzet-zonder-tarief here too (not silently dropped), so the ZIP matches
  // /api/result and /api/readiness. The covered-days set excludes takings the till counted.
  // [PAGINATION] Busy shops book many cash entries a quarter — page past the cap so the
  // reconciliation engine sees every one (a dropped row understates omzet/kosten).
  const cashAllRows = await fetchAllRows<{
    direction: string; amount: number | null; category: string | null; btw_rate: number | null; entry_date: string | null; document_id: string | null;
  }>((from, to) =>
    liveCash.only(supabase
      .from("cash_entries")
      .select("direction, amount, category, btw_rate, entry_date, document_id")
      .eq("user_id", ownerId)
      .gte("entry_date", start)
      .lte("entry_date", end))
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e) => { console.error("[CLOSING-PACKAGE] cash_entries read failed", { ownerId, error: String(e) }); return null; });
  // [NO-EMPTY-LEDGER] Een mislukte lezing werd hier een LEGE la, en een lege la rekent gewoon
  // door: de concept-aangifte kwam eruit alsof de ondernemer dat kwartaal geen cent contant had
  // omgezet. De boekhouder kreeg een pakket dat er compleet uitzag. Dat is de gevaarlijkste vorm
  // die dit product kent — niet een ontbrekend bestand (dat zie je), maar een compleet ogend
  // bestand met een been eraf.
  const cashReadFailed = cashAllRows == null;
  const cashEntries: ResultCashEntry[] = (cashAllRows ?? []).map((c) => ({
    direction: c.direction === "in" ? "in" : "out",
    amount: c.amount,
    category: c.category,
    btw_rate: c.btw_rate,
    date: c.entry_date,
    document_id: c.document_id ?? null, // [CASH-COST-VAT] documented cash cost → voorbelasting
  }));

  // [PACKAGE-VOORBELASTING-KAS] The same loss on the cash side. Computed from the entries already
  // read above — no extra query, and it can only ever agree with the figures in this same ZIP.
  const cashNoReceipt = cashCostsWithoutReceipt(cashEntries);
  const cashNoReceiptWarning = cashCostWithoutReceiptWarning(cashNoReceipt.count, cashNoReceipt.total);
  if (cashNoReceiptWarning) warnings.push(cashNoReceiptWarning);
  // [PAGINATION] Same for bank lines — a quarter of a busy account can exceed 1000 rows.
  const bankAllRows = await fetchAllRows<{
    amount: number | null; category: string | null; invoice_id: string | null; date: string | null; description: string | null;
  }>((from, to) =>
    supabase
      .from("bank_transactions")
      .select("amount, category, invoice_id, date, description, counterpart_name")
      .eq("user_id", ownerId)
      .gte("date", start)
      .lte("date", end)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e) => { console.error("[CLOSING-PACKAGE] bank_transactions read failed", { ownerId, error: String(e) }); return null; });
  // [NO-EMPTY-LEDGER] Zie hierboven: geen bankregels lezen is iets heel anders dan geen
  // bankregels hebben, en het concept mag die twee niet door elkaar halen.
  const bankReadFailed = bankAllRows == null;
  // [SETTLE] Shared mapper — identical card-settlement de-dup to /api/result, /api/aangifte and
  // /api/readiness, incl. flagging an acquirer payout mis-tapped as 'omzet' so the closing
  // package never double-counts a covered-day card settlement.
  const bankForResult: ResultBankTx[] = (bankAllRows ?? []).map(toResultBankTx);
  // [RUBRIEK-SPLIT] The accountant's package must show the same rubrieken as the aangifte the
  // owner files, so a mixed-rate sales invoice is split by its own lines here too. Only invoices
  // whose lines add up to their header are split; everything else keeps the header-derived rate.
  // [VRIJGESTELD] And the same exempt regime, from the same shared collector, for the same
  // reason: the package the accountant receives may not contradict the concept the owner saw.
  const typedAll = all as Array<{ id?: string; direction: string | null; total_ex_btw: number | null; btw_amount: number | null }>;
  const exemption = await collectVatExemption({
    client: supabase as unknown as Parameters<typeof collectVatExemption>[0]["client"],
    ownerId,
    periodStart: start,
    incomingInvoiceIds: typedAll.filter((i) => i.direction === "incoming").map((i) => i.id).filter((id): id is string => !!id),
  });
  const { rateShares: rateSharesByInvoice, exemptExByInvoice } = await fetchRateShares(
    supabase as unknown as Parameters<typeof fetchRateShares>[0],
    typedAll.filter((i) => i.direction !== "incoming"),
    { exemptRegime: exemption.active },
  );
  const invoicesForResult: ResultInvoice[] = all.map((i) => ({
    direction: i.direction as "outgoing" | "incoming" | null,
    status: i.status,
    total_ex_btw: i.total_ex_btw,
    btw_amount: i.btw_amount,
    rate_lines: (i as { id?: string }).id ? rateSharesByInvoice.get((i as { id: string }).id) ?? null : null,
    exempt_ex: (i as { id?: string }).id ? exemptExByInvoice.get((i as { id: string }).id) ?? null : null,
    vat_deduction: (i as { id?: string }).id ? exemption.deductionByInvoice.get((i as { id: string }).id) ?? null : null,
  }));
  // [COVERED-BUFFER] Build from the BUFFERED set (incl. up to 5 pre-quarter days) so a
  // settleExact card line paying a previous-quarter till day is suppressed — matching aangifte.
  const coveredDates = new Set(
    allTurnover.filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0).map((t) => t.turnover_date),
  );
  const coveredBudget = new Map(
    allTurnover.filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0).map((t) => [t.turnover_date, cardBudgetBound(t)] as const),
  );
  // [KASSTELSEL] The concept aangifte in the ZIP must match the app: under cash basis the BTW is
  // on the PAID date. Resolve the scheme for this quarter and, under kas, feed the settlement
  // events to computeResult (the raw invoice-list evidence stays invoice-date — that's a list, not
  // a computed figure). Default factuur → byte-identical.
  const kasResolution = await resolveSchemeSettlements(supabase, ownerId, start, start, end, exemption.active);
  // [TRIANGLE-ZERO] The 6th argument is the acquirer commission, and 0 here is deliberate.
  //
  // This call feeds ONLY the BTW side of the package: salesByRate, cashOmzetZonderBtw and
  // btwVoorbelasting (see the three reads below). The commission is a cost with NO BTW, so it
  // cannot move a single figure this package reports — while /api/result, which DOES report
  // profit, books it via commissionActuallyBooked in compute-result-range.ts.
  //
  // Written down because the bare 0 reads like an omission: the same file runs reconcileTriangle
  // a few hundred lines up, so "the triangle is computed but not passed on" looks exactly like a
  // bug. It is not — but it WOULD become one the day this package starts reporting kosten or
  // winst. If that day comes, this argument has to change with it.
  // [RUBRIEK-SPLIT · SCHEME-MERGE] MERGE, never overwrite — identical to /api/aangifte:185-197.
  //
  // The three maps below cover the invoices DATED in this quarter; kasResolution.opts carries the
  // ones its SETTLEMENTS point at, which under kas routinely includes invoices from earlier
  // quarters that were paid in this one. Spreading kasResolution.opts and then assigning the three
  // keys REPLACED the settled half of each map, so the ZIP and the app disagreed on the same
  // quarter: a sale invoiced last quarter and paid in this one lost its rate split (whole omzet
  // into one rubriek), lost its exempt share (vrijgestelde omzet declared as taxed), and lost its
  // cost attribution (an attributed cost falling back to the pro-rata bucket). The accountant's
  // package is the document a human signs — it may not be the one that is wrong.
  const result = computeResult(invoicesForResult, bankForResult, cashEntries, turnover, coveredDates, 0, coveredBudget, {
    ...mergeSchemeOpts(kasResolution.opts, {
      rateSharesByInvoice,
      exemptShareByInvoice: exemptShareOf(typedAll, exemptExByInvoice),
      deductionByInvoice: exemption.deductionByInvoice,
    }),
    exemptRegime: exemption.active,
  });
  const completeness: AangifteCompleteness = {
    turnoverDays: turnover.length,
    quarterDays: daysInQuarter(year, quarter),
    incomingInvoiceCount: incoming.length,
    outgoingInvoiceCount: outgoing.length,
    hasEuPurchase: incoming.some(
      (i) => typeof i.client_btw_number === "string" && EU_VAT.test(i.client_btw_number.trim()),
    ),
  };
  // [REGIME-FLAGS] Special regimes the concept can't auto-compute (KOR active / BTW verlegd /
  // margeregeling). KOR is owner-declared; verlegd/marge are phrase-gated on the owner's own
  // invoice-line texts (tenant-safe fetch by invoice_id). Each becomes BOTH a note on the concept
  // and a "Let op" warning in the overzicht, so the accountant sees the handoff next to the
  // evidence. This is exactly the "accountant-handoff" the package exists for.
  const regimeInvoices: RegimeInvoiceRef[] = all.map((i) => ({
    id: i.id,
    direction: i.direction === "incoming" ? "incoming" : "outgoing",
    label: i.invoice_number,
  }));
  // [NO-EMPTY-LEDGER] Bij een mislukte grootboeklezing is de omzet waarop de KOR-drempel wordt
  // getoetst te laag, en zou een terechte drempelwaarschuwing juist ONDERDRUKT worden. Dan liever
  // helemaal niet toetsen dan geruststellen op een half getal.
  const ledgerReadFailed = cashReadFailed || bankReadFailed;
  const omzetForKorCheck =
    result.salesByRate.reduce((sum, r) => sum + (r.omzet ?? 0), 0) + (result.cashOmzetZonderBtw ?? 0);
  const regimeFlags = ledgerReadFailed
    ? []
    : await collectRegimeFlags({
        client: supabase, korActive, omzetForKorCheck, invoices: regimeInvoices,
      }).catch(() => []);
  const regimeNotes = regimeFlags.map(regimeFlagNote);
  for (const f of regimeFlags) {
    warnings.push({ code: `regime_${f.code}`, message: regimeFlagNote(f) });
  }
  // [KASSTELSEL] Note the basis on the concept, and hard-warn on paid-but-undated money (its BTW
  // can't be placed in a quarter → the concept could be too low). The accountant sees both.
  if (kasResolution.scheme === "kas") {
    regimeNotes.push("Kasstelsel actief — de BTW is berekend op de BETAALdatum van de facturen (niet de factuurdatum).");
    if (kasResolution.undatedPaidCount > 0) {
      warnings.push({
        code: "kas_undated_paid",
        message: `${kasResolution.undatedPaidCount} betaalde factu(u)r(en) hebben geen betaaldatum — onder kasstelsel kan de betaalde BTW daardoor niet in het juiste kwartaal worden geplaatst. Koppel de bankbetaling of vul de betaaldatum in; anders is dit concept mogelijk te laag.`,
      });
      regimeNotes.push(`LET OP: ${kasResolution.undatedPaidCount} betaalde factu(u)r(en) zonder betaaldatum — concept mogelijk te laag.`);
    }
  }

  // [PACKAGE-ART29] Both sides of artikel 29 Wet OB, into the hand-over.
  //
  // These were computed for readiness and shown to the OWNER only. But art. 29 is not a tidiness
  // issue, it is money in both directions, and neither direction is settled automatically:
  //
  //   lid 7 — voorbelasting deducted on purchase invoices never paid becomes payable AGAIN. A
  //           LIABILITY, quietly growing belastingrente. bad-debt.ts calls it "the one an
  //           entrepreneur never hears about until the naheffing arrives" — and until now the
  //           one person who could have caught it, the accountant, was never told.
  //   lid 1 — BTW declared on sales invoices the customer never paid can be reclaimed. Money to
  //           GET, which is quietly left behind if nobody raises it.
  //
  // Deliberately warnings and not figures: whether a debt is truly uncollectible, and in which
  // period to settle it, is the accountant's judgement. The package never books either one — same
  // discipline as the rest of this file, which reports raw numbers and computes no vat_due.
  //
  // Same threshold as readiness (BAD_DEBT_MIN_EUR) so the owner's screen and this package can
  // never name two different amounts. Fail-soft: a failed read drops the check, not the ZIP.
  const clawback = await collectVatClawback(supabase, ownerId, kasResolution.scheme, end, korActive)
    .catch(() => null);
  if (clawback && clawback.eligible.length > 0 && clawback.totalRepayableBtw >= BAD_DEBT_MIN_EUR) {
    warnings.push({
      code: "vat_clawback_art29_7",
      message:
        `${clawback.eligible.length} inkoopfactu(u)r(en) staan meer dan een jaar na de vervaldatum open. De ` +
        `voorbelasting daarop (${formatEuroNL(clawback.totalRepayableBtw)}) wordt weer verschuldigd ` +
        `(art. 29 lid 7 Wet OB) en is hier NIET verrekend. Zijn ze wél betaald, dan vervalt dit.`,
    });
  }
  const badDebt = await collectBadDebt(supabase, ownerId, kasResolution.scheme, end)
    .catch(() => null);
  if (badDebt && badDebt.eligible.length > 0 && badDebt.totalReclaimableBtw >= BAD_DEBT_MIN_EUR) {
    warnings.push({
      code: "bad_debt_art29_1",
      message:
        `${badDebt.eligible.length} verkoopfactu(u)r(en) staan meer dan een jaar na de vervaldatum open. De ` +
        `afgedragen BTW daarop (${formatEuroNL(badDebt.totalReclaimableBtw)}) is terug te vragen ` +
        `(oninbare vordering, art. 29 Wet OB) en is hier NIET verrekend.`,
    });
  }

  // Only emit a concept when there is something to declare — sales, unrated cash omzet,
  // or reclaimable voorbelasting. An empty quarter gets no invented filing.
  const hasDeclarable =
    result.salesByRate.length > 0 || result.cashOmzetZonderBtw > 0 || result.btwVoorbelasting > 0;
  // [ICP] Sales to businesses in other EU member states belong in rubriek 3b, and carry a
  // SEPARATE declaration (the ICP-opgaaf) that is no part of the BTW-aangifte. Built here from
  // the same rows the rubrieken are, so the ZIP and the in-app concept can never disagree — the
  // whole reason this package rebuilds the concept instead of importing it.
  const icp = buildIcp({
    korActive,
    invoices: outgoing.map((i): IcpInvoice => ({
      invoiceNumber: i.invoice_number,
      clientName: i.client_name,
      clientVatNumber: i.client_btw_number,
      direction: "outgoing",
      status: i.status,
      totalExBtw: i.total_ex_btw,
      btwAmount: i.btw_amount,
    })),
  });
  const icNote = icpNote(icp);
  if (icNote) regimeNotes.push(icNote);
  // [PRIVEGEBRUIK] Rubriek 1d is not computed anywhere in this app — say so, and say it before
  // Q4 too, because the records that substantiate it can only be kept DURING the year.
  regimeNotes.push(privegebruikNote(quarter));
  if (icp.problems.length > 0) {
    warnings.push({
      code: "icp_problems",
      message:
        `ICP-opgaaf: ${icp.problems.length} verkoopfactu(u)r(en) aan EU-ondernemers kunnen zo niet worden opgegeven ` +
        "(BTW berekend, of een BTW-nummer dat niet klopt) — zie concept-icp-opgaaf.csv.",
    });
  }

  // [ICP] The purchase mirror: EU inkopen NAMED for the accountant, never computed.
  const euPurchases = buildForeignPurchases({
    invoices: incoming.map((i): IcpInvoice => ({
      invoiceNumber: i.invoice_number,
      clientName: i.client_name,
      clientVatNumber: i.client_btw_number,
      direction: "incoming",
      status: i.status,
      totalExBtw: i.total_ex_btw,
      btwAmount: i.btw_amount,
    })),
  });

  // [NO-EMPTY-LEDGER] Kon een grootboek niet worden gelezen, dan komt er GEEN concept mee. Een
  // concept-aangifte is een optelsom die pretendeert compleet te zijn; met een ontbrekend been is
  // dat een onwaarheid met een bedrag eraan. De boekhouder krijgt in plaats daarvan de reden, en
  // alle échte bewijsstukken — de factuur-PDF's, het bankafschrift, dagomzet.csv — blijven
  // gewoon in het pakket zitten. Kijken en exporteren blijft altijd werken; alleen de PROJECTIE
  // die niet klopt, ontbreekt.
  if (cashReadFailed) {
    warnings.push({
      code: "cash_read_failed",
      message: "De kasboekingen konden niet volledig worden gelezen. Daarom zit er geen concept-BTW-aangifte in dit pakket — die zou het contante deel missen. De facturen en bestanden zijn wel compleet. Genereer het pakket opnieuw.",
    });
  }
  if (bankReadFailed) {
    warnings.push({
      code: "bank_read_failed",
      message: "De bankregels konden niet volledig worden gelezen. Daarom zit er geen concept-BTW-aangifte in dit pakket — die zou bankmutaties missen. De facturen en bestanden zijn wel compleet. Genereer het pakket opnieuw.",
    });
  }
  const conceptAangifte = hasDeclarable && !ledgerReadFailed
    ? buildAangifte(
        { ...result, intraEuOmzet: icp.totalExBtw },
        { ...completeness, euPurchaseNote: foreignPurchaseNote(euPurchases) },
        `Q${quarter} ${year}`, regimeNotes,
      )
    : null;

  // [KASBOEK] The cash book as the accountant's own running-balance sheet (Kiwi .xlsx layout),
  // NOT a flat dump. It is a pure PROJECTION over the truth layer — the till's daily CASH takings
  // (daily_turnover.cash_amount) + the cash-book movements — with the running drawer balance per
  // day (Beginsaldo · Uitgaven · Ontvangsten · Eindsaldo). It books NOTHING into the P&L (the
  // omzet is already counted once by the turnover engine), so there is no double-count with the
  // concept aangifte. Same generator as the live /api/kasboek endpoint and the in-app screen.
  //
  // The Beginsaldo must carry from ALL prior periods, so the projection is fed the FULL history
  // up to quarter-end (two small owner-scoped queries), not just this quarter's rows.
  const kasEntriesRaw = await fetchAllRows<{
    entry_date: string | null; direction: string; amount: number | null; category: string | null; description: string | null;
  }>((from, to) =>
    liveCash.only(supabase.from("cash_entries").select("entry_date, direction, amount, category, description")
      .eq("user_id", ownerId).lte("entry_date", end))
      // [PAGE-KEY] Ordered by id, not entry_date — the same read on /api/kasboek already says why,
      // and this copy is the one that did not: entry_date is NOT unique (several cash entries on
      // one day is the ordinary case for a shop), Postgres gives no defined order among ties, so
      // across separate .range() windows a row can be served twice or skipped. In a RUNNING
      // balance that does not spoil one day — it shifts every eindsaldo after it.
      //
      // Which makes THIS the worse of the two places to have missed it. The live screen the owner
      // can compare against reality was correct; the sheet handed to the accountant was not, and
      // it is the one nobody cross-checks. The pure builders group by day and sort themselves, so
      // the read order is free.
      //
      // The daily_turnover read below deliberately gets NO tiebreaker: it carries
      // UNIQUE (user_id, turnover_date), so within one owner's query the date already IS a total
      // order and adding one would suggest a hazard that is not there.
      .order("id", { ascending: true }).range(from, to),
  ).catch((e) => { console.error("[CLOSING-PACKAGE] kasboek entries read failed", { ownerId, error: String(e) }); return null; });
  const kasEntries: KasEntry[] = (kasEntriesRaw ?? []).map((r) => ({
    entry_date: r.entry_date, direction: r.direction === "in" ? "in" : "out",
    amount: r.amount, category: r.category, description: r.description,
  }));
  const kasTurnoverRaw = await fetchAllRows<{ turnover_date: string; cash_amount: number | null }>((from, to) =>
    supabase.from("daily_turnover").select("turnover_date, cash_amount")
      .eq("user_id", ownerId).lte("turnover_date", end)
      .order("turnover_date", { ascending: true }).range(from, to),
  ).catch((e) => { console.error("[CLOSING-PACKAGE] kasboek turnover read failed", { ownerId, error: String(e) }); return null; });
  const kasTurnover: KasTurnoverDay[] = (kasTurnoverRaw ?? []) as KasTurnoverDay[];
  // [NO-EMPTY-LEDGER] Het kasboek is een LOPEND SALDO. Faalt één van de twee bronnen, dan telt
  // het blad de ene kant wel en de andere niet, en komt er een eindsaldo uit dat niemand kan
  // verklaren en dat niet strookt met de Kas-pagina — een blad met ontvangsten en zonder uitgaven
  // ziet er bovendien uit als winst. Dan liever helemaal geen blad, met de reden erbij.
  // [KAS-OPENING] Seed the first period with the drawer's starting float so the accountant's
  // Kasboek eindsaldo matches the app's headline saldo and reality.
  // [NO-EMPTY-LEDGER] …and its read counts as one of the two sources: a swallowed error becomes a
  // silent €0 float, and the sheet then opens on a balance that is wrong by exactly the money the
  // till started with — the unexplainable eindsaldo this guard exists to keep out of the package.
  const { data: kasProf, error: kasProfErr } = await supabase.from("profiles").select("kas_opening_balance").eq("id", ownerId).maybeSingle();
  if (kasProfErr) console.error("[CLOSING-PACKAGE] kas opening balance read failed", { ownerId, error: kasProfErr.message });
  const kasboekReadFailed = kasEntriesRaw == null || kasTurnoverRaw == null || kasProfErr != null;
  const kasStartingBalance = Number((kasProf as { kas_opening_balance?: number | null } | null)?.kas_opening_balance ?? 0) || 0;

  // Only emit the sheet when the drawer has any life this quarter (takings or movements).
  const kb = buildKasboek({
    turnover: kasTurnover, entries: kasEntries, year, quarter: quarter as KasQuarter,
    openingBalance: openingBalanceForQuarter({ turnover: kasTurnover, entries: kasEntries, year, quarter: quarter as KasQuarter, startingBalance: kasStartingBalance }),
  });
  // [KAS-SPOOR] The movements this quarter's cash book HELD and no longer holds, appended below the
  // eindsaldo and inside none of the totals.
  //
  // It belongs in THIS copy of the sheet more than in the screen's: a cash_entries delete is a hard
  // delete, so nothing in the rows the accountant receives says a line was ever taken out — and this
  // is the document they reconcile a till against. The live /api/kasboek shows the same block, and
  // the two must not disagree about a period; that is the whole reason both call one generator.
  //
  // A failed read does NOT suppress the sheet, unlike the three sources above. Those DECIDE the
  // saldi, so half of them is a wrong number presented as a right one; this is a disclosure
  // alongside them and the balances are complete without it. The warning says what is missing
  // instead, so the accountant is never left thinking a quiet list means nothing was removed.
  const { data: kasTrail, error: kasTrailErr } = await supabase
    .from("audit_logs")
    .select("old_value, created_at")
    .eq("user_id", ownerId)
    .eq("action", "cash.entry_removed")
    .order("created_at", { ascending: false })
    .limit(500);
  if (kasTrailErr) console.error("[KAS-SPOOR] closing-package removed-entry trail unreadable", { ownerId, error: kasTrailErr.message });
  const kasRemoved: RemovedKasEntry[] = removedInQuarter(
    (kasTrail ?? []).flatMap((r) => {
      const o = (r as { old_value?: Record<string, unknown> | null }).old_value ?? null;
      const date = o && typeof o.entry_date === "string" ? o.entry_date.slice(0, 10) : null;
      const amount = Math.abs(Number(o?.amount) || 0);
      if (!o || !date || amount === 0) return [];
      return [{
        date,
        direction: o.direction === "in" ? ("in" as const) : ("out" as const),
        amount,
        category: typeof o.category === "string" ? o.category : null,
        description: typeof o.description === "string" ? o.description : null,
        removedOn: typeof (r as { created_at?: string | null }).created_at === "string"
          ? (r as { created_at: string }).created_at.slice(0, 10)
          : null,
      }];
    }),
    year,
    quarter as KasQuarter,
  );
  if (kasTrailErr || (kasTrail ?? []).length >= 500) {
    warnings.push({
      code: "kasboek_removals_incomplete",
      message:
        "In het kasboek staat onderaan welke kasboekingen uit dit kwartaal zijn verwijderd. Die lijst konden we nu niet volledig nalezen, dus hij kan onvolledig zijn. De saldi in het blad zijn wel compleet — verwijderde regels tellen daar niet in mee.",
    });
  }

  const kasboekXlsx: Uint8Array | null =
    !kasboekReadFailed && (kb.months.length > 0 || kb.openingBalance !== 0)
      ? matrixToXlsxBytes(kasboekToMatrix(kb, kasRemoved), `Kasboek Q${quarter} ${year}`)
      : null;
  if (kasboekReadFailed) {
    warnings.push({
      code: "kasboek_unavailable",
      message: "Het kasboek kon niet volledig worden gelezen en zit daarom niet in dit pakket — een half kasboek zou een eindsaldo tonen dat nergens op slaat. De facturen en bestanden zijn wel compleet. Genereer het pakket opnieuw.",
    });
  }

  return assembleClosingPackageZip({
    year,
    quarter,
    clientName,
    outgoing,
    incoming,
    pdfByInvoice,
    xmlByInvoice,
    bankFiles,
    kilometerFiles: [], // not a feature yet; passthrough hook reserved
    sharedFiles,
    paymentDates,
    hasBankData,
    turnoverClosing,
    cardReconciliation,
    conceptAangifte,
    icp,
    euPurchases,
    kasboekXlsx,
    warnings,
  });
}