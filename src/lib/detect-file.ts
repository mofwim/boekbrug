// src/lib/detect-file.ts
// [DETECT] Pure content sniffing so an uploaded file reaches the RIGHT parser. The store
// produces several look-alike spreadsheets/receipts; routing them by filename alone caused
// the false-green trap (a grootboek .xlsx sent to the bank endpoint was UTF-8-decoded as a
// binary ZIP → 0 transactions, looking ingested but empty). These helpers decide from the
// actual content. No I/O, fully testable (run: npx tsx src/lib/detect-file.test.ts).

import type { Cell } from "./turnover-import";

/** True when the raw bytes are a ZIP container (xlsx/ods) — never MT940/CAMT text. */
export function looksLikeSpreadsheetBinary(buffer: Uint8Array | Buffer): boolean {
  // ZIP local file header "PK\x03\x04" (xlsx/ods), or the old OLE2 .xls magic D0 CF 11 E0.
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return true;
  if (buffer.length >= 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return true;
  return false;
}

export type SheetKind = "turnover" | "ledger" | "unknown";

const norm = (v: Cell): string => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Classify a parsed spreadsheet matrix. "turnover" = a POS Z-report (has Datum + Omzet
 * incl.); "ledger" = an accounting-package grootboek/kas export (Rekening Nr, or the
 * Datum/Ontvangen/Uitgaven header). Checked over the first ~12 rows so a title/address
 * block above the header does not hide it.
 */
export function detectSheetKind(matrix: Cell[][]): SheetKind {
  const head = matrix.slice(0, 12).map((r) => (r ?? []).map(norm));
  const anyRow = (pred: (cells: string[]) => boolean) => head.some(pred);

  const hasDatum = anyRow((cs) => cs.some((c) => /^datum$/.test(c) || /^datum:?$/.test(c)));
  const hasOmzetIncl = anyRow((cs) => cs.some((c) => /omzet incl/.test(c)));
  if (hasDatum && hasOmzetIncl) return "turnover";

  const hasRekening = anyRow((cs) => cs.some((c) => /^rekening\s*nr/.test(c)));
  const hasLedgerCols = anyRow((cs) => cs.some((c) => /ontvangen/.test(c)) && cs.some((c) => /uitgaven/.test(c)));
  if (hasRekening || hasLedgerCols) return "ledger";

  return "unknown";
}

/**
 * [EMAIL→BANK] True when an email attachment's NAME looks like a machine-readable bank
 * statement (MT940 / CAMT.053 / a bank CSV export) rather than an invoice.
 *
 * WHY name-only (no bytes): the email fetcher drops these today because their MIME
 * normalises to null (not pdf/image), so they never reach the invoice classifier — and
 * we deliberately do NOT download or parse the money data here. This detector only lets
 * the pipeline SURFACE that a statement arrived (record it in the skip registry with an
 * actionable "upload it at Bank" reason) instead of dropping it silently. It NEVER causes
 * an auto-import of bank transactions — money still moves only through the reviewed Bank
 * upload flow. So a false positive is low-harm (a mislabel in the Overgeslagen list), and
 * a false negative just preserves today's silent-drop behaviour for that one odd name.
 *
 * PDFs are intentionally NOT matched: a PDF "rekeningafschrift" already reaches the AI
 * classifier, which recognises statements and records them with their own reason. This is
 * only for the accountant-grade formats that get dropped before any classification.
 */
export function looksLikeBankStatementFile(filename: string | null | undefined): boolean {
  const name = (filename || "").toLowerCase().trim();
  if (!name) return false;
  const ext = name.match(/\.([a-z0-9]+)$/)?.[1] ?? "";

  // Accountant-grade bank export formats — the extension alone is decisive. SWIFT MT940
  // (.sta/.940/.mt940) and ISO 20022 CAMT.053 (.camt/.053): nothing else uses these, and
  // the app's own bank parser reads exactly them. A PDF/image never lands here.
  if (ext === "sta" || ext === "940" || ext === "mt940" || ext === "mt9" || ext === "camt" || ext === "053") {
    return true;
  }

  // Ambiguous containers: .xml can be a UBL e-invoice, .csv/.txt can be anything. Only
  // treat them as a statement when the FILENAME clearly says so — never on the extension
  // alone — so a UBL invoice or an unrelated CSV is not mislabelled a bankafschrift.
  if (ext === "xml" || ext === "csv" || ext === "txt") {
    return /camt|mt940|afschrift|rekeningoverzicht|rekening-?overzicht|bankstatement|statement|transacties|mutaties|bij-?en-?afschrijvingen/.test(
      name,
    );
  }

  return false;
}

/**
 * True when OCR/plain text is a payment-terminal settlement receipt (Equens CTAP
 * "TOTALEN RAPPORT" with an EFT/BETALING total). Used to route a photographed receipt to
 * the EFT parser instead of the generic invoice extractor.
 */
export function looksLikeEftReceipt(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const hasMarker = /eft\s*totalen|equens|ctap|term-?id|totalen\s*rapport/.test(t);
  const hasBetaling = /betaling\s*:?\s*\d+\s+[\d.,]+/.test(t);
  return hasMarker && hasBetaling;
}
