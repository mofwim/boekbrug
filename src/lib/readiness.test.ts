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
  bankTxCount: 120, undocumentedCount: 0, unmatchedIncomeCount: 0,
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

console.log("\n— [TRUST-READY] a received payment with no invoice blocks 'klaar' —");
{
  // Was the CRITICAL false-green: an unmatched incoming payment never lowered the
  // score, so the quarter read '100% klaar' while revenue had no invoice behind it.
  const r = buildReadiness(perfect({ unmatchedIncomeCount: 2 }));
  check("not ready when a payment has no invoice", r.status !== "ready" && r.ready === false);
  check("surfaced as a MISSING gap (not a soft risk)", r.missing.some((m) => /zonder factuur/.test(m.title)));
  check("score dips below 100", r.score < 100);
  const clean = buildReadiness(perfect({ unmatchedIncomeCount: 0 }));
  check("zero unmatched income → still ready (no false alarm)", clean.status === "ready");
}

console.log("\n— [AUTO-EXCLUDE-REVIEW] auto-coded privé/overboeking/belasting lines surface for review —");
{
  // The money-hiding case: a line auto-coded (unconfirmed) as an EXCLUDED identity is dropped from
  // omzet/kosten/BTW. If it was MISlabelled, a real receipt/cost silently leaves the books. It must
  // surface — as a RISK (self-clearing on confirm), never a hard block (most are correct).
  const r = buildReadiness(perfect({ unreviewedExcludedCount: 4 }));
  check("surfaced as a RISK, not a blocking gap", r.risks.some((m) => /privé\/overboeking\/belasting/.test(m.title)));
  check("does NOT block 'klaar' (still ready — only a review nudge)", r.status === "ready" && r.ready === true);
  check("the risk deep-links to the EXCLUDED-only review list", r.risks.some((m) => m.fix?.href === "/dashboard/bank/categoriseren?view=review&only=excluded"));
  // With year/quarter present, the link is quarter-scoped AND excluded-only → opens EXACTLY the counted lines.
  const scoped = buildReadiness(perfect({ unreviewedExcludedCount: 2, year: 2026, quarter: 1 }));
  check("deep-link is quarter-scoped + excluded-only when year/quarter known", scoped.risks.some((m) => m.fix?.href === "/dashboard/bank/categoriseren?view=review&only=excluded&year=2026&quarter=1"));
  check("singular phrasing for a single line", buildReadiness(perfect({ unreviewedExcludedCount: 1 })).risks.some((m) => /^1 bankregel /.test(m.title)));
  const clean = buildReadiness(perfect({ unreviewedExcludedCount: 0 }));
  check("zero → no risk (no false alarm)", !clean.risks.some((m) => /privé\/overboeking\/belasting/.test(m.title)));
  const legacy = buildReadiness(perfect());
  check("undefined count → treated as 0 (older callers keep working)", !legacy.risks.some((m) => /privé\/overboeking\/belasting/.test(m.title)));
}

console.log("\n— [PACKAGE-READINESS] invoices still in the verify queue block 'klaar' —");
{
  // A real bill dated in the quarter but not yet verified reaches the accountant nowhere —
  // it must block "klaar" until the owner confirms it (the "geen ontbrekende factuur" rule).
  const r = buildReadiness(perfect({ unverifiedInvoiceCount: 3 }));
  check("not ready while invoices sit in the verify queue", r.status !== "ready" && r.ready === false);
  check("surfaced as a MISSING gap naming the verwerkingsrij", r.missing.some((m) => /verwerkingsrij/.test(m.title)));
  check("the gap deep-links to the invoices screen", r.missing.some((m) => m.fix?.href === "/dashboard/incoming"));
  const clean = buildReadiness(perfect({ unverifiedInvoiceCount: 0 }));
  check("zero unverified → still ready (no false alarm)", clean.status === "ready");
  const legacy = buildReadiness(perfect());
  check("undefined unverified count → treated as 0 (older callers keep working)", legacy.status === "ready");
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
    bankTxCount: 30, undocumentedCount: 0, unmatchedIncomeCount: 0,
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

console.log("\n— [NO-CODEER] uncoded cost debits don't BLOCK, but a supplier payment without an invoice is a surfaced voorbelasting RISK —");
{
  // 120 tx, 12 supplier-like cost debits with no inkoopfactuur. We never hand-code a bare debit
  // (that yields no BTW and can double-count) → NOT a blocking 'missing' gap. But the missing
  // voorbelasting is real, so it's surfaced as a RISK (eyeball, not block): still 'ready', and the
  // honesty guard caps the score at 99 so a clean 100 never hides an unclaimed BTW-aftrek.
  const r = buildReadiness(perfect({ bankTxCount: 120, undocumentedCount: 12 }));
  check("not a false 100 while voorbelasting may be missing (capped to 99)", r.score === 99);
  check("no 'wacht nog op een bon' MISSING gap is listed", !r.missing.some((m) => /wachten nog op een bon/.test(m.title)));
  check("surfaced as a voorbelasting RISK", r.risks.some((m) => /leverancierbetaling/.test(m.title)));
  check("still ready — a risk doesn't block handover", r.status === "ready");
}

console.log("\n— unmatched INCOME still lowers the bank ratio (revenue truth survives) —");
{
  // 120 tx, 12 received payments with no invoice behind them → resolved 108/120 = 0.9 →
  // bank 27. 30+27+20+20 = 97. Money in with no invoice must never silently pass.
  const r = buildReadiness(perfect({ bankTxCount: 120, unmatchedIncomeCount: 12 }));
  check("score = 97 (bank at 0.9)", r.score === 97);
  check("a 'zonder factuur' income item is listed", r.missing.some((m) => /zonder factuur/.test(m.title)));
  check("not ready (unexplained income is a gap)", r.status !== "ready");
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
  check("'€250 omzet zonder BTW-tarief' listed", r.missing.some((m) => /250 omzet zonder BTW-tarief/.test(m.title)));
  check("not ready", r.status !== "ready");
}

console.log("\n— omzet-zonder-tarief fix routes by SOURCE, not just by till —");
{
  // Plain cash (no till, no bank-sourced omzet) → the owner sets the rate at Kas.
  const cash = buildReadiness(perfect({ usesTurnover: false, turnoverDays: 0, cashOmzetZonderBtw: 250, omzetZonderBtwNonCash: 0 }));
  const cashItem = cash.missing.find((m) => /omzet zonder BTW-tarief/.test(m.title));
  check("plain cash omzet → fix points to Kas", cashItem?.fix?.href === "/dashboard/kas");

  // Bank-received omzet (money on the bank, rate lives in the Z-report) → Dagomzet,
  // even for a store with NO till rows yet. This was the live bug: €168k bank omzet
  // pointed to 'Naar Kas'.
  const bank = buildReadiness(perfect({ usesTurnover: false, turnoverDays: 0, cashOmzetZonderBtw: 168159, omzetZonderBtwNonCash: 168159 }));
  const bankItem = bank.missing.find((m) => /omzet zonder BTW-tarief/.test(m.title));
  check("bank-sourced omzet → fix points to Dagomzet (not Kas)", bankItem?.fix?.href === "/dashboard/dagomzet");
  check("bank-sourced detail mentions the Z-rapport", /Z-rapport/.test(bankItem?.detail ?? ""));
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
    bankTxCount: 0, undocumentedCount: 0, unmatchedIncomeCount: 0,
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
    bankTxCount: 10, undocumentedCount: 0, unmatchedIncomeCount: 0,
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
    bankTxCount: 20, undocumentedCount: 0, unmatchedIncomeCount: 0,
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
    bankTxCount: 0, undocumentedCount: 0, unmatchedIncomeCount: 0,
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

console.log("\n— [KAS-NEGATIEF] a negative cash drawer blocks 'klaar' —");
{
  const r = buildReadiness(perfect({ negativeCashDay: { date: "2026-02-15", balance: -120 } }));
  check("not ready when the drawer went negative", r.status !== "ready" && r.ready === false);
  check("surfaced as a MISSING gap naming the date + amount", r.missing.some((m) => /Kassaldo negatief/.test(m.title) && /2026-02-15/.test(m.title) && /120/.test(m.title)));
  check("the gap deep-links to Kas", r.missing.some((m) => m.fix?.href === "/dashboard/kas"));

  // THE FALSE-GREEN TEST: a pure-cash business (no till dimension) must STILL be blocked.
  const cashOnly = buildReadiness(perfect({ usesTurnover: false, turnoverDays: 0, negativeCashDay: { date: "2026-03-01", balance: -50 } }));
  check("cash-only business (till n.v.t.) is STILL blocked on a negative drawer", cashOnly.status !== "ready" && cashOnly.ready === false);

  // No false alarm: a non-negative / absent drawer stays ready.
  check("undefined negativeCashDay → still ready (older callers, no false alarm)", buildReadiness(perfect()).status === "ready");
  check("balance 0 → no gap (strict < 0)", buildReadiness(perfect({ negativeCashDay: { date: "2026-01-01", balance: 0 } })).status === "ready");
  check("positive balance passed in → no gap", buildReadiness(perfect({ negativeCashDay: { date: "2026-01-01", balance: 50 } })).status === "ready");
}

console.log("\n— [REGIME-FLAGS] special regimes are RISKS, never a block —");
{
  // A KOR-active shop did its part (imported everything); the regime is the accountant's to
  // apply. So it must surface as a risk and NOT lower the "klaar" verdict.
  const r = buildReadiness(perfect({
    regimeFlags: [{ code: "kor", title: "KOR is actief — bereken geen BTW", detail: "…" }],
  }));
  check("KOR flag surfaces as a risk", r.risks.some((x) => /KOR is actief/.test(x.title)));
  check("KOR flag is NOT a missing gap", !r.missing.some((x) => /KOR/.test(x.title)));
  check("still ready with only a regime risk (score capped at 99 by the honesty guard)",
    r.missing.length === 0 && r.status === "ready" && r.score === 99);
  const clean = buildReadiness(perfect());
  check("no regime flags → untouched (still 100)", clean.score === 100 && clean.risks.length === 0);
}
{
  // A phrase-gated flag carries its evidence into the risk detail.
  const r = buildReadiness(perfect({
    regimeFlags: [{ code: "reverse_charge_purchase", title: "Inkoop met BTW verlegd (rubriek 2a)", detail: "…", evidence: "INK-22" }],
  }));
  check("evidence invoice appears in the risk detail", r.risks.some((x) => /INK-22/.test(x.detail ?? "")));
}

console.log("\n— [KASSTELSEL] undated paid money blocks 'klaar' —");
{
  // Under cash basis, paid money we can't date can't be placed in a quarter → the BTW would be
  // silently too low. It must block "klaar" (a hard gap), and default (undefined) must not.
  const r = buildReadiness(perfect({ undatedPaidCount: 2 }));
  check("not ready when paid money is undated", r.status !== "ready" && r.ready === false);
  check("surfaced as a MISSING gap naming betaaldatum", r.missing.some((m) => /zonder betaaldatum/.test(m.title)));
  check("gap links to the bank screen", r.missing.some((m) => m.fix?.href === "/dashboard/bank"));
  const clean = buildReadiness(perfect({ undatedPaidCount: 0 }));
  check("zero undated → still ready (factuur owners untouched: undefined→0)", clean.status === "ready");
}
{
  // An estimated pay-date is a risk to eyeball, never a hard block.
  const r = buildReadiness(perfect({ estimatedPaidCount: 3 }));
  check("estimated pay-date is a risk, not a block", r.missing.every((m) => !/schatting/.test(m.title)) && r.risks.some((x) => /schatting/.test(x.title)));
  check("still ready with only an estimated-date risk (score capped 99)", r.missing.length === 0 && r.status === "ready");
}
{
  // [BAD-DEBT] Reclaimable BTW on >1yr-unpaid sales is a RISK (money to get back), never a gap.
  const r = buildReadiness(perfect({ badDebt: { count: 2, reclaimableBtw: 420 } }));
  check("bad-debt surfaces as a risk", r.risks.some((x) => /terugvraagbaar/.test(x.title)));
  check("bad-debt names count + euros", r.risks.some((x) => /2 onbetaalde/.test(x.title) && /€420/.test(x.title)));
  check("bad-debt is NOT a missing gap", !r.missing.some((x) => /terugvraagbaar/.test(x.title)));
  check("bad-debt does not block ready", r.missing.length === 0 && r.status === "ready");
  const none = buildReadiness(perfect({ badDebt: { count: 0, reclaimableBtw: 0 } }));
  check("no eligible bad debt → no risk", !none.risks.some((x) => /terugvraagbaar/.test(x.title)));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
