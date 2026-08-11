// src/lib/eft-parser.ts
// [EFT] Pure normalizer: the text of a payment-terminal settlement receipt (Equens
// CTAP "TOTALEN RAPPORT / EIND TOTALEN") → a structured EftSettlement. NO OCR, NO I/O —
// the OCR/image adapter hands us plain text and this turns it into the acquirer's GROSS
// card total for the shift, split per card scheme. Fully testable (run: npx tsx
// src/lib/eft-parser.test.ts) against the REAL Kiwi terminal (274865) receipt.
//
// WHY THIS EXISTS — corner 2 of the reconciliation triangle. The till (POS) records the
// PIN total GROSS. The bank receives the acquirer's payout NET of commission, a day
// later, with weekend shifts merged. Those two never tie 1:1. This settlement receipt is
// the bridge: its GROSS per shift must equal the till PIN (both gross → real discrepancy
// if not), and GROSS − bank-NET = the acquirer commission (a real cost + reclaimable BTW).
// Without it the app compared a gross till figure to a net bank figure and silently threw
// the commission away — overstating profit and losing the voorbelasting on it.

import { round2 } from './invoice-totals'

/** One card scheme's line on the settlement (V Pay / Maestro / Mastercard / …). */
export interface EftScheme {
  scheme: string;   // as printed ("V Pay", "Maestro", "Debit Mastercard", …)
  count: number;    // #TRX
  amount: number;   // EUR, gross
}

export interface EftSettlement {
  terminalId: string | null;   // TMS TERM-ID
  periodNr: string | null;     // PERIODE NR
  shiftNr: string | null;      // SHIFT NR
  periodStart: string | null;  // ISO datetime "YYYY-MM-DDTHH:mm:ss"
  periodEnd: string | null;
  firstTrx: string | null;
  lastTrx: string | null;
  settlementDate: string | null; // "YYYY-MM-DD" — the calendar day the card sales belong to
  grossTotal: number;          // EUR — gross card sales for the shift (the EFT TOTAAL)
  txCount: number;             // total #TRX
  byScheme: EftScheme[];
}

export interface EftWarning {
  code: string;
  message: string;   // Dutch, human-readable
}

export interface EftParseResult {
  settlement: EftSettlement | null;
  warnings: EftWarning[];
}

const r2 = round2;

/** Parse an NL money token ("1.546,46" / "1546,46" / "192.59") → number, or NaN. */
function money(raw: string): number {
  let s = raw.trim();
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // NL: dot=thousands, comma=decimal
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // grouped integer "1.234" → 1234 (dots are thousands, not a decimal)
  s = s.replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** "12/07/2026 18:26:36" or "12-07-2026 18:26" → ISO "2026-07-12T18:26:36" (time optional). */
function parseDateTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0"), mo = m[2].padStart(2, "0"), yyyy = m[3];
  if (Number(mo) < 1 || Number(mo) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  const date = `${yyyy}-${mo}-${dd}`;
  if (m[4] == null) return date; // date only
  const hh = m[4].padStart(2, "0"), mi = m[5], ss = (m[6] ?? "00").padStart(2, "0");
  return `${date}T${hh}:${mi}:${ss}`;
}

const dateOnly = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);

// Section/label lines that are NEVER a card-scheme name — used to reject false scheme
// labels when associating a "BETALING:" line with the block it belongs to.
const NON_SCHEME = /^(betaling|totaal|datum|tms|periode|shift|eft\s*totalen|equens|act\.|einde|totalen\s*rapport|eind\s*totalen|kiwi|acquirer|batch|#trx)/i;

/**
 * Parse a terminal settlement receipt's text into a structured EftSettlement + warnings.
 * The per-scheme lines must reconcile to the grand EFT total (amount and count); a
 * mismatch is a WARNING, never a silent "clean" parse. settlementDate is taken from the
 * transaction timestamps (not the period start) so a shift that opens the evening before
 * midnight is still booked on the day its sales actually happened.
 */
export function parseEftSettlement(text: string): EftParseResult {
  const warnings: EftWarning[] = [];
  const raw = (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").map((l) => l.trim());

  const field = (re: RegExp): string | null => {
    for (const l of lines) { const m = l.match(re); if (m) return m[1].trim(); }
    return null;
  };

  const terminalId = field(/tms\s*term-?id\s*:?\s*([0-9]+)/i);
  const periodNr = field(/periode\s*nr\.?\s*:?\s*([0-9]+)/i);
  const shiftNr = field(/shift\s*nr\.?\s*:?\s*([0-9]+)/i);
  const periodStart = parseDateTime(field(/periode\s*start\s*:?\s*(.+)/i) ?? undefined);
  const periodEnd = parseDateTime(field(/periode\s*einde\s*:?\s*(.+)/i) ?? undefined);
  const firstTrx = parseDateTime(field(/eerste\s*trx\s*:?\s*(.+)/i) ?? undefined);
  const lastTrx = parseDateTime(field(/laatste\s*trx\s*:?\s*(.+)/i) ?? undefined);

  // The calendar day the card sales belong to: prefer the actual transaction timestamps
  // (they sit inside the real trading day even when the shift period straddles midnight),
  // then fall back to the period end, then start.
  const settlementDate =
    dateOnly(lastTrx) ?? dateOnly(firstTrx) ?? dateOnly(periodEnd) ?? dateOnly(periodStart);

  // A "BETALING:" line carries "<count> <amount>". Walk the lines keeping the last
  // plausible label so each payment line is attributed to its block. The FIRST payment
  // line under "EFT TOTALEN" is the grand total; the ones after "Equens CTAP" are schemes.
  const payRe = /betaling\s*:?\s*([0-9]+)\s+([0-9][0-9.,]*)/i;
  let grandTotal: number | null = null;
  let grandCount: number | null = null;
  const byScheme: EftScheme[] = [];
  let lastLabel = "";
  let inSchemes = false;

  for (const l of lines) {
    if (!l) continue;
    if (/equens|acquirer|ctap/i.test(l)) { inSchemes = true; continue; }
    const pm = l.match(payRe);
    if (pm) {
      const count = parseInt(pm[1], 10);
      const amount = r2(money(pm[2]));
      if (!inSchemes && grandTotal === null) {
        // Grand EFT total (the first BETALING, printed under "EFT TOTALEN").
        grandTotal = amount; grandCount = count;
      } else {
        const scheme = lastLabel && !NON_SCHEME.test(lastLabel) ? lastLabel : `Onbekend (${byScheme.length + 1})`;
        byScheme.push({ scheme, count, amount });
      }
      lastLabel = "";
      continue;
    }
    // A label line = has letters and isn't a known section/keyword line. Remember it as
    // the candidate scheme name for the next BETALING line.
    if (/[a-z]/i.test(l) && !NON_SCHEME.test(l) && !/^-+$/.test(l)) lastLabel = l.replace(/\s+#trx.*$/i, "").trim();
  }

  if (grandTotal === null) {
    warnings.push({ code: "no_eft_total", message: "Geen EFT-totaal (BETALING) gevonden op de terminal-afrekening." });
    return { settlement: null, warnings };
  }

  // Cross-checks: the per-scheme lines must reconcile to the grand total.
  if (byScheme.length > 0) {
    const sumAmt = r2(byScheme.reduce((a, x) => a + x.amount, 0));
    const sumCnt = byScheme.reduce((a, x) => a + x.count, 0);
    if (Math.abs(sumAmt - grandTotal) > 0.02) {
      warnings.push({ code: "scheme_total_mismatch",
        message: `Som van kaartsoorten (${sumAmt.toFixed(2)}) ≠ EFT-totaal (${grandTotal.toFixed(2)}).` });
    }
    if (grandCount !== null && sumCnt !== grandCount) {
      warnings.push({ code: "scheme_count_mismatch",
        message: `Aantal transacties per kaartsoort (${sumCnt}) ≠ EFT-totaal aantal (${grandCount}).` });
    }
  }

  const settlement: EftSettlement = {
    terminalId, periodNr, shiftNr,
    periodStart, periodEnd, firstTrx, lastTrx,
    settlementDate,
    grossTotal: grandTotal,
    txCount: grandCount ?? 0,
    byScheme,
  };
  return { settlement, warnings };
}
