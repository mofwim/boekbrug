// [TURNOVER] Pure node test — run: npx tsx src/lib/turnover.test.ts
import {
  turnoverNetOmzet,
  turnoverBtw,
  parsePosSettlement,
  reconcileDay,
  type DailyTurnover,
} from "./turnover";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A realistic retail day: net bases per rate + BTW, mixed payment methods.
const day: DailyTurnover = {
  turnover_date: "2026-04-04",
  base_0: 20, base_9: 1000, base_21: 500,
  btw_9: 90, btw_21: 105,
  pin_amount: 1200, cash_amount: 415, other_amount: 0,
};

console.log("\n— turnoverNetOmzet —");
check("sums the three per-rate bases", turnoverNetOmzet(day) === 1520);
check("null-ish bases treated as 0",
  turnoverNetOmzet({ ...day, base_0: 0, base_9: 0, base_21: 0 }) === 0);

console.log("\n— turnoverBtw —");
check("keeps 9% and 21% separate (for rubriek 1a/1b)",
  turnoverBtw(day).r9 === 90 && turnoverBtw(day).r21 === 105);
check("total is the sum, 0% adds nothing", turnoverBtw(day).total === 195);

console.log("\n— parsePosSettlement (real MT940 pos_income description) —");
const desc =
  "AFREK. BETAALAUTOMAAT MAES      REFNR. F9Q3BH                   DAT. 20260404/6094 AANT. 31     MREFNR. KFM";
check("extracts the embedded takings DATE, not the settlement date",
  parsePosSettlement(desc).date === "2026-04-04");
check("extracts the transaction count (AANT.)", parsePosSettlement(desc).count === 31);
check("absent markers → nulls (non-POS line)",
  parsePosSettlement("factuur 25643").date === null && parsePosSettlement(null).count === null);

console.log("\n— reconcileDay —");
check("three witnesses agree → no breaks",
  reconcileDay({ turnover: day, posSettledForDay: 1200, cashCountedForDay: 415 }).length === 0);
check("within tolerance (rounding) → no breaks",
  reconcileDay({ turnover: day, posSettledForDay: 1200.01, cashCountedForDay: 414.99 }).length === 0);
check("pin gap → one 'pin' break with signed diff",
  (() => {
    const b = reconcileDay({ turnover: day, posSettledForDay: 1150, cashCountedForDay: 415 });
    return b.length === 1 && b[0].kind === "pin" && b[0].expected === 1200 && b[0].actual === 1150 && b[0].diff === -50;
  })());
check("cash short (a missing bon?) → one 'cash' break",
  (() => {
    const b = reconcileDay({ turnover: day, posSettledForDay: 1200, cashCountedForDay: 340 });
    return b.length === 1 && b[0].kind === "cash" && Math.round(b[0].diff) === -75;
  })());
check("both witnesses disagree → two breaks",
  reconcileDay({ turnover: day, posSettledForDay: 1000, cashCountedForDay: 300 }).length === 2);
check("null expected method treated as 0 → surfaces, never silent",
  (() => {
    const b = reconcileDay({ turnover: { ...day, pin_amount: null }, posSettledForDay: 1200, cashCountedForDay: 415 });
    return b.length === 1 && b[0].kind === "pin" && b[0].expected === 0 && b[0].diff === 1200;
  })());

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
