// src/lib/bank-csv.ts
// [BANK-CSV] CSV bank-statement parser + normalized export.
//
// The existing bank-parser.ts reads MT940 + CAMT.053. But every Dutch consumer
// bank ALSO offers a plain CSV download from its web portal (ING, Rabobank, bunq,
// SNS, ASN, Triodos, Knab, Regiobank, …) and that is what most owners actually
// have to hand — a bankafschrift as CSV, not the accountant-oriented MT940/CAMT.
// Before this module a .csv upload fell through to parseMT940, matched nothing,
// and silently imported ZERO transactions while looking successful. This closes
// that gap.
//
// Design: HEADER-DRIVEN, not per-bank hardcoding. Each bank names its columns
// differently but the ROLES are the same everywhere — a date, an amount, a
// counterpart name, a counterpart IBAN, a remittance text, and (ING/ABN) an
// Af/Bij debit-credit flag. We detect the delimiter, map each header to a role
// via a Dutch+English synonym table, and read rows into the SAME canonical
// BankTransaction shape the MT940/CAMT parsers produce — so dedup, matching,
// auto-categorisation and reconciliation all work identically regardless of the
// upload format. A bank we've never seen still parses as long as its headers use
// recognisable words.
//
// Honesty guard: if the mapping can't find BOTH a date and an amount column, or
// no row yields a valid (date, amount) pair, we return zero transactions with a
// parseError — never a false-positive ingest of a non-bank CSV (a product list,
// a turnover export). The raw file is still stored by the caller.

import type { BankTransaction, ParseResult } from "./bank-parser";
import { extractInvoiceReference } from "./bank-parser";

// ─── CSV tokeniser (RFC-4180-ish: quotes, escaped quotes, embedded delimiters) ──

/** Split CSV text into a matrix of string cells, honouring "quoted" fields. */
export function splitCsv(content: string, delim: string): string[][] {
  const rows: string[][] = [];
  const s = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let started = false; // did the current row receive any char/field?

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // escaped ""
        else inQuotes = false;
      } else field += c;
      started = true;
    } else if (c === '"') {
      inQuotes = true;
      started = true;
    } else if (c === delim) {
      row.push(field); field = ""; started = true;
    } else if (c === "\n") {
      if (started) { row.push(field); rows.push(row); }
      row = []; field = ""; started = false;
    } else {
      field += c; started = true;
    }
  }
  if (started) { row.push(field); rows.push(row); }
  return rows;
}

/** Pick the delimiter used by a header line: the winner among ; \t , (in that
 *  tie-break order — European files use ; or TAB; a comma inside a quoted field
 *  can't inflate the count because we scan the header, which has no amounts). */
function detectDelimiter(headerLine: string): string {
  const candidates: Array<[string, number]> = [
    [";", (headerLine.match(/;/g) || []).length],
    ["\t", (headerLine.match(/\t/g) || []).length],
    [",", (headerLine.match(/,/g) || []).length],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ",";
}

// ─── Value parsers ──────────────────────────────────────────────────────────

/** Parse a bank amount string in any common notation → number (or null).
 *  Handles Dutch "1.234,56" / "12,50", English "1,234.56" / "12.50", bare
 *  "-12.50", trailing-minus "12,50-", and a leading "+". Returns null if there
 *  is no digit at all. Sign is preserved; callers may override it with an
 *  Af/Bij flag. */
export function parseBankAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Strip currency symbols/codes and spaces, keep digits . , + -
  s = s.replace(/[€$£]/g, "").replace(/\s/g, "").replace(/EUR/gi, "");
  if (!/\d/.test(s)) return null;

  const negative = /^-/.test(s) || /-$/.test(s);
  s = s.replace(/[+\-]/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // The LAST separator is the decimal one; the other groups thousands.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    const commas = (s.match(/,/g) || []).length;
    s = commas > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (hasDot) {
    const dots = (s.match(/\./g) || []).length;
    // "1.234" or "1.234.567" with no comma = Dutch thousands grouping.
    if (dots > 1) s = s.replace(/\./g, "");
    else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", "");
    // otherwise the single dot is a decimal point — leave it.
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return negative ? -n : n;
}

/** Parse a bank date in any common notation → ISO "YYYY-MM-DD" (or null). */
export function parseBankDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const iso = (y: number, m: number, d: number): string | null =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31
      ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      : null;

  // YYYYMMDD (ING)
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  // YYYY-MM-DD or YYYY/MM/DD (Rabo, bunq)
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  // DD-MM-YYYY or DD/MM/YYYY (SNS, some ABN)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  // DD-MM-YY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  if (m) return iso(2000 + +m[3], +m[2], +m[1]);
  return null;
}

// ─── Header → role mapping ────────────────────────────────────────────────────

function normHeader(h: string): string {
  return h.toLowerCase().replace(/["']/g, "").replace(/\s+/g, " ").trim();
}

interface ColumnMap {
  date: number;
  amount: number;
  sign: number;        // Af/Bij indicator column, or -1
  name: number;        // counterpart name, or -1
  iban: number;        // counterpart IBAN, or -1
  ownIban: number;     // account's own IBAN, or -1
  descCols: number[];  // one or more remittance columns (Rabo has Omschrijving-1/-2/-3)
}

// A header matches a role if ANY of its regexes hit. Order matters: we resolve
// the more specific roles (counterpart iban, own iban) before the generic ones so
// Rabo's twin "IBAN/BBAN" (own) and "Tegenrekening IBAN/BBAN" (counterpart) don't
// collide.
function mapColumns(headers: string[]): ColumnMap {
  const H = headers.map(normHeader);
  const find = (re: RegExp, exclude?: RegExp): number =>
    H.findIndex((h) => re.test(h) && !(exclude && exclude.test(h)));
  const findAll = (re: RegExp, exclude?: RegExp): number[] =>
    H.map((h, i) => (re.test(h) && !(exclude && exclude.test(h)) ? i : -1)).filter((i) => i >= 0);

  // Date: a booking/transaction date, NOT the rente-/valuta-/interest date.
  let date = find(/boekdatum|transactiedatum|transaction ?date|booking ?date/);
  if (date < 0) date = find(/datum|date/, /rente|valuta|interest|value/);
  if (date < 0) date = find(/datum|date/); // last resort: any date-ish column

  // Amount: the mutation amount, never a running balance.
  let amount = find(/bedrag|amount|mutatiebedrag/, /saldo|balance|na (trn|mutatie)/);
  if (amount < 0) amount = find(/bedrag|amount/, /saldo|balance/);

  // Af/Bij debit-credit flag (ING, ABN).
  const sign = find(/^af ?\/? ?bij$|debet\/credit|debit\/credit|bij\/af|af bij/);

  // Counterpart IBAN: must say "tegen" (tegenrekening / tegenpartij) or be an
  // explicit destination account. Excludes the own IBAN.
  let iban = find(/tegenrekening|tegen ?iban|counterparty ?iban|naar rekening/);
  if (iban < 0) iban = find(/tegenrekening|account/, /^iban\/bban$|^rekening$|eigen/);

  // Own IBAN: Rabo "IBAN/BBAN", ING "Rekening", bunq "Account".
  let ownIban = find(/^iban\/bban$|^rekening$|^account$|eigen rekening/);
  if (ownIban === iban) ownIban = -1;

  // Counterpart name.
  const name = find(/naam tegenpartij|tegenpartij|begunstigde|opdrachtgever|counterparty ?name|^name$|^naam$|naam ?\/ ?omschrijving/, /iban|rekening|bic/);

  // Remittance / description: ING "Mededelingen", Rabo "Omschrijving-1/-2/-3",
  // bunq "Description"/"Omschrijving", plus "Betalingskenmerk".
  let descCols = findAll(/omschrijving|mededeling|description|betalingskenmerk|remittance/, /naam/);
  if (descCols.length === 0 && name >= 0 && /naam ?\/ ?omschrijving/.test(H[name])) {
    // ING packs name + a hint into one column; use it as description too.
    descCols = [name];
  }

  return { date, amount, sign, name, iban, ownIban, descCols };
}

// ─── Row → BankTransaction ────────────────────────────────────────────────────

const cell = (row: string[], i: number): string =>
  i >= 0 && i < row.length ? (row[i] ?? "").trim() : "";

function applySignFlag(amount: number, flag: string): number {
  const f = flag.toLowerCase().trim();
  const mag = Math.abs(amount);
  if (/^(af|debet|debit|d|-)$/.test(f)) return -mag;
  if (/^(bij|credit|c|\+)$/.test(f)) return mag;
  // Flag absent/unrecognised → we cannot assert a direction from it, so we fall back
  // to the amount's OWN sign. This only matters for a bank that pairs an UNSIGNED
  // amount with an Af/Bij column (ING) AND leaves the flag blank on a row — which
  // ING never does in practice. For the signed-amount banks (Rabo/bunq) the sign
  // column isn't even mapped, so this branch keeps their real sign intact.
  return amount;
}

function rowToTransaction(row: string[], map: ColumnMap, currency: string): BankTransaction | null {
  const date = parseBankDate(cell(row, map.date));
  const rawAmount = parseBankAmount(cell(row, map.amount));
  if (!date || rawAmount == null) return null;

  const amount = map.sign >= 0 ? applySignFlag(rawAmount, cell(row, map.sign)) : rawAmount;

  const description = map.descCols
    .map((i) => cell(row, i))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  let counterpartName: string | null = cell(row, map.name) || null;
  // A counterpart "name" that is actually just an IBAN or empty is not useful.
  if (counterpartName && /^[A-Z]{2}\d{2}[A-Z0-9]{4,}$/.test(counterpartName.replace(/\s/g, ""))) {
    counterpartName = null;
  }
  const counterpartIban = (cell(row, map.iban).replace(/\s/g, "") || null);

  // Reference via the SHARED extractor so CSV imports get the exact same invoice
  // -number rules (multi-invoice, Incasso, POS→null) as MT940/CAMT.
  const isPos = /BETAALAUTOMAAT|AFREK\.|Verzamelbetaling/i.test(description);
  const isCard = /TERMINALID|PASVOLGNR|TRANSACTIENR|CCV\*|BCK\*|BETAALPAS/i.test(description);
  const reference = extractInvoiceReference(description, { isPos, isCard });

  return {
    date,
    amount,
    currency,
    description,
    counterpartName,
    counterpartIban,
    reference,
    transactionId: null,
    rawLine: row.join(" | "),
  };
}

// ─── Public parse ─────────────────────────────────────────────────────────────

/** Does this text look like a delimited CSV bank export (as opposed to MT940/CAMT)? */
export function looksLikeBankCsv(content: string): boolean {
  const firstLine = content.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine) return false;
  if (/^:\d{2}[A-Z]?:/.test(content.trimStart())) return false; // MT940
  if (/<\?xml|<Document|<BkToCstmrStmt/.test(content)) return false; // CAMT
  const delim = detectDelimiter(firstLine);
  // A header row with at least 3 delimited columns, containing date+amount words.
  const cols = firstLine.split(delim).length;
  const h = firstLine.toLowerCase();
  return cols >= 3 && /datum|date/.test(h) && /bedrag|amount/.test(h);
}

/**
 * Parse a CSV bank statement into the canonical ParseResult shape.
 * Best-effort and honest: returns zero transactions + a parseError when the file
 * has no recognisable date/amount columns, rather than fabricating rows.
 */
export function parseBankCsv(content: string): ParseResult {
  const errors: string[] = [];
  const clean = content.replace(/^﻿/, ""); // strip UTF-8 BOM
  const lines = clean.split(/\r?\n/);
  const headerLine = lines.find((l) => l.trim().length > 0) ?? "";
  const delim = detectDelimiter(headerLine);

  const matrix = splitCsv(clean, delim).filter((r) => r.some((c) => c.trim() !== ""));
  if (matrix.length < 2) {
    return { format: "CSV", accountIban: null, accountName: null, currency: "EUR", transactions: [], parseErrors: ["Leeg of onleesbaar CSV-bestand."] };
  }

  const headers = matrix[0];
  const map = mapColumns(headers);
  if (map.date < 0 || map.amount < 0) {
    // Honest, non-dismissive: we could NOT auto-recognise the columns — we do NOT
    // claim the file "isn't a bank statement" (it may well be one from a bank whose
    // headers we don't know, or a headerless export). The raw file is still stored
    // by the caller; point the owner at the MT940/CAMT export as the reliable path.
    return {
      format: "CSV",
      accountIban: null,
      accountName: null,
      currency: "EUR",
      transactions: [],
      parseErrors: [
        "De kolommen in dit CSV-bestand konden niet automatisch worden herkend" +
          (headers.some((h) => h.trim())
            ? " (gevonden: " + headers.map((h) => h.trim()).filter(Boolean).slice(0, 12).join(", ") + ")"
            : "") +
          ". Download je afschrift bij je bank als MT940 (.sta) of CAMT.053 (.xml) — die worden altijd gelezen.",
      ],
    };
  }

  const currency = "EUR";
  const transactions: BankTransaction[] = [];
  let ownIban: string | null = null;
  let dropped = 0;

  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (ownIban == null && map.ownIban >= 0) {
      const v = cell(row, map.ownIban).replace(/\s/g, "");
      if (/^[A-Z]{2}\d{2}[A-Z0-9]{4,}$/.test(v)) ownIban = v;
    }
    const tx = rowToTransaction(row, map, currency);
    if (tx) transactions.push(tx);
    else dropped++;
  }

  if (transactions.length === 0) {
    errors.push("CSV bevatte geen leesbare transacties (geen geldige datum/bedrag-rijen).");
  } else if (dropped > 0) {
    errors.push(`${dropped} CSV-rij(en) overgeslagen — geen geldige datum of bedrag.`);
  }

  return { format: "CSV", accountIban: ownIban, accountName: null, currency, transactions, parseErrors: errors };
}

// ─── Normalized export ("bankafschrift naar Excel") ───────────────────────────
//
// The mirror of the parse: turn ANY parsed statement (CSV/MT940/CAMT) into a
// clean, uniform matrix an owner can open in Excel — one predictable layout
// instead of each bank's idiosyncratic columns. This is the acquisition wedge
// ("bankafschrift naar excel") AND a genuinely useful export for the owner.

export const EXPORT_HEADERS = [
  "Datum",
  "Bedrag (EUR)",
  "Bij/Af",
  "Tegenpartij",
  "IBAN tegenpartij",
  "Omschrijving",
  "Referentie",
] as const;

/** Parsed statement → a rectangular matrix (header row + one row per tx). Amounts
 *  are kept as NUMBERS so Excel/SheetJS treats them numerically; the sign column
 *  is a human-readable Bij/Af. Sorted oldest-first. */
export function toExportMatrix(result: ParseResult): (string | number)[][] {
  const rows: (string | number)[][] = [[...EXPORT_HEADERS]];
  const sorted = [...result.transactions].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  for (const t of sorted) {
    rows.push([
      t.date || "",
      Math.abs(t.amount),
      t.amount < 0 ? "Af" : "Bij",
      t.counterpartName || "",
      t.counterpartIban || "",
      t.description || "",
      t.reference || "",
    ]);
  }
  return rows;
}

/** Parsed statement → a nl-NL CSV string (semicolon-delimited, comma decimals,
 *  UTF-8 BOM) that Dutch Excel opens straight into columns with correct accents.
 *  A zero-dependency download for the converter page. */
export function toNormalizedCsv(result: ParseResult): string {
  const esc = (v: string | number): string => {
    let s = typeof v === "number" ? v.toFixed(2).replace(".", ",") : String(v);
    // Neutralise spreadsheet formula injection: a text cell beginning with = + - @
    // (or tab/CR) could execute when opened in Excel. Numbers are already formatted
    // above, so this only guards free-text (counterpart names, descriptions).
    if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const matrix = toExportMatrix(result);
  const body = matrix
    .map((row, i) =>
      // header stays as text; data rows format the amount cell with a comma decimal
      row.map((v, c) => (i > 0 && c === 1 && typeof v === "number" ? esc(v) : esc(v))).join(";")
    )
    .join("\r\n");
  return "﻿" + body + "\r\n";
}
