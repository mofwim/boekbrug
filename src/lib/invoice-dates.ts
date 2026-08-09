// src/lib/invoice-dates.ts
// [FACTUUR-DATUMS] A due date cannot precede the invoice it belongs to. Pure, no I/O.
// Run: npx tsx --test src/lib/invoice-dates.test.ts
//
// WHAT THIS PREVENTS, MEASURED
// Nothing checked it — not the create route, not the edit route, not the screen. An invoice dated
// 08-08 with a due date of 01-08 was perfectly acceptable to this app.
//
// The consequence is not cosmetic. cron/reminders selects invoices with status sent or overdue and
// works out the reminder tier from due_date, so such an invoice is PAST DUE the moment it is
// issued. The customer receives the invoice and a payment reminder for it, possibly on the same
// day, for a bill they have had for an hour. On the final tier that reminder carries the statutory
// aanmaning and names collection costs.
//
// Normally the screen computes the due date as invoice date + term, so this cannot arise there.
// It arises from the edit screen, where the date is typed, and from anything that is not the
// screen. Which is exactly why the check belongs on the server.
//
// WHY DATES ARE COMPARED AS STRINGS
// These columns are DATE, not timestamp — "2026-08-08", no zone. Parsing them into Date objects
// introduces a timezone the data does not have, and this codebase already carries a scar from
// that ([TZ] in the invoice screen: an unpinned format rendered a day early west of UTC). ISO
// dates sort lexically, so a string comparison is both simpler and exactly right.

/** YYYY-MM-DD, and a real one — 2026-13-45 must not read as a date. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  const s = String(v ?? "").trim();
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Round-trips only for a day that exists: 2026-02-30 becomes 2026-03-02 and fails here.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export type DateCheck = { ok: true } | { ok: false; code: "due_before_invoice"; error: string };

/**
 * May these two dates sit on one document?
 *
 * Anything unusable — a missing date, a malformed one — returns ok. Those have their own refusals
 * elsewhere (the send route enforces a real invoice_date before minting a number), and a second,
 * differently-worded complaint about one mistake helps nobody.
 *
 * Equal dates are allowed: "betaling bij ontvangst" is a real term.
 */
export function checkInvoiceDates(args: {
  invoiceDate?: string | null;
  dueDate?: string | null;
}): DateCheck {
  const inv = String(args.invoiceDate ?? "").trim();
  const due = String(args.dueDate ?? "").trim();
  if (!isIsoDate(inv) || !isIsoDate(due)) return { ok: true };
  if (due >= inv) return { ok: true };

  return {
    ok: false,
    code: "due_before_invoice",
    // Dutch: this goes to the screen. It names both dates, because an owner staring at one field
    // cannot see which of the two is the one they mistyped.
    error:
      `De vervaldatum (${nl(due)}) ligt vóór de factuurdatum (${nl(inv)}). Zo'n factuur is al ` +
      "verlopen op het moment dat je hem verstuurt: je klant krijgt de factuur en de " +
      "betalingsherinnering vrijwel tegelijk. Kies een vervaldatum op of ná de factuurdatum.",
  };
}

/** DD-MM-YYYY, the way a Dutch invoice writes a date. Local to this module — no I/O, no Date. */
function nl(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
