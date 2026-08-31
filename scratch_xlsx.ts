import * as XLSX from "xlsx";
import { sheetBytesToMatrix } from "./src/lib/xlsx-adapter";
import { kasboekDate } from "./src/lib/kasboek-import";

// Build a sheet with a real Excel date cell: 2026-06-01 (serial 46174?) compute via SSF
const ws = XLSX.utils.aoa_to_sheet([["datum","bedrag"],[null,10]]);
// set B2 as a date cell with numeric serial and date format
const serial = 25569 + Math.round(Date.UTC(2026,5,1)/86400000); // 1970-01-01 = 25569
ws["A2"] = { t: "n", v: serial, z: "dd-mm-yyyy" };
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "S");
const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
const bytes = new Uint8Array(buf);

console.log("TZ =", process.env.TZ, "offsetMin", new Date().getTimezoneOffset());
console.log("serial", serial);
const raw = XLSX.read(bytes, { type: "array", cellDates: true });
const cell = raw.Sheets["S"]["A2"];
console.log("raw cell:", cell.t, cell.v, cell.v instanceof Date ? (cell.v as Date).toISOString() : "");
const m = sheetBytesToMatrix(bytes);
console.log("matrix A2 =", JSON.stringify(m[1][0]));
console.log("kasboekDate =", kasboekDate(m[1][0] as never));
