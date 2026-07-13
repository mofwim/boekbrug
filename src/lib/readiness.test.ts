// [READINESS] Pure node test — run: npx tsx src/lib/readiness.test.ts
// The score is a PROMISE to the owner and the boekhouder: every point is earned by a
// provable condition. These tests pin the strict rubric (30/30/20/20, n.v.t. excluded)
// so it can never drift into a cosmetic number.
import { buildReadiness, type ReadinessSignals } from "./readiness";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A fully-clean retail quarter (the "green" baseline).
const perfect = (over: Partial<ReadinessSignals> = {}): ReadinessSignals => ({
  quarterLabel: "Q1 2026",
  verifiedInvoiceCount: 40, invoicesWithEvidence: 40, missingEvidence: [],
  bankTxCount: 120, undocumentedCount: 0,
  usesTurnover: true, turnoverDays: 90, reconExceptions: [],
  hasSales: true, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  ...over,
});

console.log("\n— a clean retail quarter is 100% and ready —");
{
  const r = buildReadiness(perfect());
  check("score = 100", r.score === 100);
  check("status ready", r.status === "ready" && r.ready === true);
  check("no missing, no risks", r.missing.length === 0 && r.risks.length === 0);
  check("all four dimensions applicable", r.dimensions.every((d) => d.applicable));
}

console.log("\n— the weighted mean is exact (30/30/20/20) —");
{
  // invoices 20/40 = 0.5 → 15; bank 1 → 30; cash 1 → 20; vat 1 → 20; = 85/100.
  const r = buildReadiness(perfect({ verifiedInvoiceCount: 40, invoicesWithEvidence: 20, missingEvidence: ["2026-003", "2026-007"] }));
  check("score = 85 (invoices at half weight)", r.score === 85);
  check("a missing-evidence item is listed", r.missing.some((m) => /originele document/.test(m.title)));
  check("not ready (something is missing)", r.status !== "ready");
}

console.log("\n— n.v.t. dimensions are EXCLUDED from the denominator, never faked —");
{
  // A ZZP: invoices + bank only, no till, no cash-without-rate. cash is n.v.t.
  // applicableWeight = 30+30+20(vat) = 80; earned = 30+30+20 = 80 → 100.
  const zzp = buildReadiness({
    quarterLabel: "Q1 2026",
    verifiedInvoiceCount: 10, invoicesWithEvidence: 10, missingEvidence: [],
    bankTxCount: 30, undocumentedCount: 0,
    usesTurnover: false, turnoverDays: 0, reconExceptions: [],
    hasSales: true, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  });
  check("cash dimension is n.v.t.", zzp.dimensions.find((d) => d.key === "cash")!.applicable === false);
  check("score = 100 with cash excluded (not dragged to 75)", zzp.score === 100);
  check("ready", zzp.status === "ready");
}

console.log("\n— missing bank data is a real gap (bank → 0) —");
{
  const r = buildReadiness(perfect({ bankTxCount: 0, undocumentedCount: 0 }));
  // invoices 30 + cash 20 + vat 20 = 70 earned; bank 30 applicable @0 → /100 = 70.
  check("score = 70 (bank weight fully lost)", r.score === 70);
  check("'Bankafschrift ontbreekt' is missing", r.missing.some((m) => /Bankafschrift ontbreekt/.test(m.title)));
  check("almost, not ready", r.status === "almost");
}

console.log("\n— undocumented bank lines lower the bank ratio proportionally —");
{
  // 120 tx, 12 undocumented → resolved 108/120 = 0.9 → bank 27. 30+27+20+20 = 97.
  const r = buildReadiness(perfect({ bankTxCount: 120, undocumentedCount: 12 }));
  check("score = 97 (bank at 0.9)", r.score === 97);
  check("a 'wacht nog op een bon' item is listed", r.missing.some((m) => /wachten nog op een bon/.test(m.title)));
  check("not ready (a gap remains)", r.status !== "ready");
}

console.log("\n— reconciliation differences are RISKS (eyeball), not blocking gaps —");
{
  // The strategist's example: 3 July, cash register €340 higher than bank deposits.
  const r = buildReadiness(perfect({
    reconExceptions: [{ date: "2026-07-03", kind: "cash", note: "kas vs bank", diff: 340 }],
  }));
  check("a risk is listed with the date and amount", r.risks.some((x) => x.title.includes("2026-07-03") && x.title.includes("340")));
  check("the risk is NOT counted as missing", r.missing.length === 0);
  check("one off-day among 90 → score capped at 99 (never a false 100)", r.score === 99);
  check("still 'ready' — a documented risk doesn't block handover", r.status === "ready");
}

console.log("\n— unrated cash omzet is a BTW gap (missing) —");
{
  const r = buildReadiness(perfect({ cashOmzetZonderBtw: 250 }));
  check("vat dimension drops below 1", r.dimensions.find((d) => d.key === "vat")!.subscore < 1);
  check("'€250 contante omzet zonder BTW-tarief' listed", r.missing.some((m) => /250 contante omzet zonder BTW-tarief/.test(m.title)));
  check("not ready", r.status !== "ready");
}

console.log("\n— partial kassadag coverage is a BTW gap —");
{
  const r = buildReadiness(perfect({ turnoverDays: 80, quarterDays: 90 }));
  check("'80 van 90 kassadagen' listed", r.missing.some((m) => /80 van 90 kassadagen/.test(m.title)));
  check("cash dimension still scores the 80 imported days", r.dimensions.find((d) => d.key === "cash")!.subscore === 1);
}

console.log("\n— empty quarter: nothing to judge → 0, attention —");
{
  const r = buildReadiness({
    quarterLabel: "Q1 2026",
    verifiedInvoiceCount: 0, invoicesWithEvidence: 0, missingEvidence: [],
    bankTxCount: 0, undocumentedCount: 0,
    usesTurnover: false, turnoverDays: 0, reconExceptions: [],
    hasSales: false, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  });
  check("score 0", r.score === 0);
  check("attention", r.status === "attention");
  check("invoices + cash + vat n.v.t.; only bank applicable", r.dimensions.filter((d) => d.applicable).length === 1);
  check("a 'geen gegevens' note is present", r.notes.some((n) => /nog geen gegevens/.test(n)));
}

console.log("\n— a perfect score with a flagged risk never shows 100 —");
{
  const r = buildReadiness(perfect({ hasUndecidableRate: true }));
  check("undecidable rate is a risk", r.risks.some((x) => /rubriek 1c/.test(x.title)));
  // It both drops the vat check (2/3) AND flags a risk: vat 13.33 → 30+30+20+13.33 = 93.
  check("score reflects the failed vat check (93), never a false 100", r.score === 93 && r.score < 100);
}

console.log("\n— bank-only must NOT be a false 100% green (fix A) —");
{
  // Uploaded ONLY a fully-reconciled bank statement: no invoices, no turnover, no cash.
  // The whole sales side is absent — that's a GAP, not n.v.t. Never 'ready', never ~100%.
  const r = buildReadiness({
    quarterLabel: "Q1 2026",
    verifiedInvoiceCount: 0, invoicesWithEvidence: 0, missingEvidence: [],
    bankTxCount: 10, undocumentedCount: 0,
    usesTurnover: false, turnoverDays: 0, reconExceptions: [],
    hasSales: false, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  });
  check("NOT ready (revenue side is missing)", r.status !== "ready" && r.ready === false);
  check("'Nog geen omzet vastgelegd' is a missing gap", r.missing.some((m) => /Nog geen omzet vastgelegd/.test(m.title)));
  check("BTW dimension is a real gap (applicable, 0%), not n.v.t.", r.dimensions.find((d) => d.key === "vat")!.applicable === true && r.dimensions.find((d) => d.key === "vat")!.subscore === 0);
  check("score = 60 (bank 30 earned / (bank 30 + vat 20) applicable), never ~100", r.score === 60);
  check("status attention", r.status === "attention");
}

console.log("\n— a pure-purchase quarter (inkoop + bank, geen omzet) flags the missing revenue —");
{
  const r = buildReadiness({
    quarterLabel: "Q1 2026",
    verifiedInvoiceCount: 5, invoicesWithEvidence: 5, missingEvidence: [],
    bankTxCount: 20, undocumentedCount: 0,
    usesTurnover: false, turnoverDays: 0, reconExceptions: [],
    hasSales: false, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  });
  check("'Nog geen omzet vastgelegd' flagged even with purchases present", r.missing.some((m) => /Nog geen omzet vastgelegd/.test(m.title)));
  check("not ready", r.status !== "ready");
  // invoices 30 + bank 30 earned; vat 20 applicable @0; cash n.v.t. → 60/80 = 75.
  check("score = 75 (revenue side counts against readiness)", r.score === 75);
}

console.log("\n— an EMPTY quarter still has BTW as n.v.t. (no activity → nothing to judge) —");
{
  const r = buildReadiness({
    quarterLabel: "Q1 2026",
    verifiedInvoiceCount: 0, invoicesWithEvidence: 0, missingEvidence: [],
    bankTxCount: 0, undocumentedCount: 0,
    usesTurnover: false, turnoverDays: 0, reconExceptions: [],
    hasSales: false, cashOmzetZonderBtw: 0, quarterDays: 90, hasUndecidableRate: false, hasEuPurchase: false,
  });
  check("no activity → BTW n.v.t. (not a spurious 'geen omzet' gap)", r.dimensions.find((d) => d.key === "vat")!.applicable === false);
  check("no spurious omzet-missing item on a truly empty quarter", !r.missing.some((m) => /Nog geen omzet vastgelegd/.test(m.title)));
}

console.log("\n— readiness never claims what it can't measure (honest note always present) —");
{
  const r = buildReadiness(perfect());
  check("states the score only measures what was imported", r.notes.some((n) => /alleen wat is geïmporteerd/.test(n)));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
