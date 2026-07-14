// [TRIANGLE] Pure node test — run: npx tsx src/lib/triangle.test.ts
import { reconcileTriangle, eftGrossByDay } from "./triangle";
import type { DailyTurnover } from "./turnover";
import type { EftSettlement } from "./eft-parser";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number, t = 0.02) => Math.abs(a - b) <= t;

const till = (date: string, pin: number, cash = 0): DailyTurnover => ({
  turnover_date: date, base_0: 0, base_9: 0, base_21: 0, btw_9: 0, btw_21: 0,
  total_incl: pin + cash, pin_amount: pin, cash_amount: cash, other_amount: 0,
});
const eft = (settlementDate: string, gross: number): EftSettlement => ({
  terminalId: "274865", periodNr: null, shiftNr: null,
  periodStart: null, periodEnd: null, firstTrx: null, lastTrx: null,
  settlementDate, grossTotal: gross, txCount: 0, byScheme: [],
});

console.log("\n— eftGrossByDay sums shifts on the same day —");
{
  const m = eftGrossByDay([eft("2026-07-12", 1000), eft("2026-07-12", 546.46), eft("2026-07-13", 200)]);
  check("two shifts on 07-12 summed to 1546.46", near(m.get("2026-07-12")!, 1546.46));
  check("07-13 = 200", near(m.get("2026-07-13")!, 200));
  check("null settlementDate skipped", eftGrossByDay([{ ...eft("x", 5), settlementDate: null }]).size === 0);
}

console.log("\n— full triangle on aligned days —");
{
  const res = reconcileTriangle({
    turnover: [till("2026-07-12", 1546.46), till("2026-07-13", 200)],
    eftSettlements: [eft("2026-07-12", 1546.46), eft("2026-07-13", 200)],
    bankNetByDay: new Map([["2026-07-12", 1520], ["2026-07-13", 197]]),
  });
  check("2 days reconciled", res.days.length === 2);
  check("both gross-match (till == EFT)", res.days.every((d) => d.grossMatch === true));
  check("total commission = 26.46 + 3 = 29.46", near(res.totalCommission, 29.46));
  check("no gross-mismatch days", res.grossMismatchDays === 0);
}

console.log("\n— ledger cross-check flows through —");
{
  const res = reconcileTriangle({
    turnover: [till("2026-07-03", 2086.65)],
    eftSettlements: [eft("2026-07-03", 2086.65)],
    pinLedgerByDay: new Map([["2026-07-03", 2086.65]]),
  });
  check("ledger agreement → no gross mismatch", res.grossMismatchDays === 0);
  const bad = reconcileTriangle({
    turnover: [till("2026-07-03", 2086.65)],
    eftSettlements: [eft("2026-07-03", 2086.65)],
    pinLedgerByDay: new Map([["2026-07-03", 2000]]),
  });
  check("ledger disagreement → gross mismatch day", bad.grossMismatchDays === 1);
}

console.log("\n— an EFT day with no till row is still surfaced (never dropped) —");
{
  const res = reconcileTriangle({
    turnover: [],
    eftSettlements: [eft("2026-07-12", 1546.46)],
  });
  check("the orphan EFT day appears", res.days.length === 1);
  check("it is incomplete (no till to verify against)", res.days[0].status === "incomplete");
}

console.log("\n— a bank payout on a day with no till/EFT is surfaced, not dropped —");
{
  const res = reconcileTriangle({
    turnover: [till("2026-07-12", 1546.46)],
    eftSettlements: [eft("2026-07-12", 1546.46)],
    bankNetByDay: new Map([["2026-07-13", 980]]), // mis-keyed / weekend-merged payout
  });
  check("the orphan bank day appears", res.days.some((d) => d.date === "2026-07-13"));
  check("orphan bank day is incomplete (no gross to verify against)",
    res.days.find((d) => d.date === "2026-07-13")?.status === "incomplete");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
