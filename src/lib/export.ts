// lib/export.ts
// [BOEK-013] Export logic: CSV + BTW Summary — May 2026
// [BOEK-014] Export dropdown: year / status / accountant mode — May 2026
// [BOEK-014] Minor fix: exclude archived, add invoice_type column — May 2026
// Structured for future UBL/XML (BOEK-020)

import { csvCell } from "./csv-safe";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Existing interface — kept exactly as-is for backward compatibility */
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
 * Full invoice row as returned from Supabase.
 * btw_rate is NOT in DB — always calculated from btw_amount / total_ex_btw.
 * [BOEK-014] invoice_type added — 'factuur' | 'creditnota' | 'pro_forma'
 */
export interface InvRow {
  invoice_number: string | null;
  client_name: string | null;
  client_email: string | null;
  client_address: string | null;
  client_postal_code: string | null;
  client_city: string | null;
  status: string | null;
  direction: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
  total_inc_btw: number | null;
  invoice_date: string | null;
  due_date: string | null;
  created_at: string | null;
  invoice_type?: string | null; // [BOEK-014] 'factuur' | 'creditnota' | 'pro_forma'
}

/** BTW breakdown used for aangifte PDF and quarterly summary */
export interface BtwSummary {
  period: string;           // "Q1 2026"
  year: number;
  quarter: number;
  invoiceCount: number;
  totalExBtw: number;       // totale omzet excl. BTW
  btw0: number;             // omzet belast 0%
  btw9: number;             // omzet belast 9%
  btw21: number;            // omzet belast 21%
  btwBedrag0: number;       // BTW te betalen 0%
  btwBedrag9: number;       // BTW te betalen 9%
  btwBedrag21: number;      // BTW te betalen 21%
  btwTeBetalen: number;     // totaal BTW te betalen
  totalIncBtw: number;      // totale omzet incl. BTW
}

/**
 * Extended export row — includes all client fields for the full CSV.
 * [BOEK-014] invoice_type added
 */
export interface InvoiceExportRowFull extends InvoiceExportRow {
  client_email: string;
  client_address: string;
  client_postal_code: string;
  client_city: string;
  direction: string;
  invoice_type: string;       // [BOEK-014] 'factuur' | 'creditnota' | 'pro_forma'
}

// [BOEK-014] Extended row for accountant all-clients export — adds Klant column
export interface InvoiceExportRowAccountant extends InvoiceExportRowFull {
  klant_id: string; // client UUID — for grouping
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calculate BTW rate from amounts.
 * btw_rate does not exist in DB — always derive it.
 */
export function calcBtwRate(
  btw_amount: number | null,
  total_ex_btw: number | null
): number {
  if (!total_ex_btw || total_ex_btw === 0) return 0;
  // Return the TRUE derived rate here (no snapping): the raw per-invoice overview is
  // accountant-facing, and surfacing a blended/odd rate (e.g. an 8% from a 9%+statiegeld mix,
  // or a genuinely wrong 17%) lets them trace it — masking it into a clean 9% would hide it.
  // The aangifte RUBRIEK bucketing snaps to a legal rate separately (financial-result.ts).
  return Math.round(((btw_amount ?? 0) / total_ex_btw) * 100);
}

/** Format date ISO → dd-mm-yyyy (NL style) */
export function fmtDateNL(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("nl-NL");
}

/** Format number → NL amount string (no symbol) */
export function fmtAmountNL(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/** Map InvRow → InvoiceExportRow (basic) */
export function toExportRow(inv: InvRow, period: string): InvoiceExportRow {
  const exBtw = Number(inv.total_ex_btw ?? 0);
  const btwAmt = Number(inv.btw_amount ?? 0);
  return {
    invoice_number: inv.invoice_number ?? "",
    client_name: inv.client_name ?? "",
    status: inv.status ?? "",
    total_ex_btw: exBtw,
    btw_amount: btwAmt,
    total_inc_btw: Number(inv.total_inc_btw ?? 0),
    btw_rate: calcBtwRate(btwAmt, exBtw),
    invoice_date: fmtDateNL(inv.invoice_date),
    due_date: fmtDateNL(inv.due_date),
    period,
  };
}

/**
 * Map InvRow → InvoiceExportRowFull (includes all client fields).
 * [BOEK-014] invoice_type mapped here
 */
export function toExportRowFull(inv: InvRow, period: string): InvoiceExportRowFull {
  const exBtw = Number(inv.total_ex_btw ?? 0);
  const btwAmt = Number(inv.btw_amount ?? 0);
  return {
    invoice_number: inv.invoice_number ?? "",
    client_name: inv.client_name ?? "",
    client_email: inv.client_email ?? "",
    client_address: inv.client_address ?? "",
    client_postal_code: inv.client_postal_code ?? "",
    client_city: inv.client_city ?? "",
    status: inv.status ?? "",
    direction: inv.direction ?? "",
    total_ex_btw: exBtw,
    btw_amount: btwAmt,
    total_inc_btw: Number(inv.total_inc_btw ?? 0),
    btw_rate: calcBtwRate(btwAmt, exBtw),
    invoice_date: fmtDateNL(inv.invoice_date),
    due_date: fmtDateNL(inv.due_date),
    invoice_type: inv.invoice_type ?? "factuur", // [BOEK-014]
    period,
  };
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Convert invoice rows to a CSV string.
 * Separator: semicolon (Excel NL default).
 * Encoding: UTF-8 BOM added by downloadCsv().
 * [BOEK-014] Added "Type" column
 */
export function invoicesToCsv(rows: InvoiceExportRow[]): string {
  const headers = [
    "Factuurnummer",
    "Type",           // [BOEK-014]
    "Klant",
    "E-mail",
    "Adres",
    "Postcode",
    "Stad",
    "Status",
    "Richting",
    "Bedrag excl. BTW",
    "BTW bedrag",
    "BTW tarief %",
    "Bedrag incl. BTW",
    "Factuurdatum",
    "Vervaldatum",
    // [BRIDGE-A] "Naar boekhouder" removed — sent_to_accountant column dropped
    "Periode",
  ];

  // [CSV-SAFE][H1] Neutralise formula leads (= + - @) too, not just RFC-4180 quoting —
  // these CSVs are opened in the accountant's / owner's Excel.
  const escape = (v: string | number) => csvCell(v);

  const lines = [
    headers.map(escape).join(";"),
    ...rows.map((r) =>
      [
        r.invoice_number,
        (r as InvoiceExportRowFull).invoice_type ?? "factuur", // [BOEK-014]
        r.client_name,
        (r as InvoiceExportRowFull).client_email ?? "",
        (r as InvoiceExportRowFull).client_address ?? "",
        (r as InvoiceExportRowFull).client_postal_code ?? "",
        (r as InvoiceExportRowFull).client_city ?? "",
        r.status,
        (r as InvoiceExportRowFull).direction ?? "",
        fmtAmountNL(r.total_ex_btw),
        fmtAmountNL(r.btw_amount),
        `${r.btw_rate}%`,
        fmtAmountNL(r.total_inc_btw),
        r.invoice_date,
        r.due_date,
        r.period,
      ]
        .map(escape)
        .join(";")
    ),
  ];

  return lines.join("\r\n");
}

// [BOEK-014] Accountant all-clients CSV — adds "Klant" column at position 1
export function invoicesToCsvAccountant(
  rows: InvoiceExportRowFull[],
  clientNames: Record<string, string> // klant_id → display name
): string {
  const headers = [
    "Klant",           // extra column — which client this invoice belongs to
    "Factuurnummer",
    "Type",            // [BOEK-014]
    "E-mail",
    "Adres",
    "Postcode",
    "Stad",
    "Status",
    "Richting",
    "Bedrag excl. BTW",
    "BTW bedrag",
    "BTW tarief %",
    "Bedrag incl. BTW",
    "Factuurdatum",
    "Vervaldatum",
    // [BRIDGE-A] "Naar boekhouder" removed — sent_to_accountant column dropped
    "Periode",
  ];

  // [CSV-SAFE][H1] Neutralise formula leads (= + - @) too, not just RFC-4180 quoting —
  // these CSVs are opened in the accountant's / owner's Excel.
  const escape = (v: string | number) => csvCell(v);

  const lines = [
    headers.map(escape).join(";"),
    ...rows.map((r) => {
      const accountantRow = r as InvoiceExportRowAccountant;
      const klantName = clientNames[accountantRow.klant_id] ?? r.client_name;
      return [
        klantName,
        r.invoice_number,
        r.invoice_type ?? "factuur", // [BOEK-014]
        r.client_email,
        r.client_address,
        r.client_postal_code,
        r.client_city,
        r.status,
        r.direction,
        fmtAmountNL(r.total_ex_btw),
        fmtAmountNL(r.btw_amount),
        `${r.btw_rate}%`,
        fmtAmountNL(r.total_inc_btw),
        r.invoice_date,
        r.due_date,
        r.period,
      ]
        .map(escape)
        .join(";");
    }),
  ];

  return lines.join("\r\n");
}

/**
 * Trigger a CSV file download in the browser.
 * Only import this in client components.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Trigger a generic file download in the browser.
 * Used for JSON and future formats.
 * Only import this in client components.
 */
export function downloadFile(
  content: string | Blob,
  filename: string,
  mimeType: string
): void {
  const blob =
    content instanceof Blob
      ? content
      : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── BTW Aangifte Summary ─────────────────────────────────────────────────────

/**
 * Calculate BTW summary from a list of InvRows.
 * Used by the API route (?format=btw-summary) and the PDF generator.
 */
export function calcBtwSummary(
  invoices: InvRow[],
  year: number,
  quarter: number
): BtwSummary {
  let totalExBtw = 0;
  let totalIncBtw = 0;
  let btw0 = 0;
  let btw9 = 0;
  let btw21 = 0;
  let btwBedrag0 = 0;
  let btwBedrag9 = 0;
  let btwBedrag21 = 0;

  for (const inv of invoices) {
    const exBtw = Number(inv.total_ex_btw ?? 0);
    const btwAmt = Number(inv.btw_amount ?? 0);
    const incBtw = Number(inv.total_inc_btw ?? 0);
    const rate = calcBtwRate(btwAmt, exBtw);

    totalExBtw += exBtw;
    totalIncBtw += incBtw;

    if (rate === 0) {
      btw0 += exBtw;
      btwBedrag0 += btwAmt;
    } else if (rate === 9) {
      btw9 += exBtw;
      btwBedrag9 += btwAmt;
    } else {
      btw21 += exBtw;
      btwBedrag21 += btwAmt;
    }
  }

  return {
    period: `Q${quarter} ${year}`,
    year,
    quarter,
    invoiceCount: invoices.length,
    totalExBtw,
    btw0,
    btw9,
    btw21,
    btwBedrag0,
    btwBedrag9,
    btwBedrag21,
    btwTeBetalen: btwBedrag0 + btwBedrag9 + btwBedrag21,
    totalIncBtw,
  };
}

// ─── UBL/XML Stub (BOEK-020) ──────────────────────────────────────────────────


// [DODE CODE] invoicesToUbl is hier verwijderd. Hij had nul aanroepers in de hele app en
// produceerde bovendien ongeldige UBL (geen CustomizationID, dus geen SI-UBL/Peppol — zie
// de kop van ubl-export.ts, dat de ECHTE generator is). Twee generatoren voor hetzelfde
// formaat waarvan er één stilletjes fout is, is erger dan één.
