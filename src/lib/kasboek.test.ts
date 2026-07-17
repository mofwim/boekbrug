// [KASBOEK] Pure node test — run: npx tsx src/lib/kasboek.test.ts
// Validated against the store's REAL "Kiwi 1ste kw 2026" cash book numbers.
import { buildKasboek, openingBalanceForQuarter, type KasTurnoverDay, type KasEntry } from "./kasboek";

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
