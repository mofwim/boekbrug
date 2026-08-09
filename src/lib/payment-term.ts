// src/lib/payment-term.ts
// [BETAALTERMIJN] The payment term, and the sentence that states it. Pure, no I/O.
// Run: npx tsx --test src/lib/payment-term.test.ts
//
// WHY THIS EXISTS
// The edit screen printed "Gelieve te betalen binnen 30 dagen op <IBAN>". The 30 was a LITERAL —
// not derived from anything, not editable, and not necessarily true. An owner who set a due date
// of fourteen days was still shown a sentence promising thirty, on the screen where they were
// checking the invoice before sending it. The number was decoration on a document about money.
//
// The app already knows the real term: it is the distance between invoice_date and due_date, and
// due_date is what the PDF prints and what every reminder counts from. So there is no new column
// and no second truth here — only the arithmetic that was missing, in one place, so a screen can
// state the term instead of asserting one.
//
// The chips on the new-invoice screen were 14 / 30 / 60 and nothing else. A term is a thing an
// owner agrees per customer ("jij krijgt 45 dagen"), so any whole number is allowed, and the
// bounds below exist only to keep a typo out of the database.

import { daysBetween, addDays } from "./recurring";

/** The terms most owners use, offered as one tap. Not a limit — see parsePaymentTerm. */
export const COMMON_PAYMENT_TERMS = [14, 30, 60] as const;

/** The default for a new invoice. Unchanged — this file did not invent it. */
export const DEFAULT_PAYMENT_TERM = 30;

/**
 * The widest term the app will store.
 *
 * Not a policy about what an owner may agree — it is a typo guard. "300" instead of "30" would put
 * a due date in 2027 on an invoice from today, and every reminder tier would then wait most of a
 * year before chasing money the owner thinks is overdue. A year is well past any real term.
 */
export const MAX_PAYMENT_TERM_DAYS = 365;

/**
 * Read a term the owner typed.
 *
 * Returns null for anything that is not a usable whole number of days, so a caller shows the field
 * as unset rather than silently substituting a number the owner did not choose. Zero is allowed:
 * "betaling bij ontvangst" is a real term, and refusing it would push an owner into typing 1.
 */
export function parsePaymentTerm(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else {
    // EMPTY IS NOT ZERO. Number("") and Number("   ") are both 0, and zero is a term this function
    // deliberately accepts ("betaling bij ontvangst") — so without this guard an untouched field
    // parsed as "pay immediately", a due date of today, and an invoice overdue the next morning.
    // The negative control found it: null, undefined and "" all came back as 0.
    const text = String(raw ?? "").trim().replace(",", ".");
    if (text.length === 0) return null;
    n = Number(text);
  }
  if (!Number.isFinite(n)) return null;
  const days = Math.round(n);
  if (days < 0 || days > MAX_PAYMENT_TERM_DAYS) return null;
  return days;
}

/** The due date for an invoice dated `invoiceDateIso` with a term of `days`. */
export function dueDateFromTerm(invoiceDateIso: string, days: number): string {
  return addDays(invoiceDateIso, days);
}

/**
 * The term two dates actually describe, or null when they cannot describe one.
 *
 * This is the direction that was missing. A screen that wants to SAY the term must derive it from
 * the dates it is showing — otherwise the sentence and the date can disagree, which is exactly
 * what "binnen 30 dagen" over a fourteen-day due date was doing.
 *
 * A negative distance returns null rather than a negative term: a due date before the invoice date
 * is a data problem, and "binnen -3 dagen" is not a sentence anyone should read.
 */
export function termFromDates(invoiceDateIso: string, dueDateIso: string): number | null {
  const days = daysBetween(invoiceDateIso, dueDateIso);
  if (days == null || days < 0) return null;
  return days;
}

/**
 * The Dutch sentence about paying, built from what is actually true.
 *
 * Returns null when there is nothing honest to say — no IBAN, or dates that describe no term. A
 * screen showing nothing is better than a screen showing a number it made up, which is the defect
 * this file replaces.
 */
export function paymentTermText(args: {
  invoiceDateIso: string | null | undefined;
  dueDateIso: string | null | undefined;
  iban: string | null | undefined;
}): string | null {
  const iban = (args.iban ?? "").trim();
  if (!iban) return null;
  const from = (args.invoiceDateIso ?? "").trim();
  const to = (args.dueDateIso ?? "").trim();
  if (!from || !to) return null;

  const days = termFromDates(from, to);
  if (days == null) return null;
  if (days === 0) return "Gelieve direct te betalen op";
  if (days === 1) return "Gelieve te betalen binnen 1 dag op";
  return `Gelieve te betalen binnen ${days} dagen op`;
}

// ─── [BETAALTERMIJN-LANG] A term long enough to be worth a word ────────────────────────────────
//
// MAX_PAYMENT_TERM_DAYS is 365 and nothing said anything at 180. That ceiling is right — the app
// must not decide what an owner may agree with their customer — but silence at six months is not
// neutral either.
//
// Dutch law puts a soft edge at thirty days and a hard one at sixty (art. 6:119a BW, from the EU
// late-payment directive). Between businesses a term over sixty days holds only if it was
// expressly agreed and is not grossly unfair to the creditor; agreed against a LARGE company it
// does not hold at all. Toward a consumer thirty days is the norm.
//
// So this warns and never blocks. Which of those cases an owner is in depends on the contract and
// on who the customer is — neither of which this app knows — and an owner who has genuinely agreed
// a ninety-day term with a client should not have to fight their own invoicing tool.

/** Above this a B2B term needs an explicit agreement to hold. */
export const LONG_PAYMENT_TERM_DAYS = 60;

/**
 * A sentence for a term worth a second look, or null for an ordinary one.
 *
 * Null for everything up to and including sixty days, which is nearly every invoice — so nothing
 * appears where nothing needs to.
 */
export function longPaymentTermNotice(days: number | null | undefined): string | null {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= LONG_PAYMENT_TERM_DAYS) return null;
  return (
    `${d} dagen is een lange betaaltermijn. Tussen bedrijven geldt een termijn boven de ` +
    `${LONG_PAYMENT_TERM_DAYS} dagen alleen als je die uitdrukkelijk hebt afgesproken en hij niet ` +
    "onredelijk is voor jou als schuldeiser; tegenover een grote onderneming houdt zo'n afspraak " +
    "helemaal geen stand (art. 6:119a BW). Naar een particulier is 30 dagen gebruikelijk. " +
    "Klopt de afspraak? Dan kun je gewoon doorgaan."
  );
}
