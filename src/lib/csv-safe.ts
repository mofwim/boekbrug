// src/lib/csv-safe.ts
// [CSV-SAFE] One neutraliser for every CSV cell that a THIRD PARTY may open in Excel or
// LibreOffice (accountant exports, GDPR download). Two protections in one place so the
// rule can never drift between builders:
//   1. RFC-4180 quoting — a cell containing the delimiter, a quote or a newline is wrapped
//      in double quotes with internal quotes doubled.
//   2. FORMULA-INJECTION neutralisation — a cell that STARTS with = + - @ (or a tab/CR that
//      some tools treat as a formula lead) is prefixed with a single quote, so a hostile
//      client/vendor name like =HYPERLINK("http://evil","ok") is shown as text, never run.
// The pattern already lived inline in api/kluis/export and bank-csv; this is the shared
// version for the invoice/account exports that lacked it.
export function csvCell(v: unknown, delimiter = ";"): string {
  let s = v == null ? "" : String(v);
  // Formula lead — neutralise BEFORE quoting so the leading quote is inside the field.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  const needsQuote = s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r");
  return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
}
