// [BILLING] Pure node test for the access decision.
//   run: npx tsx --test src/lib/subscription.test.ts
//
// The two failure modes are asymmetric and only ONE of them is expensive:
//   · a FALSE LOCKOUT shuts a real (often paying) customer out of their own
//     bookkeeping — at a BTW deadline that is how you lose them, and it is
//     always caused by OUR bug: a column that does not exist yet, a NULL, a
//     status string Stripe added last month, a clock that drifted;
//   · a FALSE PASS gives somebody a few extra days of an app they were already
//     using, and costs effectively nothing.
// So the bulk of these tests hammer the lockout side: every ambiguous, missing
// or malformed input MUST still resolve to allowed. A deny is only ever correct
// when the data positively proves the account has no claim left.

import {
  decideAccess,
  daysUntil,
  parseTimestamp,
  isKnownStatus,
  trialBanner,
  normalizeStripeStatus,
  type AccessInput,
} from "./subscription";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A fixed, known "now" so nothing here depends on the real clock.
const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A paying ZZP'er. Tests override single fields. */
function base(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    role: "zzper",
    subscriptionStatus: "active",
    trialEndsAt: null,
    currentPeriodEnd: iso(NOW + 20 * DAY),
    nowMs: NOW,
    ...overrides,
  };
}

console.log("\n[BILLING] access decision — the happy paths");

check(
  "an active subscriber is allowed",
  decideAccess(base()).allowed === true &&
    decideAccess(base()).reason === "active"
);

check(
  "a user inside the trial is allowed and sees days left",
  (() => {
    const d = decideAccess(
      base({ subscriptionStatus: "trialing", trialEndsAt: iso(NOW + 5 * DAY), currentPeriodEnd: null })
    );
    return d.allowed && d.reason === "trialing" && d.trialDaysLeft === 5;
  })()
);

check(
  "an accountant is never billed — allowed with no subscription at all",
  (() => {
    const d = decideAccess(
      base({ role: "accountant", subscriptionStatus: "none", trialEndsAt: iso(NOW - 90 * DAY), currentPeriodEnd: null })
    );
    return d.allowed && d.reason === "accountant";
  })()
);

console.log("\n[BILLING] the deny paths — a deny needs positive proof");

check(
  "an expired trial with nothing paid is denied",
  (() => {
    const d = decideAccess(
      base({ subscriptionStatus: "trialing", trialEndsAt: iso(NOW - DAY), currentPeriodEnd: null })
    );
    return d.allowed === false && d.reason === "trial_expired";
  })()
);

check(
  "a cancelled subscription whose paid period has run out is denied",
  (() => {
    const d = decideAccess(
      base({ subscriptionStatus: "canceled", trialEndsAt: iso(NOW - 90 * DAY), currentPeriodEnd: iso(NOW - DAY) })
    );
    return d.allowed === false && d.reason === "subscription_ended";
  })()
);

check(
  "'unpaid' with no period left is denied",
  decideAccess(
    base({ subscriptionStatus: "unpaid", trialEndsAt: null, currentPeriodEnd: iso(NOW - DAY) })
  ).allowed === false
);

console.log("\n[BILLING] FALSE LOCKOUT hunt — every ambiguity must still let the user in");

check(
  "migration not applied: every billing field null → allowed",
  (() => {
    const d = decideAccess(
      base({ subscriptionStatus: null, trialEndsAt: null, currentPeriodEnd: null })
    );
    return d.allowed === true && d.reason === "unknown_state";
  })()
);

check(
  "status set but trial timestamp NULL → allowed (never lock out on a missing date)",
  decideAccess(
    base({ subscriptionStatus: "trialing", trialEndsAt: null, currentPeriodEnd: null })
  ).allowed === true
);

check(
  "unparseable trial timestamp → allowed, not treated as expired",
  decideAccess(
    base({ subscriptionStatus: "trialing", trialEndsAt: "not-a-date", currentPeriodEnd: null })
  ).allowed === true
);

check(
  "empty-string status → allowed",
  decideAccess(base({ subscriptionStatus: "", trialEndsAt: null, currentPeriodEnd: null })).allowed === true
);

check(
  "a Stripe status we do not model → allowed",
  decideAccess(
    base({ subscriptionStatus: "some_future_stripe_state", trialEndsAt: iso(NOW - DAY), currentPeriodEnd: null })
  ).allowed === true
);

check(
  "payment retrying (past_due) → allowed; a failing card is not a departure",
  (() => {
    const d = decideAccess(
      base({ subscriptionStatus: "past_due", trialEndsAt: null, currentPeriodEnd: iso(NOW - DAY) })
    );
    return d.allowed === true && d.reason === "grace_period";
  })()
);

check(
  "collection paused → allowed",
  decideAccess(
    base({ subscriptionStatus: "paused", trialEndsAt: null, currentPeriodEnd: null })
  ).allowed === true
);

check(
  "cancelled but the paid period still runs → allowed until it ends",
  (() => {
    const d = decideAccess(
      base({ subscriptionStatus: "canceled", trialEndsAt: null, currentPeriodEnd: iso(NOW + 10 * DAY) })
    );
    return d.allowed === true && d.reason === "grace_period";
  })()
);

check(
  "failed checkout mid-trial ('incomplete') must NOT eat the remaining trial days",
  (() => {
    const d = decideAccess(
      base({ subscriptionStatus: "incomplete", trialEndsAt: iso(NOW + 11 * DAY), currentPeriodEnd: null })
    );
    return d.allowed === true && d.reason === "trialing" && d.trialDaysLeft === 11;
  })()
);

check(
  "'incomplete' AFTER the trial ran out is denied (proof, not ambiguity)",
  decideAccess(
    base({ subscriptionStatus: "incomplete", trialEndsAt: iso(NOW - DAY), currentPeriodEnd: null })
  ).allowed === false
);

check(
  "an accountant is allowed even when every field is null",
  decideAccess({
    role: "accountant",
    subscriptionStatus: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    nowMs: NOW,
  }).allowed === true
);

console.log("\n[BILLING] the accountant exemption needs EVIDENCE, not a claim");

// `role` is picked by the user on the signup form (register/page.tsx), so on its
// own it is a free-forever button anybody can press. These pin the fix.

check(
  "a REAL accountant — role plus a consented client link — is exempt",
  (() => {
    const d = decideAccess(
      base({ role: "accountant", subscriptionStatus: "none", trialEndsAt: iso(NOW - 90 * DAY), currentPeriodEnd: null, hasAccountantClients: true })
    );
    return d.allowed === true && d.reason === "accountant";
  })()
);

check(
  "a self-declared 'accountant' with NO client link and an expired trial is refused",
  (() => {
    const d = decideAccess(
      base({ role: "accountant", subscriptionStatus: "none", trialEndsAt: iso(NOW - DAY), currentPeriodEnd: null, hasAccountantClients: false })
    );
    return d.allowed === false;
  })()
);

check(
  "a brand-new accountant with no client yet is NOT stranded — the trial still carries them",
  (() => {
    const d = decideAccess(
      base({ role: "accountant", subscriptionStatus: "trialing", trialEndsAt: iso(NOW + 20 * DAY), currentPeriodEnd: null, hasAccountantClients: false })
    );
    return d.allowed === true && d.reason === "trialing";
  })()
);

check(
  "an unchecked accountant (undefined) stays exempt — ambiguity favours the user",
  decideAccess(
    base({ role: "accountant", subscriptionStatus: "none", trialEndsAt: iso(NOW - 90 * DAY), currentPeriodEnd: null })
  ).allowed === true
);

check(
  "a linked accountant is exempt even while their own trial is long gone",
  decideAccess(
    base({ role: "accountant", subscriptionStatus: "canceled", trialEndsAt: iso(NOW - 400 * DAY), currentPeriodEnd: iso(NOW - 300 * DAY), hasAccountantClients: true })
  ).reason === "accountant"
);

check(
  "hasAccountantClients is irrelevant for a zzper — it never grants a ZZP'er anything",
  decideAccess(
    base({ role: "zzper", subscriptionStatus: "none", trialEndsAt: iso(NOW - DAY), currentPeriodEnd: null, hasAccountantClients: true })
  ).allowed === false
);

console.log("\n[BILLING] trial clock arithmetic");

check("6 hours left still reads as 1 day, never 0", daysUntil(NOW + DAY / 4, NOW) === 1);
check("exactly 5 days reads as 5", daysUntil(NOW + 5 * DAY, NOW) === 5);
check("an end in the past floors at 0, never negative", daysUntil(NOW - 10 * DAY, NOW) === 0);

check(
  "the very last moment of the trial is still inside it",
  decideAccess(
    base({ subscriptionStatus: "trialing", trialEndsAt: iso(NOW + 1), currentPeriodEnd: null })
  ).allowed === true
);

check(
  "the exact expiry instant is outside the trial",
  decideAccess(
    base({ subscriptionStatus: "trialing", trialEndsAt: iso(NOW), currentPeriodEnd: null })
  ).allowed === false
);

console.log("\n[BILLING] helpers");

check("parseTimestamp(null) is null", parseTimestamp(null) === null);
check("parseTimestamp(garbage) is null", parseTimestamp("nonsense") === null);
check("parseTimestamp(iso) round-trips", parseTimestamp(iso(NOW)) === NOW);

check("isKnownStatus accepts a modelled state", isKnownStatus("active"));
check("isKnownStatus rejects an unmodelled state", !isKnownStatus("brand_new_state"));

check("normalizeStripeStatus maps incomplete_expired → canceled", normalizeStripeStatus("incomplete_expired") === "canceled");
check("normalizeStripeStatus maps active → active", normalizeStripeStatus("active") === "active");
check("normalizeStripeStatus maps an unknown value → none", normalizeStripeStatus("who_knows") === "none");
check("normalizeStripeStatus maps null → none", normalizeStripeStatus(null) === "none");

console.log("\n[BILLING] the banner only interrupts when it is worth interrupting");

const trialing = (days: number) =>
  decideAccess(base({ subscriptionStatus: "trialing", trialEndsAt: iso(NOW + days * DAY), currentPeriodEnd: null }));

check("no banner on day 1 of a 14-day trial", trialBanner(trialing(14)) === null);
check("banner appears at 7 days", trialBanner(trialing(7))?.daysLeft === 7);
check("banner is not urgent at 7 days", trialBanner(trialing(7))?.urgent === false);
check("banner is urgent at 3 days", trialBanner(trialing(3))?.urgent === true);
check("no banner for an active subscriber", trialBanner(decideAccess(base())) === null);
check("no banner for an accountant", trialBanner(decideAccess(base({ role: "accountant" }))) === null);

console.log(`\n[BILLING] ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
