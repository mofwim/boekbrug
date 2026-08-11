// src/lib/ledger-import.ts
// [LEDGER] Pure normalizer: a raw spreadsheet grid from the store's accounting package
// (an "OVERZICHT" / "KASBOEK" per-account export) → structured ledger entries. NO
// SheetJS, NO I/O — the xlsx adapter hands us the matrix; this turns it into per-day
// GROSS totals per bookkeeping account. Fully testable (run: npx tsx
// src/lib/ledger-import.test.ts) against the REAL Kiwi RAP_FIN exports.
//
// WHY THIS EXISTS — corner 3's cross-check. The bookkeeper's package exports one file
// per grootboek account: 550100 (PIN) shows "Totaal PIN Kaart van DD/MM/YYYY", 570000
// (kas) shows "Totaal Kontant van DD/MM/YYYY". Those are the SAME gross figures the till
// records (PIN 2086.65, cash 216.45 on 03/07) — so they independently confirm the till
// import. Before this, such an .xlsx sent to the bank endpoint decoded a binary ZIP as
// UTF-8 and silently yielded ZERO transactions — a file that looked ingested but wasn't.

import { round2 } from './invoice-totals'

export type Cell = string | number | null | undefined;

/** What kind of money this ledger account holds — drives how reconciliation uses it. */
export type LedgerKind = "pin" | "cash" | "bank" | "other";

export interface LedgerEntry {
  date: string;                 // ISO "YYYY-MM-DD"
  name: string | null;          // "Naam" column ("Totaal van de kassa")
  description: string | null;   // "Omschrijving" ("Totaal PIN Kaart van 03/07/2026")
  received: number;             // "Ontvangen"
  spent: number;                // "Uitgaven"
}

export interface LedgerImport {
  accountNr: string | null;     // "Rekening Nr:" (550100 / 570000 / …)
  title: string | null;         // "OVERZICHT" | "KASBOEK" | "BANK" | …
  kind: LedgerKind;
  openingBalance: number | null;// "Voorgaande Saldo"
  entries: LedgerEntry[];
}

export interface LedgerWarning { code: string; message: string; } // Dutch

export interface LedgerParseResult { ledger: LedgerImport | null; warnings: LedgerWarning[]; }

const r2 = round2;

/** NL/EN number ("1.234,56" / "1234.56" / number) → number. */
function num(v: Cell): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  let s = v.trim();
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  s = s.replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Date cell → ISO, or null. ISO / DD-MM-YYYY / Excel serial / Date-derived string. */
function parseDate(v: Cell): string | null {
  if (v == null) return null;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const d = m[1].padStart(2, "0"), mo = m[2].padStart(2, "0");
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) return `${m[3]}-${mo}-${d}`;
  }
  return null;
}

const norm = (v: Cell): string => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Derive the account kind from its number, title and the wording of its entries. */
function deriveKind(accountNr: string | null, title: string | null, entries: LedgerEntry[]): LedgerKind {
  const text = `${title ?? ""} ${entries.map((e) => e.description ?? "").join(" ")}`.toLowerCase();
  if (/kontant|contant|\bkas\b|kasboek/.test(text) || accountNr?.startsWith("5700")) return "cash";
  if (/\bpin\b|pin kaart|pinbetaling/.test(text) || accountNr?.startsWith("5501")) return "pin";
  // Word-bounded bank tokens: a bare "ing" would otherwise match "levering", "betaling",
  // "rekening" and mislabel any ledger as bank. Require the standalone bank names.
  if (/\bbank\b|overboeking|\bing\b|\brabo\b|\babn\b|\bsns\b|iban/.test(text)) return "bank";
  return "other";
}

/**
 * Normalize an accounting-package ledger export into structured entries + warnings.
 * Locates the "Datum / Naam / Omschrijving / Ontvangen / Uitgaven" header, reads the
 * date-keyed rows below it, and stops at the closing "TOTALEN:" / "Nieuw Saldo:" block.
 * Nothing is invented: a sheet with no recognizable ledger header returns null + a
 * warning, never an empty "clean" import that looks ingested but isn't.
 */
export function parseLedgerSheet(matrix: Cell[][]): LedgerParseResult {
  const warnings: LedgerWarning[] = [];

  let accountNr: string | null = null;
  let title: string | null = null;
  let openingBalance: number | null = null;
  let headerRow = -1;

  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const cells = row.map(norm);

    // "Rekening Nr:" — the account number is the next non-empty cell on the row.
    const rekIdx = cells.findIndex((c) => /^rekening\s*nr/.test(c));
    if (rekIdx >= 0 && accountNr === null) {
      for (let i = rekIdx + 1; i < row.length; i++) {
        const val = String(row[i] ?? "").trim();
        if (val) { accountNr = val; break; }
      }
    }
    // Title banner (OVERZICHT / KASBOEK / BANK) — a lone all-caps word in the block.
    if (title === null) {
      const t = row.map((c) => String(c ?? "").trim()).find((c) => /^(OVERZICHT|KASBOEK|BANK|GROOTBOEK)$/i.test(c));
      if (t) title = t.toUpperCase();
    }
    // Opening balance.
    const vsIdx = cells.findIndex((c) => /voorgaande\s*saldo/.test(c));
    if (vsIdx >= 0 && openingBalance === null) {
      for (let i = vsIdx + 1; i < row.length; i++) {
        if (typeof row[i] === "number") { openingBalance = r2(row[i] as number); break; }
      }
    }
    // The column header row.
    if (headerRow < 0 && cells.some((c) => /^datum$/.test(c)) &&
        cells.some((c) => /ontvangen/.test(c)) && cells.some((c) => /uitgaven/.test(c))) {
      headerRow = r;
    }
  }

  if (headerRow < 0) {
    warnings.push({ code: "no_ledger", message: "Geen herkenbare grootboek-export (Datum / Ontvangen / Uitgaven) gevonden." });
    return { ledger: null, warnings };
  }

  // Map the five columns from the header row.
  const head = (matrix[headerRow] ?? []).map(norm);
  const col = (re: RegExp) => head.findIndex((c) => re.test(c));
  const cDate = col(/^datum$/), cName = col(/^naam$/), cDesc = col(/omschrijving/),
        cRecv = col(/ontvangen/), cSpent = col(/uitgaven/);

  const entries: LedgerEntry[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const rowText = row.map(norm).join(" ");
    if (/totalen\s*:|nieuw\s*saldo/.test(rowText)) break; // closing block — stop
    const date = parseDate(row[cDate]);
    if (!date) continue; // skip non-data rows
    entries.push({
      date,
      name: cName >= 0 ? (String(row[cName] ?? "").trim() || null) : null,
      description: cDesc >= 0 ? (String(row[cDesc] ?? "").trim() || null) : null,
      received: cRecv >= 0 ? r2(num(row[cRecv])) : 0,
      spent: cSpent >= 0 ? r2(num(row[cSpent])) : 0,
    });
  }

  if (entries.length === 0) {
    warnings.push({ code: "no_ledger_rows", message: "Geen dagregels met een geldige datum gevonden in de grootboek-export." });
  }

  const kind = deriveKind(accountNr, title, entries);
  return { ledger: { accountNr, title, kind, openingBalance, entries }, warnings };
}

/** Sum a ledger's entries per calendar day → the cross-check figures reconciliation uses. */
export function ledgerDailyTotals(ledger: LedgerImport): Map<string, { received: number; spent: number }> {
  const out = new Map<string, { received: number; spent: number }>();
  for (const e of ledger.entries) {
    const cur = out.get(e.date) ?? { received: 0, spent: 0 };
    cur.received = r2(cur.received + e.received);
    cur.spent = r2(cur.spent + e.spent);
    out.set(e.date, cur);
  }
  return out;
}
