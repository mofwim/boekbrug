// src/lib/correction-scope.ts
// [KENMERK-NA-BETALING] Which corrections survive money being booked on an invoice. Pure.
// Run: npx tsx --test src/lib/correction-scope.test.ts
//
// ── WHY THIS EXCEPTION EXISTS ──
//
// /api/invoice/[id]/amounts refuses every correction once any money is settled (GUARD 3), and for
// the amounts that is exactly right: amount_paid is the sum of the bank lines applied to the
// invoice, and moving the total under a settled payment breaks the one identity the books rest on.
//
// But the guard was BLANKET, and paying in instalments made that reachable. The owner sends the
// first termijn, the bank confirms it, and from that moment the betaalkenmerk is frozen — while
// the second and third instalment still have to carry it. If the reader misread that reference,
// every remaining payment goes out wrong and there is no way to fix it short of unlinking a
// payment that is perfectly correct.
//
// ── WHY ONLY THIS ONE FIELD ──
//
// Each of the others has a consequence that settled money makes dangerous, and they were weighed
// rather than assumed:
//
//   · the amounts and the creditnota flip MOVE money — the reason the guard exists;
//   · invoice_date picks the BTW quarter, so changing it after a payment moves booked money
//     between aangiftes;
//   · invoice_number is the key the bank matcher linked the payment on — rewriting it can orphan
//     that link;
//   · client_name is the identity the matcher, the incasso check and the reading memory resolve on;
//   · vendor_iban is what the fraud check compares next month's invoice against, and letting it
//     change AFTER money moved is precisely the edit an attacker would want.
//
// payment_reference has none of those. It is what the owner types into their bank on the NEXT
// payment, it appears in no total, and it keys nothing that has already happened.
//
// Deliberately a list of ALLOWED fields, never of forbidden ones: a field added to the route
// tomorrow is then refused by default while money is settled, instead of slipping through because
// nobody remembered to add it here.

/** The only corrections that stay open once money is booked against an invoice. */
export const MONEY_FREE_CORRECTION_FIELDS: readonly string[] = ["payment_reference"];

/**
 * Does this request ask ONLY for corrections that settled money does not endanger?
 *
 * The body carries only the fields the owner actually moved (the editor sends nothing else), so
 * the keys ARE the intent. An empty body is false: nothing to do is not a reason to pass a guard.
 */
export function isMoneyFreeCorrection(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length === 0) return false;
  return keys.every((k) => MONEY_FREE_CORRECTION_FIELDS.includes(k));
}
