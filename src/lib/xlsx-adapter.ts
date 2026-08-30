// src/lib/xlsx-adapter.ts
// [TURNOVER-IMPORT] The ONE module that imports SheetJS. It turns raw file bytes into a
// plain cell matrix and nothing more; the pure normalizer (turnover-import.ts) takes it
// from there. This isolation is deliberate and load-bearing: the parser is replaceable,
// and the normalizer + analytics + reconciliation never depend on Excel/CSV at all. If
// SheetJS is ever swapped (or a native CSV path added), only this file changes.

import * as XLSX from "xlsx";
import type { Cell } from "./turnover-import";
import { sniffReadableMime } from "./detect-file";

// ─────────────────────────────────────────────────────────────────────────────
// [SEC-XLSX / C1] Containment for the two known SheetJS CVEs.
//
// The pinned parser is xlsx@0.18.5, which carries:
//   · CVE-2023-30533 — prototype pollution (CVSS 7.8), fixed upstream in 0.19.3
//   · CVE-2024-22363 — ReDoS / CPU exhaustion (CVSS 7.5), fixed upstream in 0.20.2
//
// WHY IT IS STILL 0.18.5: SheetJS left the public npm registry. `npm view xlsx
// versions` ends at 0.18.5 and `npm audit` reports fixAvailable:false, because
// the fixed releases exist ONLY on the vendor's own CDN. The upgrade is
// therefore a dependency-SOURCE change, not a version bump:
//
//     npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
//
// Do that as soon as an environment with access to cdn.sheetjs.com can run it,
// then re-run `npm audit`. See docs/BoekBrug_Security_Hunt_Report.md → C1.
//
// TRIED, 7 August 2026: cdn.sheetjs.com is refused by the agent proxy's network
// policy (403 on CONNECT). Not a transient failure and not something to work
// around — it needs an environment whose policy allows that host, or the tarball
// carried in by hand. Written down so the next reader spends a minute on it
// rather than an hour: the command above is right, the network is the blocker.
//
// Everything else in this repo's audit is now clean (15 findings → 1, and this
// is the 1). That makes this the only known-vulnerable dependency we ship, which
// is worth knowing when weighing the guards below against the upgrade.
//
// UNTIL THEN — and as defence in depth AFTERWARDS — every untrusted parse goes
// through the guards below. This module is the ONE place that imports SheetJS,
// and all six server routes that parse uploads (turnover import, ledger import,
// intake, documents/reprocess, bank upload, intake's bank branch) funnel
// through sheetBytesToMatrix, so guarding here covers the whole attack surface.
//
// HONEST SCOPE — what these guards do and do not do:
//   ✅ CVE-2023-30533: the IMPACT is contained. Pollution cannot persist: any
//      property the parse adds to a shared prototype is detected, deleted, and
//      the upload rejected. Without this, one crafted file corrupts
//      Object.prototype for the whole Node process and every subsequent request
//      served by it — the worst property of this CVE is that it outlives the
//      request that caused it, and that is exactly what is removed here.
//   ⚠️ CVE-2024-22363: only BOUNDED, not fixed. The ReDoS burns CPU inside a
//      synchronous XLSX.read that nothing in-process can interrupt. The size
//      ceiling below limits how much work a single upload can ask for; the real
//      fix is the upgrade above. Do not read these guards as "C1 is closed".
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard ceiling on bytes handed to SheetJS.
 *
 * Deliberately ABOVE the 10MB the upload routes already enforce, because this
 * is a backstop, not the primary limit: it must never reject a file a route
 * legitimately accepted. Its job is the routes that have NO limit of their own
 * (intake, documents/reprocess, bank-ingest all reach the parser directly).
 */
export const MAX_PARSE_BYTES = 20 * 1024 * 1024;

/** Exported for tests — takes a length so a test need not allocate 20MB. */
export function assertWithinParseLimit(byteLength: number): void {
  if (byteLength > MAX_PARSE_BYTES) {
    throw new Error(
      `[SEC-XLSX] file too large to parse safely (${byteLength} bytes > ${MAX_PARSE_BYTES})`
    );
  }
}

/**
 * Shared prototypes a polluting payload would target. Object.prototype is the
 * classic one; Array and Function are included because they are just as shared
 * and just as damaging, and checking them is free.
 */
const GUARDED_PROTOTYPES: ReadonlyArray<readonly [string, object]> = [
  ["Object", Object.prototype],
  ["Array", Array.prototype],
  ["Function", Function.prototype],
];

/**
 * Run `fn` and refuse to let it leave anything behind on a shared prototype.
 *
 * Exported for tests only — production callers get it via sheetBytesToMatrix.
 *
 * The check runs in `finally`, so it also fires when the parse THREW: a crash
 * part-way through a malicious file does not undo whatever it already wrote,
 * and the existing `try/catch` in every caller would otherwise swallow the
 * failure and leave the process quietly corrupted.
 *
 * On detection it deletes the injected keys and throws. Throwing is safe and
 * intended: all six callers already wrap this in try/catch and degrade to a
 * clean "kon het bestand niet lezen" (422) or skip the file — never a 500.
 * A file that pollutes prototypes is an attack, and the right answer is to
 * refuse it loudly rather than parse it.
 */
export function withPrototypeGuard<T>(fn: () => T): T {
  const before = GUARDED_PROTOTYPES.map(([, proto]) => new Set(Reflect.ownKeys(proto)));

  try {
    return fn();
  } finally {
    const injected: string[] = [];

    GUARDED_PROTOTYPES.forEach(([name, proto], i) => {
      for (const key of Reflect.ownKeys(proto)) {
        if (before[i].has(key)) continue;
        injected.push(`${name}.prototype.${String(key)}`);
        try {
          delete (proto as Record<PropertyKey, unknown>)[key];
        } catch {
          // Non-configurable: it cannot be removed. Still reported below, and
          // the throw stops the poisoned data from being used.
        }
      }
    });

    if (injected.length > 0) {
      // Survives the production console-stripping in next.config.ts, which
      // preserves console.error precisely for diagnostics like this one.
      console.error("[SEC-XLSX] prototype pollution attempt detected and reverted:", injected);
      // Thrown from `finally`, so it deliberately replaces any parse error —
      // "this file attacked us" is the more important truth to surface.
      throw new Error(
        `[SEC-XLSX] rejected: file attempted prototype pollution (${injected.join(", ")})`
      );
    }
  }
}

/** Raw file bytes (xls/xlsx/csv) → a rectangular cell matrix (array of rows of cells). */
/**
 * [GEEN-SPREADSHEET] What this file is, when it is plainly not a spreadsheet.
 *
 * SheetJS does not refuse a PDF. Handed one it returns rows — 296 of them from a 20KB
 * grootboek PDF, 2.569 from a 315KB kassarapport — parsed out of binary noise. Nothing
 * downstream booked those (parseLedgerSheet found no Datum/Ontvangen/Uitgaven header and
 * returned null), so no wrong figure ever reached the books. What DID reach the owner was
 * this sentence:
 *
 *     "Geen herkenbare grootboek-export (Datum / Ontvangen / Uitgaven) gevonden."
 *
 * …about a file that is a grootboek export and does carry those three columns. The message
 * blamed the content when the problem was the FORMAT, so the one thing the owner needed to
 * know — ask for the same export as Excel — was the one thing it did not say. A refusal that
 * misnames its own reason sends someone to check the wrong thing.
 *
 * Refusing at the parser rather than in each route is deliberate: six callers reach
 * sheetBytesToMatrix and only bank-ingest.ts checked the type first. One guard, or five more
 * chances to forget.
 */
export class NotASpreadsheetError extends Error {
  constructor(readonly mime: string) {
    super(`not_a_spreadsheet:${mime}`);
    this.name = "NotASpreadsheetError";
  }
}

export function sheetBytesToMatrix(bytes: Uint8Array): Cell[][] {
  // [GEEN-SPREADSHEET] A PDF or an image is not a spreadsheet with problems — it is a
  // different kind of file, and saying so is the whole difference between a useful refusal
  // and a puzzling one. CSV and every real sheet format sniff as null here and pass through
  // untouched, so this refuses only what SheetJS should never have been handed.
  const mime = sniffReadableMime(bytes);
  if (mime) throw new NotASpreadsheetError(mime);
  // [SEC-XLSX] Bound the work before SheetJS sees a single byte, then contain
  // anything the parse tries to leave on a shared prototype. See the block above.
  assertWithinParseLimit(bytes.byteLength);
  return withPrototypeGuard(() => parseSheetBytes(bytes));
}

function parseSheetBytes(bytes: Uint8Array): Cell[][] {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const firstName = wb.SheetNames[0];
  if (!firstName) return [];
  const sheet = wb.Sheets[firstName];
  // [H2] sheet_to_json densifies the whole DECLARED range (!ref). A ~10KB file can declare
  // <dimension ref="A1:XFD1048576"/> (16384×1048576) with two real cells and force a multi-
  // GB allocation → server OOM that the caller's try/catch cannot stop. Clamp the declared
  // range to a sane ceiling first. Real turnover/bank sheets are small and their data sits
  // at the top-left, so clamping never drops a legitimate cell.
  if (sheet && typeof sheet["!ref"] === "string") {
    const MAX_ROWS = 100000, MAX_COLS = 200;
    try {
      const range = XLSX.utils.decode_range(sheet["!ref"] as string);
      if (range.e.r - range.s.r > MAX_ROWS || range.e.c - range.s.c > MAX_COLS) {
        range.e.r = Math.min(range.e.r, range.s.r + MAX_ROWS);
        range.e.c = Math.min(range.e.c, range.s.c + MAX_COLS);
        sheet["!ref"] = XLSX.utils.encode_range(range);
      }
    } catch {
      // A malformed !ref — leave it; sheet_to_json will just read what it can.
    }
  }
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,        // array-of-arrays, not keyed objects
    raw: true,        // keep numbers as numbers
    defval: null,     // fill gaps so column indices stay aligned
    blankrows: false,
  });
  return grid.map((row) => (Array.isArray(row) ? row.map(normCell) : []));
}

/** Collapse a SheetJS cell to the normalizer's Cell union (Date → ISO 'YYYY-MM-DD'). */
function normCell(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}

/** A rectangular matrix (header row + data rows) → .xlsx file bytes. The mirror of
 *  sheetBytesToMatrix, used by the "bankafschrift naar Excel" converter to hand the
 *  owner a real spreadsheet. Numbers stay numeric so Excel treats them as amounts;
 *  a light column-width pass keeps the sheet readable. */
export function matrixToXlsxBytes(rows: (string | number)[][], sheetName = "Transacties"): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Column widths from the longest cell in each column (capped), so nothing is clipped.
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
  ws["!cols"] = Array.from({ length: colCount }, (_, c) => {
    let w = 8;
    for (const r of rows) w = Math.max(w, String(r[c] ?? "").length + 2);
    return { wch: Math.min(w, 48) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(out);
}
