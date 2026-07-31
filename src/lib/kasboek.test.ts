// [KASBOEK] Pure node test — run: npx tsx src/lib/kasboek.test.ts
// Validated against the store's REAL "Kiwi 1ste kw 2026" cash book numbers.
import { buildKasboek, openingBalanceForQuarter, lowestDrawerPoint, type KasTurnoverDay, type KasEntry } from "./kasboek";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

// Real Kiwi jan cash takings (from contant.xlsx / the Kasboek Ontvangsten column).
const turnover: KasTurnoverDay[] = [
  { turnover_date: "2026-01-01", cash_amount: 120.25 },
  { turnover_date: "2026-01-02", cash_amount: 242.65 },
  { turnover_date: "2026-01-03", cash_amount: 78.25 },
  { turnover_date: "2026-01-20", cash_amount: 92.45 },
];
// Real Kiwi jan cash expense (row 22: deel salaris 1306.36 on 20/01).
const entries: KasEntry[] = [
  { entry_date: "2026-01-20", direction: "out", amount: 1306.36, category: "kosten", description: "deel salaris Mohammad Ibrahim" },
];

console.log("\n— running balance matches the real Kiwi Kasboek —");
{
  const kb = buildKasboek({ turnover, entries, year: 2026, quarter: 1, openingBalance: 0 });
  const jan = kb.months.find((m) => m.key === "2026-01")!;
  const d1 = jan.rows.find((r) => r.date === "2026-01-01")!;
  const d2 = jan.rows.find((r) => r.date === "2026-01-02")!;
  const d3 = jan.rows.find((r) => r.date === "2026-01-03")!;
  const d20 = jan.rows.find((r) => r.date === "2026-01-20")!;
  check("01-01: begin 0 → in 120.25 → eind 120.25", near(d1.beginsaldo, 0) && near(d1.ontvangsten, 120.25) && near(d1.eindsaldo, 120.25));
  check("02-01: begin 120.25 → eind 362.90", near(d2.beginsaldo, 120.25) && near(d2.eindsaldo, 362.90));
  check("03-01: eind 441.15", near(d3.eindsaldo, 441.15));
  // 20/01: begin (=03-01 eind, since 04–19 have no activity here) + 92.45 in − 1306.36 out.
  check("20-01: expense lowers the drawer (in 92.45, out 1306.36)", near(d20.ontvangsten, 92.45) && near(d20.uitgaven, 1306.36));
  check("20-01: eindsaldo = begin + 92.45 − 1306.36", near(d20.eindsaldo, d20.beginsaldo + 92.45 - 1306.36));
  check("20-01: description carried", d20.descriptions.some((s) => /salaris/.test(s)));
  check("month totals: in = Σ takings", near(jan.totalIn, 120.25 + 242.65 + 78.25 + 92.45));
  check("month totals: out = the one expense", near(jan.totalOut, 1306.36));
}

console.log("\n— opening balance carries across quarters (Q2 opens where Q1 closed) —");
{
  const q2open = openingBalanceForQuarter({ turnover, entries, year: 2026, quarter: 2 });
  // All jan activity is before Q2 start → opening = Σ in − Σ out.
  check("Q2 opening = Q1 net cash", near(q2open, (120.25 + 242.65 + 78.25 + 92.45) - 1306.36));
  const startBal = openingBalanceForQuarter({ turnover: [], entries: [], year: 2026, quarter: 2, startingBalance: 500 });
  check("configured starting balance respected", near(startBal, 500));
}

console.log("\n— pure / safe: no P&L notion, only balance —");
{
  const empty = buildKasboek({ turnover: [], entries: [], year: 2026, quarter: 1, openingBalance: 300 });
  check("no activity → closing = opening", near(empty.closingBalance, 300) && empty.months.length === 0);
  // A cash deposit to the bank (storting) is direction 'out' → drawer down, still balance-only.
  const withStorting = buildKasboek({
    turnover: [{ turnover_date: "2026-03-05", cash_amount: 100 }],
    entries: [{ entry_date: "2026-03-05", direction: "out", amount: 100, category: "transfer", description: "storting bank" }],
    year: 2026, quarter: 1, openingBalance: 0,
  });
  check("takings in + storting out net to 0 on the day", near(withStorting.closingBalance, 0));
  // out-of-quarter rows are excluded.
  const oob = buildKasboek({ turnover: [{ turnover_date: "2026-04-01", cash_amount: 999 }], entries: [], year: 2026, quarter: 1, openingBalance: 0 });
  check("out-of-quarter day excluded", oob.months.length === 0 && near(oob.closingBalance, 0));
}

console.log("\n— [KAS-NEGATIEF] lowestDrawerPoint (the readiness-gate witness) —");
{
  // Mid-quarter dip below zero that RECOVERS to a positive close → still the violation (day-2).
  const dip = buildKasboek({
    turnover: [{ turnover_date: "2026-01-01", cash_amount: 50 }, { turnover_date: "2026-01-03", cash_amount: 500 }],
    entries: [{ entry_date: "2026-01-02", direction: "out", amount: 200, category: "kosten", description: null }],
    year: 2026, quarter: 1, openingBalance: 0,
  });
  const lp = lowestDrawerPoint(dip);
  check("mid-quarter dip caught even though close is positive", lp !== null && lp.date === "2026-01-02" && near(lp.balance, -150));
  check("...and the close itself is positive (scans eindsaldo, not closingBalance)", dip.closingBalance > 0);

  // Negative carry-in opening, zero movements → caught at the quarter start.
  const carryIn = buildKasboek({ turnover: [], entries: [], year: 2026, quarter: 1, openingBalance: -80 });
  const lc = lowestDrawerPoint(carryIn);
  check("negative carry-in with no activity is caught at quarter start", lc !== null && lc.date === "2026-01-01" && near(lc.balance, -80));

  // Never negative → null (no false fraud flag).
  const ok = buildKasboek({
    turnover: [{ turnover_date: "2026-01-01", cash_amount: 300 }],
    entries: [{ entry_date: "2026-01-02", direction: "out", amount: 100, category: "kosten", description: null }],
    year: 2026, quarter: 1, openingBalance: 0,
  });
  check("never-negative drawer → null", lowestDrawerPoint(ok) === null);

  // A legitimate till FLOAT (opening €500) covering a €400 cash-out → still positive → null.
  const float = buildKasboek({
    turnover: [], entries: [{ entry_date: "2026-01-05", direction: "out", amount: 400, category: "kosten", description: null }],
    year: 2026, quarter: 1, openingBalance: 500,
  });
  check("float honored: €500 opening − €400 out stays positive → null (no false flag)", lowestDrawerPoint(float) === null);
}

// ── [PAGE-KEY] Why the readers must page on `id` and never on `entry_date` ────────────────────
// entry_date is not unique — several cash entries on one day is the ordinary case for a shop —
// so across separate .range() windows Postgres may serve a tie twice or not at all. The builders
// below are order-independent, which is exactly what makes that corruption invisible: the wrong
// SET of rows still produces a perfectly well-formed cash book. These lock what such a set costs,
// so the reason the reads key on `id` stays written down and testable.
console.log("\n— [PAGE-KEY] a duplicated / dropped row is a wrong RUNNING balance, not one wrong day —");
{
  const day = (entry_date: string, direction: "in" | "out", amount: number) =>
    ({ entry_date, direction, amount, category: "kosten", description: null }) as const;
  // Three entries on ONE day, then movement on later days — the shape an unstable paging key
  // scrambles. Truth: 1000 opening, −100 −200 −300 on the 5th, +50 on the 10th.
  const truthful = buildKasboek({
    turnover: [],
    entries: [day("2026-01-05", "out", 100), day("2026-01-05", "out", 200), day("2026-01-05", "out", 300), day("2026-01-10", "in", 50)],
    year: 2026, quarter: 1, openingBalance: 1000,
  });
  check("baseline: closing = 1000 − 600 + 50", truthful.closingBalance === 450);

  // The same read, one tie served TWICE across the page boundary.
  const duplicated = buildKasboek({
    turnover: [],
    entries: [day("2026-01-05", "out", 100), day("2026-01-05", "out", 200), day("2026-01-05", "out", 200), day("2026-01-05", "out", 300), day("2026-01-10", "in", 50)],
    year: 2026, quarter: 1, openingBalance: 1000,
  });
  check("a duplicated tie shifts the closing balance by its amount", duplicated.closingBalance === 250);
  // …and every day AFTER it, not just its own — the property that makes this expensive.
  const lastTruth = truthful.months[0].rows[truthful.months[0].rows.length - 1];
  const lastDup = duplicated.months[0].rows[duplicated.months[0].rows.length - 1];
  check("the drift reaches the LAST day of the quarter", lastTruth.date === lastDup.date && lastTruth.eindsaldo - lastDup.eindsaldo === 200);
  check("the book still looks perfectly well-formed (same days, same shape)",
    truthful.months[0].rows.length === duplicated.months[0].rows.length);

  // A dropped tie can invent a negative day that never happened — the witness that blocks filing.
  const dropped = buildKasboek({
    turnover: [], entries: [day("2026-01-05", "out", 100), day("2026-01-10", "in", 500)],
    year: 2026, quarter: 1, openingBalance: 50,
  });
  const complete = buildKasboek({
    turnover: [], entries: [day("2026-01-05", "in", 400), day("2026-01-05", "out", 100), day("2026-01-10", "in", 500)],
    year: 2026, quarter: 1, openingBalance: 50,
  });
  check("dropping a same-day RECEIPT fabricates a negative day", lowestDrawerPoint(dropped) !== null);
  check("…which the complete read does not have", lowestDrawerPoint(complete) === null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
