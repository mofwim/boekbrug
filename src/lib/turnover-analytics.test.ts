// [TURNOVER-ANALYTICS] Pure node test — run: npx tsx src/lib/turnover-analytics.test.ts
import { computeTurnoverAnalytics } from "./turnover-analytics";
import type { DailyTurnover } from "./turnover";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number, t = 0.01) => Math.abs(a - b) <= t;

const day = (date: string, over: Partial<DailyTurnover> = {}): DailyTurnover => ({
  turnover_date: date,
  base_0: 0, base_9: 900, base_21: 100, btw_9: 81, btw_21: 21,
  total_incl: 1102, pin_amount: 800, cash_amount: 300, other_amount: 2,
  ...over,
});

console.log("\n— empty is safe —");
{
  const a = computeTurnoverAnalytics([]);
  check("no days → zeros, no crash", a.days === 0 && a.totalOmzetIncl === 0 && a.busiestDay === null && a.anomalies.length === 0);
}

console.log("\n— totals, average, busiest/quietest —");
{
  const a = computeTurnoverAnalytics([
    day("2026-04-01", { total_incl: 1000 }),
    day("2026-04-02", { total_incl: 2000 }),
    day("2026-04-03", { total_incl: 1500 }),
  ]);
  check("days counted", a.days === 3);
  check("total incl summed", near(a.totalOmzetIncl, 4500));
  check("avg day", near(a.avgDayOmzet, 1500));
  check("busiest day", a.busiestDay?.date === "2026-04-02" && near(a.busiestDay.omzet, 2000));
  check("quietest day", a.quietestDay?.date === "2026-04-01" && near(a.quietestDay.omzet, 1000));
}

console.log("\n— VAT mix (share of NET per rate) —");
{
  const a = computeTurnoverAnalytics([day("2026-04-01")]); // net 900@9 + 100@21 = 1000
  const r21 = a.vatMix.find((v) => v.rate === 21)!;
  const r9 = a.vatMix.find((v) => v.rate === 9)!;
  check("9% share = 0.90", near(r9.share, 0.9));
  check("21% share = 0.10", near(r21.share, 0.1));
  check("shares sum to 1", near(a.vatMix.reduce((s, v) => s + v.share, 0), 1));
}

console.log("\n— payment mix —");
{
  const a = computeTurnoverAnalytics([day("2026-04-01", { pin_amount: 800, cash_amount: 200, other_amount: 0 })]);
  check("pin share 0.80", near(a.payment.pinShare, 0.8));
  check("cash share 0.20", near(a.payment.cashShare, 0.2));
}

console.log("\n— monthly trend groups by month —");
{
  const a = computeTurnoverAnalytics([
    day("2026-04-10", { total_incl: 1000 }),
    day("2026-04-20", { total_incl: 500 }),
    day("2026-05-01", { total_incl: 2000 }),
  ]);
  check("two months", a.monthly.length === 2);
  check("april summed", a.monthly[0].month === "2026-04" && near(a.monthly[0].omzet, 1500));
  check("may summed", a.monthly[1].month === "2026-05" && near(a.monthly[1].omzet, 2000));
}

console.log("\n— average PIN ticket (only with a count) —");
{
  const days = [day("2026-04-01", { pin_amount: 800 }), day("2026-04-02", { pin_amount: 1200 })]; // total pin 2000
  check("no count → null (honest)", computeTurnoverAnalytics(days).avgPinTicket === null);
  check("100 tickets → gem. 20,00", near(computeTurnoverAnalytics(days, 100).avgPinTicket ?? 0, 20));
}

console.log("\n— anomalies: a spike beyond 2σ, only with enough days —");
{
  const flat = Array.from({ length: 9 }, (_, i) => day(`2026-04-0${i + 1}`, { total_incl: 1000 }));
  const withSpike = [...flat, day("2026-04-10", { total_incl: 9000 })];
  const a = computeTurnoverAnalytics(withSpike);
  check("the spike day is flagged 'hoog'", a.anomalies.some((x) => x.date === "2026-04-10" && x.direction === "hoog"));
  check("the flat days are not flagged", !a.anomalies.some((x) => x.date === "2026-04-05"));
  check("under 5 days → no anomaly detection (noise)", computeTurnoverAnalytics([day("2026-04-01"), day("2026-04-02", { total_incl: 99999 })]).anomalies.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
