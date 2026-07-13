// [TURNOVER] Pure node test — run: npx tsx src/lib/turnover.test.ts
import {
  turnoverNetOmzet,
  turnoverBtw,
  parsePosSettlement,
  sumPosSettlements,
  reconcileDay,
  type DailyTurnover,
} from "./turnover";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A realistic, INTERNALLY CONSISTENT retail day: net bases + BTW = gross = pin+cash+other.
//   net 1520 + BTW 195 = 1715 = pin 1200 + cash 415 + other 100.
const day: DailyTurnover = {
  turnover_date: "2026-04-04",
  base_0: 20, base_9: 1000, base_21: 500,
  btw_9: 90, btw_21: 105,
  total_incl: 1715,
  pin_amount: 1200, cash_amount: 415, other_amount: 100,
};

console.log("\n— turnoverNetOmzet / turnoverBtw —");
check("sums the three per-rate bases", turnoverNetOmzet(day) === 1520);
check("keeps 9% and 21% separate (rubriek 1a/1b)", turnoverBtw(day).r9 === 90 && turnoverBtw(day).r21 === 105);
check("btw total is the sum, 0% adds nothing", turnoverBtw(day).total === 195);

console.log("\n— parsePosSettlement (real MT940 pos_income description) —");
const desc =
  "AFREK. BETAALAUTOMAAT MAES      REFNR. F9Q3BH                   DAT. 20260404/6094 AANT. 31     MREFNR. KFM";
check("extracts the embedded takings DATE, not the settlement date", parsePosSettlement(desc).date === "2026-04-04");
check("extracts the transaction count (AANT.)", parsePosSettlement(desc).count === 31);
check("absent markers → nulls (non-POS line)",
  parsePosSettlement("factuur 25643").date === null && parsePosSettlement(null).count === null);
check("INVALID calendar date → null (so caller falls back, never keys garbage)",
  parsePosSettlement("... DAT. 20261345/1 AANT. 3").date === null);
check("still reads the count even when the date is invalid",
  parsePosSettlement("... DAT. 20261345/1 AANT. 3").count === 3);

console.log("\n— sumPosSettlements (multi-scheme summation) —");
{
  const lines = [
    { description: "AFREK. BETAALAUTOMAAT MAES DAT. 20260404/1 AANT. 73", amount: 984.18 },
    { description: "AFREK. BETAALAUTOMAAT VPAY DAT. 20260404/1 AANT. 22", amount: 238.42 },
    { description: "AFREK. BETAALAUTOMAAT DBMC DAT. 20260403/1 AANT. 18", amount: 163.29 }, // other day
    { description: "factuur 25643", amount: -100 },                                          // not POS
  ];
  const s = sumPosSettlements(lines, "2026-04-04");
  check("sums only the lines keyed to that day, across schemes", Math.abs(s.total - (984.18 + 238.42)) < 0.005);
  check("aggregates the AANT count for the day", s.count === 95);
  check("reports how many lines matched", s.matchedLines === 2);
}

console.log("\n— reconcileDay —");
check("three witnesses agree + internal identity holds → no breaks",
  reconcileDay({ turnover: day, posSettledForDay: 1200, cashCountedForDay: 415 }).length === 0);
check("within percentage tolerance (rounding) → no breaks",
  reconcileDay({ turnover: day, posSettledForDay: 1200.01, cashCountedForDay: 414.99 }).length === 0);
check("integer-cents compare: exactly 2c over a flat 2c tol is NOT a false break",
  reconcileDay({
    turnover: { ...day, pin_amount: 1000.05, cash_amount: null, other_amount: null, total_incl: null, base_0: 0, base_9: 0, base_21: 0, btw_9: 0, btw_21: 0 },
    posSettledForDay: 1000.07, cashCountedForDay: 0, tolerance: 0.02, tolerancePct: 0,
  }).length === 0);
check("pin gap → one 'pin' break with signed diff",
  (() => {
    const b = reconcileDay({ turnover: day, posSettledForDay: 1150, cashCountedForDay: 415 });
    return b.length === 1 && b[0].kind === "pin" && b[0].expected === 1200 && b[0].diff === -50;
  })());
check("cash short (a missing bon?) → one 'cash' break",
  (() => {
    const b = reconcileDay({ turnover: day, posSettledForDay: 1200, cashCountedForDay: 340 });
    return b.length === 1 && b[0].kind === "cash" && Math.round(b[0].diff) === -75;
  })());
check("both card + cash disagree → two breaks",
  reconcileDay({ turnover: day, posSettledForDay: 1000, cashCountedForDay: 300 }).length === 2);

console.log("\n— reconcileDay honesty guards —");
check("null pin_amount + revenue present → 'unknown' break, never a silent pass",
  (() => {
    const b = reconcileDay({ turnover: { ...day, pin_amount: null, total_incl: null }, posSettledForDay: 0, cashCountedForDay: 415 });
    return b.some((x) => x.kind === "unknown");
  })());
check("internal identity: methods don't sum to printed total → 'internal' break",
  (() => {
    const bad: DailyTurnover = { ...day, other_amount: 0 }; // 1200+415+0 = 1615 ≠ 1715
    const b = reconcileDay({ turnover: bad, posSettledForDay: 1200, cashCountedForDay: 415 });
    return b.some((x) => x.kind === "internal");
  })());
check("empty day (no revenue, all null) → no phantom 'unknown' break",
  reconcileDay({
    turnover: { turnover_date: "2026-04-05", base_0: 0, base_9: 0, base_21: 0, btw_9: 0, btw_21: 0, total_incl: null, pin_amount: null, cash_amount: null, other_amount: null },
    posSettledForDay: 0, cashCountedForDay: 0,
  }).length === 0);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
