// [KLUIS] Pure node test — run: npx tsx src/lib/compliance-vault.test.ts
// Locks the 7-year bewaarplicht math and the completeness counting (real counts,
// honest neutral gap notes, cash-only shops not falsely alarmed).
import {
  keepThroughYear, isWithinRetention, retentionWindow, summarizeYear, summarizeVault,
  RETENTION_YEARS, type VaultInvoice, type VaultDocument,
} from "./compliance-vault";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— retention math (7-year bewaarplicht) —");
check("RETENTION_YEARS is 7", RETENTION_YEARS === 7);
check("2023 records kept through 2030", keepThroughYear(2023) === 2030);
check("2023 still mandatory in 2030", isWithinRetention(2023, 2030));
check("2023 discardable in 2031", !isWithinRetention(2023, 2031));
check("current year is always within retention", isWithinRetention(2026, 2026));
{
  const w = retentionWindow(2026);
  check("window is 8 years, newest first (2026..2019)", w[0] === 2026 && w[w.length - 1] === 2019 && w.length === 8);
}

const O = (date: string, total: number): VaultInvoice => ({ invoice_date: date, direction: "outgoing", invoice_type: "factuur", status: "paid", total_inc_btw: total });
const I = (date: string, total: number): VaultInvoice => ({ invoice_date: date, direction: "incoming", invoice_type: "factuur", status: "paid", total_inc_btw: total });
const bank = (year: number, q: number): VaultDocument => ({ doc_type: "bankafschrift", year, period: `${year}-Q${q}`, trashed: false });

console.log("\n— summarizeYear: real counts —");
{
  const inv = [O("2026-01-10", 121), O("2026-02-20", 242), I("2026-04-05", 100), O("2026-07-01", 50)];
  const docs = [bank(2026, 1), bank(2026, 2)];
  const s = summarizeYear(2026, 2026, inv, docs);
  check("outgoing counted (3)", s.outgoingCount === 3);
  check("incoming counted (1)", s.incomingCount === 1);
  check("outgoing total summed (413)", Math.abs(s.outgoingTotal - 413) < 0.005);
  check("bank statements counted (2)", s.bankStatements === 2);
  check("Q1 has 2 outgoing", s.quarters[0].outgoingCount === 2);
  check("Q2 has the incoming", s.quarters[1].incomingCount === 1);
  check("Q3 has 1 outgoing", s.quarters[2].outgoingCount === 1);
  check("keepThrough 2033, within retention", s.keepThroughYear === 2033 && s.withinRetention);
}

console.log("\n— gaps: missing bank statement is a NEUTRAL note, not on quiet quarters —");
{
  // Activity in Q3 (outgoing) but NO Q3 bank statement → flagged. Q1/Q2/Q4 no activity → not flagged.
  const inv = [O("2026-07-15", 60)];
  const s = summarizeYear(2026, 2026, inv, []);
  check("Q3 flagged missing bank statement", s.quarters[2].missingBankStatement === true);
  check("Q1 (no activity) NOT flagged", s.quarters[0].missingBankStatement === false);
  check("gap note names Q3", s.gaps.some((g) => /Q3/.test(g)));
}
{
  // A quarter WITH a matching bank statement → no gap.
  const s = summarizeYear(2026, 2026, [O("2026-02-01", 10)], [bank(2026, 1)]);
  check("Q1 with statement → no missing flag", s.quarters[0].missingBankStatement === false);
  check("no gaps at all", s.gaps.length === 0);
}

console.log("\n— summarizeVault: only years with real data, newest first —");
{
  const inv = [O("2024-03-01", 10), O("2026-05-01", 20)];
  const docs = [bank(2022, 1)]; // a stray doc-only year
  const v = summarizeVault(2026, inv, docs);
  const years = v.map((y) => y.year);
  check("includes 2026, 2024 (invoices) and 2022 (doc-only)", years.includes(2026) && years.includes(2024) && years.includes(2022));
  check("excludes empty years (2025, 2023)", !years.includes(2025) && !years.includes(2023));
  check("newest first", years[0] === 2026);
}

console.log("\n— quarter bucketing is timezone-proof (parsed from the month digits) —");
{
  // First-of-quarter dates must land in the RIGHT quarter regardless of server TZ.
  const s = summarizeYear(2026, 2026, [O("2026-01-01", 1), O("2026-04-01", 2), O("2026-07-01", 3), O("2026-10-01", 4)], []);
  check("2026-01-01 → Q1", s.quarters[0].outgoingCount === 1);
  check("2026-04-01 → Q2", s.quarters[1].outgoingCount === 1);
  check("2026-07-01 → Q3", s.quarters[2].outgoingCount === 1);
  check("2026-10-01 → Q4", s.quarters[3].outgoingCount === 1);
  check("quarter counts sum to the year total (no leak to wrong quarter)",
    s.quarters.reduce((n, q) => n + q.outgoingCount, 0) === s.outgoingCount);
}
{
  // A malformed date is counted in the year but not mis-bucketed into a quarter, and
  // must not crash.
  const s = summarizeYear(2026, 2026, [{ invoice_date: "2026-13-45", direction: "outgoing", invoice_type: "factuur", status: "sent", total_inc_btw: 5 }], []);
  check("garbage month → no quarter, no crash", s.quarters.every((q) => q.outgoingCount === 0));
}

console.log("\n— null-period bank statement suppresses the false 'missing' alarm —");
{
  // A bankafschrift with period=null (realistic on upload) covers the year; we can't
  // place it in a quarter, so we must NOT warn a quarter is missing.
  const inv = [O("2026-05-10", 100)]; // Q2 activity
  const docs: VaultDocument[] = [{ doc_type: "bankafschrift", year: 2026, period: null, trashed: false }];
  const s = summarizeYear(2026, 2026, inv, docs);
  check("year counts the null-period statement", s.bankStatements === 1);
  check("Q2 NOT falsely flagged missing (we have a statement, just unplaced)", s.quarters[1].missingBankStatement === false);
  check("no false gap note", s.gaps.length === 0);
}
{
  // But with ZERO statements at all, the missing flag still fires (honest).
  const s = summarizeYear(2026, 2026, [O("2026-05-10", 100)], []);
  check("truly no statement → Q2 flagged missing", s.quarters[1].missingBankStatement === true);
}
{
  // A month-form period ('2026-06') is attributed to its quarter (Q2).
  const s = summarizeYear(2026, 2026, [O("2026-06-01", 10)], [{ doc_type: "bankafschrift", year: 2026, period: "2026-06", trashed: false }]);
  check("month-form period '2026-06' → Q2 statement, not missing", s.quarters[1].bankStatements === 1 && s.quarters[1].missingBankStatement === false);
}

console.log("\n— offertes/pro_forma are NOT retained records —");
{
  const inv: VaultInvoice[] = [{ invoice_date: "2026-01-01", direction: "outgoing", invoice_type: "offerte", status: "sent", total_inc_btw: 999 }];
  const s = summarizeYear(2026, 2026, inv, []);
  check("an offerte is not counted as an invoice", s.outgoingCount === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
