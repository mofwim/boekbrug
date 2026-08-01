// [TURNOVER] Pure node test — run: npx tsx src/lib/turnover.test.ts
import {
  turnoverNetOmzet,
  turnoverBtw,
  parsePosSettlement,
  sumPosSettlements,
  reconcileDay,
  checkTurnoverArithmetic,
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

console.log("\n— AUDIT FIXES: signed refunds + real calendar validation —");
check("a refund pos line is SUBTRACTED, not added (net = 950)",
  Math.abs(sumPosSettlements([
    { description: "AFREK. BETAALAUTOMAAT MAES DAT. 20260404/1 AANT. 5", amount: 1000 },
    { description: "AFREK. BETAALAUTOMAAT MAES DAT. 20260404/1 AANT. 1", amount: -50 },
  ], "2026-04-04").total - 950) < 0.005);
check("impossible calendar date (Feb 31) is rejected → null",
  parsePosSettlement("x DAT. 20260231/1 AANT. 3").date === null);
check("a genuine end-of-Feb date still parses", parsePosSettlement("x DAT. 20260228/1 AANT. 3").date === "2026-02-28");
check("Apr 31 (30-day month) rejected", parsePosSettlement("x DAT. 20260431/1 AANT. 3").date === null);


// ── [TURNOVER-ARITHMETIC] can this day be true at all? ────────────────────────
// daily_turnover is BTW-authoritative — /api/aangifte reads btw_9 and btw_21 out of it and puts
// them in rubriek 1a/1b as tax OWED — and /api/turnover/import wrote them from the request body
// with nothing but a numeric coercion. It checked the date three ways and never looked at the money.
console.log("\n— a day's figures have to be possible —");
{
  const d = (over: Partial<DailyTurnover> = {}): DailyTurnover => ({
    turnover_date: "2026-03-12",
    base_0: 0, base_9: 1000, base_21: 500, btw_9: 90, btw_21: 105,
    total_incl: 1695, pin_amount: null, cash_amount: null, other_amount: null, ...over,
  });

  check("a correct day passes silently", checkTurnoverArithmetic(d()).length === 0);

  // The whole reason this exists: a rate that cannot be. 52% on a 9% base.
  const impossible = checkTurnoverArithmetic(d({ base_9: 100, btw_9: 52, base_21: 0, btw_21: 0, total_incl: 152 }));
  check("an impossible rate is caught", impossible.some((b) => b.kind === "rate_9"));

  // Swapped rates — the misread a mixed-rate Z-report actually produces.
  check("9% charged at 21% is caught",
    checkTurnoverArithmetic(d({ btw_9: 210 })).some((b) => b.kind === "rate_9"));

  // BTW with no turnover behind it.
  const noBase = checkTurnoverArithmetic(d({ base_9: 0, btw_9: 90, base_21: 0, btw_21: 0, total_incl: 90 }));
  check("btw without a base is caught", noBase.some((b) => b.kind === "rate_9"));
  check("and says so in words the owner reads", /geen omzet/.test(noBase.find((b) => b.kind === "rate_9")!.note));

  // A till rounds per line, hundreds of times a day. That drift must never be flagged — a gate
  // that rejects honest work gets switched off.
  check("per-line rounding drift is not a break", checkTurnoverArithmetic(d({ btw_9: 90.31, total_incl: 1695.31 })).length === 0);
  check("a whole euro off on a 90-euro btw IS a break",
    checkTurnoverArithmetic(d({ btw_9: 96 })).some((b) => b.kind === "rate_9"));

  // A correction day: more refunds than sales. Negative throughout, and entirely legitimate.
  check("a negative correction day is not a break",
    checkTurnoverArithmetic(d({ base_9: -200, btw_9: -18, base_21: 0, btw_21: 0, total_incl: -218 })).length === 0);
  // But a negative base carrying a POSITIVE btw is not something a till produces.
  check("a negative base with positive btw is caught",
    checkTurnoverArithmetic(d({ base_9: -200, btw_9: 18, base_21: 0, btw_21: 0, total_incl: -182 })).some((b) => b.kind === "rate_9"));

  // The identity, on the write path. reconcileDay checks it too, but that runs on the SCREEN and
  // needs bank and cash figures as inputs — it cannot be a gate on the write.
  check("omzet + btw ≠ totaal is caught", checkTurnoverArithmetic(d({ total_incl: 2000 })).some((b) => b.kind === "total"));
  check("a missing printed total is not a break", checkTurnoverArithmetic(d({ total_incl: null })).length === 0);

  // 0% turnover carries no btw and must not be compared against a rate.
  check("a 0%-only day passes", checkTurnoverArithmetic(d({ base_0: 500, base_9: 0, base_21: 0, btw_9: 0, btw_21: 0, total_incl: 500 })).length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
