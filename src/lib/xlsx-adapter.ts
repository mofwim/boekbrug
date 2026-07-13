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
