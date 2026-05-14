// lib/export.ts
// Export logic: CSV (BOEK-014) — structured for future UBL/XML (BOEK-020)

export interface InvoiceExportRow {
  invoice_number: string;
  client_name: string;
  status: string;
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
  btw_rate: number;
  invoice_date: string;
  due_date: string;
  period: string;
}

/**
 * Convert invoice rows to a CSV string.
 * Single function — called by the API route and the client download trigger.
 */
export function invoicesToCsv(rows: InvoiceExportRow[]): string {
  const headers = [
    "Factuurnummer",
    "Klant",
    "Status",
    "Bedrag excl. BTW",
    "BTW bedrag",
    "Bedrag incl. BTW",
    "BTW tarief %",
    "Factuurdatum",
    "Vervaldatum",
    "Periode",
  ];

  const escape = (v: string | number) => {
    const s = String(v ?? "");
    // Wrap in quotes if contains comma, newline, or quote
    return s.includes(",") || s.includes("\n") || s.includes('"')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [
    headers.map(escape).join(","),
    ...rows.map((r) =>
      [
        r.invoice_number,
        r.client_name,
        r.status,
        r.total_ex_btw.toFixed(2),
        r.btw_amount.toFixed(2),
        r.total_inc_btw.toFixed(2),
        r.btw_rate,
        r.invoice_date,
        r.due_date,
        r.period,
      ]
        .map(escape)
        .join(",")
    ),
  ];

  return lines.join("\r\n");
}

/**
 * Trigger a CSV file download in the browser.
 * Only import this in client components.
 */
export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
