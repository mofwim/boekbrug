// [TRIANGLE] Pure node test — run: npx tsx src/lib/triangle.test.ts
import { reconcileTriangle, eftGrossByDay, bankNetByDay, buildCardReconciliationCsv } from "./triangle";
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

console.log("\n— bankNetByDay groups pos_income by takings day (DAT.), signed —");
{
  const m = bankNetByDay([
    { description: "AFREK. BETAALAUTOMAAT MAES DAT. 20260712/6094 AANT. 80", amount: 900, date: "2026-07-13" },
    { description: "AFREK. BETAALAUTOMAAT VPAY DAT. 20260712/6095 AANT. 20", amount: 620, date: "2026-07-13" },
    { description: "AFREK. BETAALAUTOMAAT REFUND DAT. 20260712/6096 AANT. 1", amount: -8, date: "2026-07-13" },
  ]);
  check("07-12 net = 900+620−8 = 1512 (keyed by DAT., not booking date)", near(m.get("2026-07-12")!, 1512));
  check("nothing keyed to the booking date 07-13", !m.has("2026-07-13"));
  check("no DAT. falls back to booking date",
    bankNetByDay([{ description: "kale overboeking", amount: 100, date: "2026-07-14" }]).get("2026-07-14") === 100);
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

console.log("\n— a bank payout that can't be tied to any takings day (outside the pull-back window) is surfaced, not dropped —");
{
  // A T+1..T+5 payout on a pure settlement day is re-attributed to its takings day (tested under
  // [SETTLE-LAG]). But a payout with NO card day within the pull-back window can't be tied — it must
  // still be surfaced (never silently dropped), carrying its net so the money isn't lost.
  const res = reconcileTriangle({
    turnover: [till("2026-07-12", 1546.46)],
    eftSettlements: [eft("2026-07-12", 1546.46)],
    bankNetByDay: new Map([["2026-07-20", 980]]), // 8 days after → no card day within the 5-day pull-back
  });
  check("the un-attributable bank day appears", res.days.some((d) => d.date === "2026-07-20"));
  check("it is incomplete (no gross to verify against)",
    res.days.find((d) => d.date === "2026-07-20")?.status === "incomplete");
  check("it still carries its bankNet (money not lost)",
    near(res.days.find((d) => d.date === "2026-07-20")?.bankNet ?? -1, 980));
}

console.log("\n— buildCardReconciliationCsv (the accountant's view) —");
{
  const tri = reconcileTriangle({
    turnover: [till("2026-07-03", 1000), till("2026-07-04", 800)],
    eftSettlements: [eft("2026-07-03", 1000), eft("2026-07-04", 750)], // 04 is a mismatch
    bankNetByDay: new Map([["2026-07-03", 985], ["2026-07-04", 745]]),
  });
  const csv = buildCardReconciliationCsv("Q3 2026", tri);
  check("header names the three corners", /Kassa-PIN.*terminal.*bank/i.test(csv));
  check("day row shows NL amounts + commission", csv.includes("2026-07-03;1000,00;1000,00;;985,00;15,00;sluit aan"));
  check("mismatch day flagged in status", /2026-07-04;800,00;750,00;.*verschil kassa\/terminal/.test(csv));
  check("total commission line present (only the ok day = 15,00)", csv.includes("Totaal kaartcommissie (bruto − netto, BTW-vrij);;;;;15,00"));
  check("gross-mismatch day count surfaced", /Dagen kassa .* terminal.*;1$/m.test(csv));
  check("result rows echo the inputs", tri.days[0].tillPin === 1000 && tri.days[0].eftGross === 1000 && tri.days[0].bankNet === 985);
}

console.log("\n— [RE-REVIEW MED-2] an orphan PIN-ledger day (no till/EFT/bank) is surfaced, not dropped —");
{
  // The bookkeeper recorded €500 PIN on 10/08 but the till Z-report for that day is MISSING.
  // The ledger is the only witness of that day's (possibly un-booked) revenue → it must appear.
  const tri = reconcileTriangle({
    turnover: [],
    eftSettlements: [],
    pinLedgerByDay: new Map([["2026-08-10", 500]]),
  });
  const day = tri.days.find((d) => d.date === "2026-08-10");
  check("orphan ledger day appears in the reconciliation", !!day);
  check("its ledgerPin witness is echoed", day?.ledgerPin === 500);
  check("it is surfaced as incomplete (no till to tie to), not silently dropped", day?.status === "incomplete");
  const csv = buildCardReconciliationCsv("Q3 2026", tri);
  check("the ledger-only day is reviewable in the accountant CSV", csv.includes("2026-08-10") && /Grootboek PIN/.test(csv));
}

console.log("\n— [SETTLE-LAG] a DAT-less payout T+5 on a pure settlement day re-attributes back so the fee is booked —");
{
  // Takings day 05-08 (till + EFT). The card batch pays out NET, DAT-less, booked 05-13 (T+5 over a
  // long weekend + holiday) → keyed to its booking day 05-13, which has no till/EFT of its own.
  // At the OLD 3-day window this stayed orphaned on 05-13 → commission silently dropped, resultaat
  // overstated. At the shared 5-day window it re-attributes to 05-08 and books the fee there.
  const res = reconcileTriangle({
    turnover: [till("2026-05-08", 1000)],
    eftSettlements: [eft("2026-05-08", 1000)],
    bankNetByDay: new Map([["2026-05-13", 980]]), // DAT-less net payout, booked T+5
  });
  check("commission (1000−980=20) is booked at the takings day (would be 0 at LAG_DAYS=3)",
    near(res.totalCommission, 20));
  check("no orphan incomplete payout day at 05-13", !res.days.some((d) => d.date === "2026-05-13"));
  check("the takings day 05-08 carries the re-attributed net", res.days.some((d) => d.date === "2026-05-08" && near(d.bankNet ?? -1, 980)));
}

console.log("\n— [SETTLE-LAG] a T+2 pull-back still works (no regression from widening 3→5) —");
{
  const res = reconcileTriangle({
    turnover: [till("2026-05-08", 1000)],
    eftSettlements: [eft("2026-05-08", 1000)],
    bankNetByDay: new Map([["2026-05-10", 985]]), // DAT-less, booked T+2
  });
  check("T+2 payout still re-attributes and books commission 15", near(res.totalCommission, 15));
  check("no orphan day at 05-10", !res.days.some((d) => d.date === "2026-05-10"));
}

console.log("\n— [SETTLE-LAG] a takings day that ALREADY has its own payout is not hijacked by a back=5 scan —");
{
  // Two adjacent card days each with their own DAT-keyed payout; a third stray DAT-less payout must
  // not steal a day that already carries a payout (guard: !bankByDay.has(cand)).
  const res = reconcileTriangle({
    turnover: [till("2026-05-08", 1000), till("2026-05-09", 500)],
    eftSettlements: [eft("2026-05-08", 1000), eft("2026-05-09", 500)],
    bankNetByDay: new Map([["2026-05-08", 990], ["2026-05-09", 495]]), // each day already has its payout
  });
  check("both days keep their own payout (none hijacked)",
    near(res.days.find((d) => d.date === "2026-05-08")?.bankNet ?? -1, 990) &&
    near(res.days.find((d) => d.date === "2026-05-09")?.bankNet ?? -1, 495));
  check("commission = (1000−990)+(500−495) = 15", near(res.totalCommission, 15));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
