// [BILLING] Pure node test for the Stripe-shape helpers.
//   run: npx tsx --test src/lib/billing.test.ts
//
// These cover the two pure functions in billing.ts — everything else in that
// module is a call to Stripe and belongs in the manual test-mode checklist in
// docs/BILLING.md, not here.
//
// subscriptionPeriodEnd is the reason this file exists. On the API version this
// SDK ships with (2026-06-24.dahlia) Stripe MOVED current_period_end off the
// subscription and onto its items. Every pre-2026 tutorial still reads the old
// path, which now yields undefined → we would store NULL → the access decision
// would read "no paid period" → a customer who cancelled but has three paid
// weeks left gets locked out immediately. That failure is completely invisible
// until it hits a real, paying, already-annoyed customer, so it is pinned here.

import { subscriptionPeriodEnd, epochToIso } from "./billing";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const AT = Date.parse("2026-08-20T10:00:00.000Z") / 1000; // epoch seconds
const LATER = Date.parse("2026-09-20T10:00:00.000Z") / 1000;

console.log("\n[BILLING] subscriptionPeriodEnd — reads the ITEM, not the subscription");

check(
  "reads current_period_end off the subscription item",
  subscriptionPeriodEnd({ items: { data: [{ current_period_end: AT }] } }) ===
    "2026-08-20T10:00:00.000Z"
);

check(
  "a multi-item subscription is paid until its LATEST item ends",
  subscriptionPeriodEnd({
    items: { data: [{ current_period_end: AT }, { current_period_end: LATER }] },
  }) === "2026-09-20T10:00:00.000Z"
);

check(
  "item order does not matter — still the latest",
  subscriptionPeriodEnd({
    items: { data: [{ current_period_end: LATER }, { current_period_end: AT }] },
  }) === "2026-09-20T10:00:00.000Z"
);

console.log("\n[BILLING] the old (pre-2026) shape must not silently pass");

check(
  "a subscription with the period ONLY at the top level yields null, not a wrong date",
  // This is exactly the object shape every old tutorial assumes. If someone
  // ever 'simplifies' the function back to sub.current_period_end, this test is
  // what tells them — loudly — that they just broke cancelled-but-paid access.
  subscriptionPeriodEnd({ current_period_end: AT } as never) === null
);

console.log("\n[BILLING] malformed input degrades to null, never to a bogus date");

check("no items key → null", subscriptionPeriodEnd({}) === null);
check("items null → null", subscriptionPeriodEnd({ items: null }) === null);
check("empty data array → null", subscriptionPeriodEnd({ items: { data: [] } }) === null);
check(
  "item without the field → null",
  subscriptionPeriodEnd({ items: { data: [{}] } }) === null
);
check(
  "item with null field → null",
  subscriptionPeriodEnd({ items: { data: [{ current_period_end: null }] } }) === null
);
check(
  "NaN is filtered out rather than becoming an Invalid Date",
  subscriptionPeriodEnd({ items: { data: [{ current_period_end: NaN }] } }) === null
);
check(
  "one good item among broken ones still wins",
  subscriptionPeriodEnd({
    items: { data: [{ current_period_end: null }, { current_period_end: AT }] },
  }) === "2026-08-20T10:00:00.000Z"
);

console.log("\n[BILLING] epochToIso");

check("converts Stripe seconds to ISO", epochToIso(AT) === "2026-08-20T10:00:00.000Z");
check("null → null", epochToIso(null) === null);
check("undefined → null", epochToIso(undefined) === null);
check("NaN → null", epochToIso(NaN) === null);
check("Infinity → null", epochToIso(Infinity) === null);
check("epoch 0 is a real date, not falsy-dropped", epochToIso(0) === "1970-01-01T00:00:00.000Z");

console.log(`\n[BILLING] ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
