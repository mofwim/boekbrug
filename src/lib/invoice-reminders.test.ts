// [REMINDERS] Pure node test for the reminder decision engine.
//   run: npx tsx invoice-reminders.test.ts
//
// In a financial app the two failure modes are asymmetric and BOTH bad:
//   · a FALSE SEND (reminding a paid / credit / paused invoice, or double-
//     sending a tier) burns the owner's relationship with their client;
//   · a FALSE SKIP (never reminding a genuinely overdue invoice) is the
//     missing cashflow the feature exists to recover.
// The tests hammer both, plus the timezone day-boundary and the "highest
// reached tier" anti-spam rule.

import {
  reminderTierDue,
  openstaandOf,
  dayNumberFromIso,
  amsterdamTodayDayNumber,
  type ReminderDecisionInput,
} from "./invoice-reminders";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A fully-valid, remindable base invoice. Tests override single fields.
// due day fixed via a known ISO; today is passed as a day-number so tests are
// deterministic (no real clock).
const DUE = "2026-06-01";
const dueDay = dayNumberFromIso(DUE) as number;
function base(overrides: Partial<ReminderDecisionInput> = {}): ReminderDecisionInput {
  return {
    dueDate: DUE,
    todayDayNumber: dueDay + 14, // exactly 14 days overdue
    offsets: [14, 30],
    sentOffsets: [],
    status: "sent",
    invoiceType: "factuur",
    direction: "outgoing",
    totalIncBtw: 1000,
    amountPaid: 0,
    clientEmail: "klant@example.com",
    remindersPaused: false,
    ...overrides,
  };
}

console.log("\n— MUST SEND: real overdue money —");
check("14 days overdue, nothing sent → tier 14",
  reminderTierDue(base()) === 14);
check("30 days overdue, tier 14 already sent → tier 30",
  reminderTierDue(base({ todayDayNumber: dueDay + 30, sentOffsets: [14] })) === 30);
check("35 days overdue, nothing sent → tier 30 (skips 14, no spam)",
  reminderTierDue(base({ todayDayNumber: dueDay + 35 })) === 30);
check("20 days overdue, nothing sent → tier 14 (highest reached)",
  reminderTierDue(base({ todayDayNumber: dueDay + 20 })) === 14);
check("status 'overdue' is remindable too",
  reminderTierDue(base({ status: "overdue" })) === 14);

console.log("\n— MUST SKIP: paid / settled —");
check("status paid → null",
  reminderTierDue(base({ status: "paid" })) === null);
check("amount_paid covers total → null (settled, status not yet flipped)",
  reminderTierDue(base({ amountPaid: 1000 })) === null);
check("amount_paid within a cent of total → null",
  reminderTierDue(base({ amountPaid: 999.995 })) === null);
check("partial pay (still owed) → still reminds",
  reminderTierDue(base({ amountPaid: 400 })) === 14);

console.log("\n— MUST SKIP: not eligible —");
check("credit note (negative total) → null",
  reminderTierDue(base({ totalIncBtw: -1000 })) === null);
check("zero total → null",
  reminderTierDue(base({ totalIncBtw: 0 })) === null);
check("wrong type (creditnota) → null",
  reminderTierDue(base({ invoiceType: "creditnota" })) === null);
check("wrong type (offerte) → null",
  reminderTierDue(base({ invoiceType: "offerte" })) === null);
check("incoming direction → null",
  reminderTierDue(base({ direction: "incoming" })) === null);
check("draft status → null",
  reminderTierDue(base({ status: "draft" })) === null);
check("no client e-mail → null",
  reminderTierDue(base({ clientEmail: null })) === null);
check("blank client e-mail → null",
  reminderTierDue(base({ clientEmail: "   " })) === null);
check("reminders paused on invoice → null",
  reminderTierDue(base({ remindersPaused: true })) === null);
// [CREDITNOTA-NO-CHASE] The worst FALSE SEND of all: the owner already withdrew the demand
// with a creditnota, and the cron keeps mailing their customer "please pay". A credited
// invoice deliberately keeps its 'sent' status, its positive total and its due date (the
// +omzet must stay to be netted by the creditnota), so EVERY other guard passes it.
check("invoice withdrawn with a creditnota → null",
  reminderTierDue(base({ hasCreditnota: true })) === null);
check("credited invoice is skipped even when a tier is squarely due",
  reminderTierDue(base({ hasCreditnota: true, todayDayNumber: dueDay + 60 })) === null);
check("credited invoice is skipped even when nothing was paid",
  reminderTierDue(base({ hasCreditnota: true, amountPaid: 0 })) === null);
check("credited invoice is skipped even when partly paid",
  reminderTierDue(base({ hasCreditnota: true, amountPaid: 400 })) === null);
check("hasCreditnota false leaves the invoice remindable",
  reminderTierDue(base({ hasCreditnota: false })) !== null);
check("hasCreditnota absent leaves the invoice remindable (unchanged default)",
  reminderTierDue(base({})) !== null);
check("no due date → null",
  reminderTierDue(base({ dueDate: null })) === null);
check("malformed due date → null",
  reminderTierDue(base({ dueDate: "not-a-date" })) === null);

console.log("\n— TIMING edges —");
check("due today (0 overdue) → null",
  reminderTierDue(base({ todayDayNumber: dueDay })) === null);
check("1 day overdue, before first tier → null",
  reminderTierDue(base({ todayDayNumber: dueDay + 1 })) === null);
check("13 days overdue (one short of tier 14) → null",
  reminderTierDue(base({ todayDayNumber: dueDay + 13 })) === null);
check("29 days overdue, tier 14 sent → null (tier 30 not reached)",
  reminderTierDue(base({ todayDayNumber: dueDay + 29, sentOffsets: [14] })) === null);

console.log("\n— IDEMPOTENCY: never double-send a tier —");
check("14 overdue but tier 14 already sent → null",
  reminderTierDue(base({ sentOffsets: [14] })) === null);
check("30 overdue, both tiers sent → null",
  reminderTierDue(base({ todayDayNumber: dueDay + 30, sentOffsets: [14, 30] })) === null);
check("35 overdue, tier 30 already sent → null (no fallback to 14)",
  reminderTierDue(base({ todayDayNumber: dueDay + 35, sentOffsets: [30] })) === null);

console.log("\n— SCHEDULE hygiene —");
check("empty schedule → null",
  reminderTierDue(base({ offsets: [] })) === null);
check("unsorted/dirty schedule {30,14,14,-5,0} still yields tier 14 at day 14",
  reminderTierDue(base({ offsets: [30, 14, 14, -5, 0] })) === 14);
check("single-tier schedule {7} at 7 days → tier 7",
  reminderTierDue(base({ offsets: [7], todayDayNumber: dueDay + 7 })) === 7);

console.log("\n— openstaand: the ONLY amount a reminder may show —");
check("fully unpaid → full total",
  openstaandOf(1000, 0) === 1000);
check("partial paid → remaining only (not the total)",
  openstaandOf(1000, 400) === 600);
check("paid to the cent → 0",
  openstaandOf(1000, 1000) === 0);
check("over-linked payment → clamps to 0 (never negative)",
  openstaandOf(1000, 1200) === 0);
check("negative amount_paid ignored → full total",
  openstaandOf(1000, -50) === 1000);
check("creditnota sign stripped → magnitude",
  openstaandOf(-1000, 0) === 1000);
check("float noise rounded to cents",
  openstaandOf(1000, 400.004) === 600);
check("null total → 0",
  openstaandOf(null, 0) === 0);
check("NaN paid treated as 0",
  openstaandOf(1000, NaN) === 1000);

console.log("\n— helpers —");
check("dayNumberFromIso parses date prefix",
  dayNumberFromIso("2026-06-01T00:00:00Z") === dueDay);
check("dayNumberFromIso null on junk",
  dayNumberFromIso("junk") === null);
check("amsterdamTodayDayNumber returns a finite integer",
  Number.isInteger(amsterdamTodayDayNumber()));
check("amsterdamTodayDayNumber fixed instant is stable",
  amsterdamTodayDayNumber(new Date("2026-06-01T10:00:00Z")) === dueDay);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
