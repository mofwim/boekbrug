// [TURNOVER-CLOSING] Pure node test — run: npx tsx src/lib/turnover-closing.test.ts
import { buildTurnoverClosing, type CashOmzetForClosing } from "./turnover-closing";
import type { DailyTurnover } from "./turnover";
import type { PosSettlementLine } from "./turnover";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number, t = 0.02) => Math.abs(a - b) <= t;

const day = (date: string, over: Partial<DailyTurnover> = {}): DailyTurnover => ({
  turnover_date: date,
  base_0: 0, base_9: 1000, base_21: 500, btw_9: 90, btw_21: 105,
  total_incl: 1695, pin_amount: 1200, cash_amount: 495, other_amount: 0,
  ...over,
});

console.log("\n— summary (per rate + totals) —");
{
  const t = [day("2026-04-01"), day("2026-04-02")];
  const { summary } = buildTurnoverClosing(t, [], []);
  check("counts days", summary.days === 2);
  check("21% net + btw summed", near(summary.perRate[0].net, 1000) && near(summary.perRate[0].btw, 210));
  check("9% net + btw summed", near(summary.perRate[1].net, 2000) && near(summary.perRate[1].btw, 180));
  check("0% net, no btw", near(summary.perRate[2].net, 0) && summary.perRate[2].btw === 0);
  check("totals", near(summary.totalNet, 3000) && near(summary.totalBtw, 390) && near(summary.totalIncl, 3390));
  check("payment totals", near(summary.totalPin, 2400) && near(summary.totalCash, 990));
}

console.log("\n— reconciliation ties out → no exceptions —");
{
  const t = [day("2026-04-01")];
  // Two card schemes settling this day (DAT. 20260401), summing to the till's pin 1200.
  const pos: PosSettlementLine[] = [
    { description: "AFREK. BETAALAUTOMAAT MAES DAT. 20260401/1 AANT. 50", amount: 900 },
    { description: "AFREK. BETAALAUTOMAAT VPAY DAT. 20260401/1 AANT. 20", amount: 300 },
  ];
  const cash: CashOmzetForClosing[] = [{ date: "2026-04-01", amount: 495 }];
  const { reconciliation, exceptions } = buildTurnoverClosing(t, pos, cash);
  check("pin settled summed across schemes", near(reconciliation[0].pinSettled, 1200));
  check("cash counted from the cash book", near(reconciliation[0].cashCounted, 495));
  check("a fully-tied day yields no exceptions", exceptions.length === 0);
}

console.log("\n— reconciliation gaps surface as exceptions —");
{
  const t = [day("2026-04-01")];
  const pos: PosSettlementLine[] = [
    { description: "AFREK. BETAALAUTOMAAT MAES DAT. 20260401/1 AANT. 50", amount: 1000 }, // 200 short of pin 1200
  ];
  const cash: CashOmzetForClosing[] = [{ date: "2026-04-01", amount: 300 }]; // 195 short of cash 495
  const { reconciliation, exceptions } = buildTurnoverClosing(t, pos, cash);
  check("pin diff signed", near(reconciliation[0].pinDiff, -200));
  check("cash diff signed", near(reconciliation[0].cashDiff, -195));
  check("both gaps become exceptions with dates", exceptions.length === 2 && exceptions.every((e) => e.date === "2026-04-01"));
}

console.log("\n— audit trail lists imported days —");
{
  const t = [day("2026-04-02"), day("2026-04-01")];
  const { audit, reconciliation } = buildTurnoverClosing(t, [], []);
  check("audit has a row per day", audit.length === 2);
  check("reconciliation sorted by date", reconciliation[0].date === "2026-04-01" && reconciliation[1].date === "2026-04-02");
}

console.log("\n— empty input is safe —");
{
  const { summary, exceptions, audit } = buildTurnoverClosing([], [], []);
  check("no days → zero totals, no exceptions", summary.days === 0 && summary.totalIncl === 0 && exceptions.length === 0 && audit.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
