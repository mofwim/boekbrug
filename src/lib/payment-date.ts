// src/lib/payment-date.ts
// [PAY-DATE-SANE] One answer to "can a payment really have happened on this date?" — for every
// door that writes a betaaldatum into the books.
//
// The shape test (/^\d{4}-\d{2}-\d{2}$/) that guarded the money path is not a date check. It
// accepts "2062-03-01" and "1926-07-04" just as happily as today, and a slipped digit in a date
// field is one of the most ordinary mistakes there is. What that one digit moves:
//
//   · the BTW QUARTER under the kasstelsel — vat-scheme.ts:7 says it in one line ("BTW lands in
//     the quarter the invoice is PAID"), so a payment dated into a quarter that is already
//     ingediend changes an aangifte the owner has already filed, with nothing on any screen
//     saying so;
//   · the KASBOEK — a 'kas' payment becomes a dated drawer movement (cash-settle.ts writes
//     entry_date from paid_on/payment_date), so the running balance, the eindsaldo the accountant
//     reads, and the negative-drawer witness that BLOCKS the filing (drawer-witness.ts) all carry
//     the impossible day with them;
//   · the invoice's own payment_date, which is what every later screen quotes back.
//
// The window is deliberately generous: anything a person could plausibly mean is accepted, only
// the physically impossible is refused. Tomorrow is allowed because a device clock or a timezone
// edge can legitimately be a day ahead of the server.
//
// PURE, with `todayAmsterdam` INJECTED — never a clock read here, so the rule is testable and
// every caller judges against the same Amsterdam day it already computed (format-nl.ts:17-23).
//
// The sheet side of the app has the same rule for a different subject: turnoverDateOutOfWindow
// (turnover-import.ts) guards an omzetdag parsed out of a Z-rapport. Same window, same reasoning;
// kept separate because that one is part of a pure spreadsheet normalizer with dated fixtures.
// A third caller of either is the moment to merge them.

/** Before this, no bookkeeping in this app can be real. Deliberately far below any live account. */
export const PAYMENT_DATE_FLOOR = "2000-01-01";

/** The date-only shape every stored betaaldatum has. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a date-only string that could NOT be a real payment day?
 *
 * True for: a wrong shape, a day that does not exist on the calendar ("2026-02-31"), anything
 * before PAYMENT_DATE_FLOOR, and anything after tomorrow in Amsterdam.
 */
export function paymentDateOutOfWindow(iso: string, todayAmsterdam: string): boolean {
  if (!ISO_DAY.test(iso)) return true;
  // "2026-02-31" passes the regex and is not a day. Date.UTC normalises it to March 3rd, so the
  // round-trip disagreeing with the input is the proof. Same test as the turnover importer's.
  const [y, m, d] = iso.split("-").map(Number);
  const round = new Date(Date.UTC(y, m - 1, d));
  if (round.getUTCFullYear() !== y || round.getUTCMonth() + 1 !== m || round.getUTCDate() !== d) return true;

  if (iso < PAYMENT_DATE_FLOOR) return true;

  const tomorrow = new Date(`${todayAmsterdam}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return iso > tomorrow.toISOString().slice(0, 10);
}

/**
 * The sentence the owner reads when a date is refused. One wording for every door, so a
 * betaaldatum is explained the same way on the Kas page and on Inkoopfacturen.
 */
export const PAYMENT_DATE_REFUSAL =
  "Controleer de datum — een betaling kan niet in de toekomst liggen, en het jaartal moet kloppen.";
