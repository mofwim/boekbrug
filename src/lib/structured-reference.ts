// src/lib/structured-reference.ts
// [GESTRUCTUREERD] The references a bank routes on. Pure.
// Run: npx tsx --test src/lib/structured-reference.test.ts
//
// A bank does not guess. When a payment carries a STRUCTURED creditor reference it is matched on
// that reference and on nothing else, because the reference carries its own checksum: it is either
// the one the invoice asked for or it is not, and no amount of resemblance changes that.
//
// Two of them reach a Dutch administration:
//
//   ISO 11649 — "RF18 5390 0754 7034". The European creditor reference: RF, two check digits, up
//   to 21 characters the creditor chose. Standard on e-invoices, on foreign suppliers' bills, and
//   increasingly on Dutch ones. Printed in groups of four, always.
//
//   Belgische gestructureerde mededeling — "+++090/9337/55493+++". Twelve digits where the last
//   two are the first ten mod 97 (with 0 read as 97). Every Belgian invoice has one, and a Dutch
//   zzp'er with Belgian customers or suppliers sees them constantly.
//
// ── WHAT THIS FIXES, MEASURED ──
//
// referenceMatches builds its haystack by stripping punctuation and KEEPING SPACES, deliberately:
// spaces are token boundaries, and fusing "12345 1001" into one digit run would let a short
// invoice number match a slice of a longer one. Correct — and it means the reference as the bank
// actually prints it does not match the reference as the invoice stores it:
//
//     bank text   "RF18 5390 0754 7034"
//     invoice     "RF18539007547034"
//     result      MISS
//
// The same reference unspaced matched fine, so this failed exactly where it is most standardised.
//
// ── WHY MATCHING ON IT IS SAFE, AND WHY THE CHECKSUM IS NOT DECORATION ──
//
// Fusing the whole text and searching again would have found it — and would also have fused
// "1234 5678" into "12345678", handing an eight-digit invoice number a match it was never given.
// So nothing is fused. Instead the structured references are EXTRACTED and VALIDATED, and only
// then compared, whole, to what the invoice asks for. A random run of characters passes mod-97
// once in 97 tries; a random run that also has RF's shape, and also equals this invoice's own
// stored reference, does not happen.

/** Letters → digits, ISO 7064 style (A=10 … Z=35), then remainder mod 97 without BigInt. */
function mod97(alphanumeric: string): number {
  let remainder = 0;
  for (const ch of alphanumeric) {
    const code = ch.charCodeAt(0);
    const value = code >= 48 && code <= 57 ? ch : (code - 55).toString();
    for (const d of value) {
      remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder;
}

/** Which kind of structured reference this is. */
export type StructuredKind = "rf" | "be";

export interface StructuredReference {
  kind: StructuredKind;
  /** Canonical form: RF references upper-case without spaces; Belgian ones as twelve digits. */
  value: string;
}

/**
 * Is this a valid ISO 11649 creditor reference? Accepts it spaced or not, in any case.
 *
 * The checksum moves "RF" + the two check digits to the end and asks for a remainder of 1 —
 * the same ISO 7064 mod-97-10 an IBAN uses (see isValidIban in epc-qr.ts, which does this for a
 * different alphabet and a different length; sharing one helper across the two would mean one
 * function that is right about neither's rules).
 */
export function isValidRfReference(raw: string | null | undefined): boolean {
  if (!raw) return false;
  // Spaces AND hyphens: the standard prints groups separated by spaces, and an invoice stores
  // whatever the supplier typed — a hyphenated form is not standard printing but it is a real
  // thing to find in a payment_reference field, and it is unambiguous.
  const ref = raw.replace(/[\s-]+/g, "").toUpperCase();
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(ref)) return false;
  return mod97(ref.slice(4) + ref.slice(0, 4)) === 1;
}

/**
 * Is this a valid Belgian gestructureerde mededeling? Accepts "+++090/9337/55493+++",
 * "090/9337/55493" or twelve bare digits.
 *
 * The last two digits are the first ten mod 97, and a remainder of 0 is written as 97 — a rule
 * that exists because a check digit of "00" would be indistinguishable from an unfilled field.
 */
export function isValidBelgianReference(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length !== 12) return false;
  const body = Number(digits.slice(0, 10));
  const check = Number(digits.slice(10));
  if (!Number.isSafeInteger(body)) return false;
  const expected = body % 97 === 0 ? 97 : body % 97;
  return check === expected;
}

/**
 * Every VALID structured reference printed in this text, in the order found.
 *
 * Invalid ones are dropped in silence on purpose: a failed checksum means the characters are not
 * a structured reference at all (an order number that happens to start with RF, a twelve-digit
 * customer number), and reporting it as one would put the guessing back that this module exists
 * to remove.
 */
export function structuredReferences(text: string | null | undefined): StructuredReference[] {
  if (!text) return [];
  const out: StructuredReference[] = [];
  const seen = new Set<string>();

  const upper = text.toUpperCase();

  // RF: find each start, take the run that could belong to it, and keep the LONGEST prefix that
  // passes the checksum.
  //
  // Not one greedy regex. "RF18 5390 0754 7034 TNV X" is the ordinary shape of a statement line,
  // and a pattern that accepts groups of up to four characters happily swallows TNV as one more
  // group — the candidate is then four characters too long, fails mod-97, and the reference the
  // bank printed goes unrecognised. Measured exactly that way before this loop replaced it.
  // Walking the length down instead means the words after the reference cost nothing: only the
  // true length can validate.
  for (const m of upper.matchAll(/\bRF\d{2}/g)) {
    const start = m.index ?? 0;
    const run = upper.slice(start).match(/^RF\d{2}[0-9A-Z ]{0,32}/)?.[0] ?? "";
    // Whole GROUPS, never arbitrary character lengths. Walking down character by character tries
    // some twenty candidates, and mod-97 lets one in ninety-seven through by luck — a ~20% chance
    // of inventing a "reference" out of any RF-shaped junk. Groups are how the standard prints it
    // and how a statement line reads, so there are four or five candidates instead of twenty, and
    // the accepted one always ends where a printed group ends.
    //
    // The residual is stated rather than hidden: a coincidental short prefix remains possible.
    // That is why structuredReferenceMatches compares the found value to the reference THIS
    // INVOICE asks for instead of trusting the extraction on its own — a coincidence has to equal
    // a specific 16-character string to do any harm, which it does not.
    const groups = run.trim().split(/\s+/).filter(Boolean);
    for (let k = groups.length; k >= 1; k--) {
      const candidate = groups.slice(0, k).join("");
      if (candidate.length < 5 || !isValidRfReference(candidate)) continue;
      if (!seen.has(candidate)) {
        seen.add(candidate);
        out.push({ kind: "rf", value: candidate });
      }
      break; // the longest printed form wins
    }
  }

  // Belgian: the +++ / *** wrapped form, the bare slashed form, and twelve plain digits — but
  // never a slice of a longer digit run. A fifteen-digit customer number contains a twelve-digit
  // window, and one window in ninety-seven passes the checksum by luck.
  for (const m of text.matchAll(/(?:\+\+\+|\*\*\*)?\d{3}\/?\d{4}\/?\d{5}(?:\+\+\+|\*\*\*)?/g)) {
    const at = m.index ?? 0;
    const before = at > 0 ? text[at - 1] : "";
    const after = at + m[0].length < text.length ? text[at + m[0].length] : "";
    if (/[0-9]/.test(before) || /[0-9]/.test(after)) continue;
    const digits = m[0].replace(/[^0-9]/g, "");
    if (!isValidBelgianReference(digits) || seen.has(digits)) continue;
    seen.add(digits);
    out.push({ kind: "be", value: digits });
  }

  return out;
}

/**
 * Does this payment text carry a structured reference that IS the one this invoice asks for?
 *
 * `invoiceReference` is whatever the invoice stores — its betalingskenmerk or its number. It is
 * normalised the same way, so the invoice may hold it spaced, slashed or bare.
 *
 * False whenever anything is missing or invalid. This never widens a match on its own: it answers
 * a question about two exact strings, one of which had to survive a checksum.
 */
export function structuredReferenceMatches(
  text: string | null | undefined,
  invoiceReference: string | null | undefined,
): boolean {
  if (!text || !invoiceReference) return false;
  const wanted = structuredReferences(invoiceReference);
  if (wanted.length === 0) return false;
  const found = structuredReferences(text);
  if (found.length === 0) return false;
  return wanted.some((w) => found.some((f) => f.kind === w.kind && f.value === w.value));
}
