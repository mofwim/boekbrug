// src/lib/payment-period.ts
// [BANK-PERIOD] Parse a service PERIOD out of a bank description — "Incasso Huur Periode:
// 01-06-2026 tot 01-07-2026". A recurring debit (rent, lease, subscription) states the
// month it covers; several same-amount invoices then look identical and the owner has to
// guess which one. Surfacing the period lets them match it to the right invoice's date.
//
// Deliberately DISPLAY-only. We do NOT auto-match the period to an invoice: invoices carry
// no service-period column (only invoice_date/due_date), and rent is often billed a month
// in advance, so "invoice_date inside the period" is wrong for the common case — matching
// on it would be a confident-looking WRONG pick. Honest surfacing beats a fragile guess.
//
// Pure + testable: `npx tsx src/lib/payment-period.test.ts`.

export interface PaymentPeriod {
  startIso: string; // YYYY-MM-DD
  endIso: string; // YYYY-MM-DD
  label: string; // human, nl-NL, e.g. "1 jun – 1 jul 2026"
}

const NL_MONTHS = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];

// One date in DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY or YYYY-MM-DD. Returns ISO or null.
function toIso(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s); // ISO-ish
  if (m) {
    const [, y, mo, d] = m;
    return isoIfValid(+y, +mo, +d);
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); // DD-MM-YYYY
  if (m) {
    const [, d, mo, y] = m;
    return isoIfValid(+y, +mo, +d);
  }
  return null;
}

function isoIfValid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}`;
}

function labelPart(iso: string): { day: number; monthIdx: number; year: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { year: +m[1], monthIdx: +m[2] - 1, day: +m[3] };
}

/**
 * Extract a { startIso, endIso, label } period from a free-text bank description, or null.
 * Matches an explicit "periode" section OR a bare "<date> tot|t/m|- <date>" range.
 */
export function parsePaymentPeriod(text: string | null | undefined): PaymentPeriod | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ');
  const DATE = '(\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4}|\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2})';
  const SEP = '(?:tot(?:\\s*en\\s*met)?|t/m|t\\.m\\.|until|—|–|-)';
  // Prefer a range that follows the word "periode", else any date-range in the text.
  const re = new RegExp(`(?:periode[:\\s]*)?${DATE}\\s*${SEP}\\s*${DATE}`, 'i');
  const m = re.exec(t);
  if (!m) return null;
  const startIso = toIso(m[1]);
  const endIso = toIso(m[2]);
  if (!startIso || !endIso) return null;
  if (endIso < startIso) return null; // a backwards range is not a period

  const a = labelPart(startIso);
  const b = labelPart(endIso);
  if (!a || !b) return null;
  const label =
    a.year === b.year
      ? `${a.day} ${NL_MONTHS[a.monthIdx]} – ${b.day} ${NL_MONTHS[b.monthIdx]} ${b.year}`
      : `${a.day} ${NL_MONTHS[a.monthIdx]} ${a.year} – ${b.day} ${NL_MONTHS[b.monthIdx]} ${b.year}`;
  return { startIso, endIso, label };
}
