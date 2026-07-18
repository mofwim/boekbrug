// src/lib/daily-sales-report.ts
// [DAGVERKOPEN-PDF] Pure parser for a shop's DAILY sales report PDF ("OMZET VAN DD/MM/YYYY") —
// the per-day sibling of the monthly kassa Z-report. A store that prints one PDF per trading day
// instead of a monthly Excel would otherwise have every day dead-end as an opaque document. This
// turns the report's text (extracted by the caller via unpdf) into ONE DailyTurnover row for that
// day, so it lands in daily_turnover exactly like the Excel path — same table, same VAT effect.
//
// No I/O — the caller hands us the extracted text. Fully testable (run: npx tsx
// src/lib/daily-sales-report.test.ts) against the real Kiwi "OMZET VAN" layout.
//
// Money-truth: the per-rate figure printed as "Omzet met BTW % 9,00 1.886,58" is the GROSS (incl.
// BTW) turnover for that rate — proven on real data: 1886,58 / 1,09 = 1730,81 net + 155,77 BTW,
// and BOTH of those derived numbers appear verbatim elsewhere in the same report. So we divide the
// BTW out of the gross (same as the Z-report's TC-only mode). The per-rate gross must sum to the
// printed TOTAAL to the cent, or we emit a warning and the caller does NOT auto-book it.

import type { DailyTurnover } from "./turnover";

export interface DailySalesResult {
  row: DailyTurnover | null;
  warnings: string[]; // Dutch, human-readable
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** NL money string → number: "1.886,58" → 1886.58, "2,70" → 2.70. Dots are thousands, comma is
 *  the decimal (a Dutch POS report is always NL-formatted). Returns 0 for junk. */
function num(s: string): number {
  const cleaned = s.replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;
  const n = parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Cheap marker test: is this the daily-sales report format (not an invoice/receipt)? Requires the
 *  "OMZET VAN <date>" header AND at least one "Omzet met BTW %" per-rate line. */
export function looksLikeDailySalesReport(text: string | null | undefined): boolean {
  if (!text) return false;
  return /OMZET\s+VAN\s+\d{1,2}\/\d{1,2}\/\d{4}/i.test(text) && /Omzet\s+met\s+BTW/i.test(text);
}

/**
 * Parse one daily-sales report into a single DailyTurnover row + warnings. Returns row:null when
 * the date or the per-rate omzet can't be read (never a €0 phantom day). A per-rate/TOTAAL
 * mismatch is a warning — the caller treats "no warnings" as the condition to auto-book.
 */
export function parseDailySalesReport(text: string): DailySalesResult {
  const warnings: string[] = [];

  const dm = text.match(/OMZET\s+VAN\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!dm) return { row: null, warnings: ["Geen datum (OMZET VAN …) in het rapport gevonden."] };
  const dd = dm[1].padStart(2, "0"), mm = dm[2].padStart(2, "0");
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) {
    return { row: null, warnings: [`Ongeldige datum ${dm[1]}/${dm[2]}/${dm[3]} in het rapport.`] };
  }
  const date = `${dm[3]}-${mm}-${dd}`;

  // Per-rate GROSS omzet lines: "Omzet met BTW % 9,00 1.886,58" → rate 9, gross 1886.58.
  let base0 = 0, base9 = 0, base21 = 0, btw9 = 0, btw21 = 0, grossSum = 0;
  const re = /Omzet\s+met\s+BTW\s*%?\s*(\d{1,2}),\d{2}\s+([\d.]*\d,\d{2})/gi;
  let m: RegExpExecArray | null;
  let sawRate = false;
  while ((m = re.exec(text)) !== null) {
    const rate = parseInt(m[1], 10);
    const gross = num(m[2]);
    sawRate = true;
    grossSum += gross;
    if (rate === 0) {
      base0 = r2(base0 + gross);
    } else if (rate === 9) {
      const net = gross / 1.09;
      base9 = r2(base9 + net); btw9 = r2(btw9 + (gross - net));
    } else if (rate === 21) {
      const net = gross / 1.21;
      base21 = r2(base21 + net); btw21 = r2(btw21 + (gross - net));
    } else {
      warnings.push(`Onbekend BTW-tarief ${rate}% — controleer het rapport.`);
    }
  }
  if (!sawRate || grossSum <= 0) {
    return { row: null, warnings: ["Geen omzet per BTW-tarief (Omzet met BTW %) gevonden."] };
  }
  const total_incl = r2(grossSum);

  // Cross-check against the printed TOTAAL gross (first amount on the TOTAAL line), if present.
  const tm = text.match(/TOTAAL:?\s*\d+\s+([\d.]*\d,\d{2})/i);
  if (tm) {
    const totaal = num(tm[1]);
    const tol = Math.max(0.05, 0.005 * total_incl);
    if (Math.abs(totaal - grossSum) > tol) {
      warnings.push(`Som per tarief (${total_incl.toFixed(2)}) ≠ TOTAAL (${totaal.toFixed(2)}) — controleer het rapport.`);
    }
  }

  const row: DailyTurnover = {
    turnover_date: date,
    base_0: base0, base_9: base9, base_21: base21,
    btw_9: btw9, btw_21: btw21,
    total_incl,
    // A daily-sales report carries no payment split (that comes from the Z-report / grootboek).
    pin_amount: null, cash_amount: null, other_amount: null,
  };
  return { row, warnings };
}
