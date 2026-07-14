// src/lib/xlsx-adapter.ts
// [TURNOVER-IMPORT] The ONE module that imports SheetJS. It turns raw file bytes into a
// plain cell matrix and nothing more; the pure normalizer (turnover-import.ts) takes it
// from there. This isolation is deliberate and load-bearing: the parser is replaceable,
// and the normalizer + analytics + reconciliation never depend on Excel/CSV at all. If
// SheetJS is ever swapped (or a native CSV path added), only this file changes.

import * as XLSX from "xlsx";
import type { Cell } from "./turnover-import";

/** Raw file bytes (xls/xlsx/csv) → a rectangular cell matrix (array of rows of cells). */
export function sheetBytesToMatrix(bytes: Uint8Array): Cell[][] {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const firstName = wb.SheetNames[0];
  if (!firstName) return [];
  const sheet = wb.Sheets[firstName];
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
