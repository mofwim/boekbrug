// [CARD-RECON] Pure node test — run: npx tsx src/lib/card-reconcile.test.ts
import { reconcileCardDay, reconcileCardPeriod, netCommissionToBook } from "./card-reconcile";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number, t = 0.005) => Math.abs(a - b) <= t;

console.log("\n— full triangle, clean day (till == EFT gross, bank net → commission) —");
{
  const r = reconcileCardDay({ date: "2026-07-03", tillPin: 1000, eftGross: 1000, bankNet: 985 });
  check("gross matches (till == EFT)", r.grossMatch === true);
  check("commission = 15 (gross − net)", near(r.commission!, 15));
  check("status ok", r.status === "ok");
  check("no breaks", r.breaks.length === 0);
}

console.log("\n— Leg A break: till PIN ≠ EFT gross is a REAL discrepancy, not commission —");
{
  const r = reconcileCardDay({ date: "2026-07-03", tillPin: 1000, eftGross: 940, bankNet: 930 });
  check("gross mismatch flagged", r.grossMatch === false);
  check("card_gross break raised", r.breaks.some((b) => b.kind === "card_gross"));
  check("status gross_mismatch", r.status === "gross_mismatch");
  check("break note calls it a real difference, not commission", /geen commissie/i.test(r.breaks.find((b) => b.kind === "card_gross")!.note));
}

console.log("\n— old bug reproduced then closed: gross-vs-net no longer silently swallowed —");
{
  // Till gross 2086.65, bank net 2050 → the €36.65 the OLD engine hid in tolerance is now
  // an explicit commission (Leg B), and Leg A still verifies via the EFT gross.
  const r = reconcileCardDay({ date: "2026-07-03", tillPin: 2086.65, eftGross: 2086.65, bankNet: 2050 });
  check("Leg A verifies gross (till == EFT)", r.grossMatch === true);
  check("commission surfaced = 36.65 (was silently discarded before)", near(r.commission!, 36.65));
}

console.log("\n— real cross-check pair: till PIN 2086.65 == bookkeeper PIN ledger 2086.65 —");
{
  const r = reconcileCardDay({ date: "2026-07-03", tillPin: 2086.65, eftGross: 2086.65, ledgerPin: 2086.65 });
  check("no ledger_pin break (ledger confirms till)", !r.breaks.some((b) => b.kind === "ledger_pin"));
  const bad = reconcileCardDay({ date: "2026-07-03", tillPin: 2086.65, eftGross: 2086.65, ledgerPin: 2000 });
  check("ledger disagreement raises ledger_pin break", bad.breaks.some((b) => b.kind === "ledger_pin"));

  // [RE-REVIEW MED-1] A ledger disagreement must NOT withhold the day's commission from the
  // booked period cost. Leg B (eftGross − bankNet) is independent of the till/ledger cross-check.
  const p = reconcileCardPeriod([
    { date: "2026-07-03", tillPin: 2086.65, eftGross: 2086.65, bankNet: 2000.00, ledgerPin: 2000 }, // ledger disagrees (86.65 off)
  ]);
  check("ledger disagreement does NOT withhold the €86.65 commission", Math.abs(p.totalCommission - 86.65) < 0.005);
  check("ledger disagreement is still surfaced (a break exists)", p.days[0].breaks.some((b) => b.kind === "ledger_pin"));
  // A genuine card_gross break (till ≠ terminal) DOES still withhold the commission (day suspect).
  const susp = reconcileCardPeriod([{ date: "d", tillPin: 1000, eftGross: 900, bankNet: 880 }]);
  check("a real till≠terminal break still withholds commission", susp.totalCommission === 0);
}

console.log("\n— commission plausibility guards —");
{
  const neg = reconcileCardDay({ date: "d", tillPin: 1000, eftGross: 1000, bankNet: 1100 });
  check("bank pays MORE than gross → commission_negative, commission nulled", neg.breaks.some((b) => b.kind === "commission_negative") && neg.commission === null);
  const big = reconcileCardDay({ date: "d", tillPin: 1000, eftGross: 1000, bankNet: 800 });
  check("20% 'commission' flagged implausible", big.breaks.some((b) => b.kind === "commission_implausible"));
}

console.log("\n— honesty: incomplete when a corner is missing (no invention) —");
{
  const noBank = reconcileCardDay({ date: "d", tillPin: 1000, eftGross: 1000 });
  check("no bank payout → commission null, status incomplete", noBank.commission === null && noBank.status === "incomplete");
  check("note says payout not yet matched", noBank.notes.some((n) => /nog niet gekoppeld/i.test(n)));
  const noEft = reconcileCardDay({ date: "d", tillPin: 1000, eftGross: null });
  check("no EFT → grossMatch null, status incomplete", noEft.grossMatch === null && noEft.status === "incomplete");
}

console.log("\n— period aggregation: total commission + exception counts —");
{
  const p = reconcileCardPeriod([
    { date: "2026-07-01", tillPin: 1000, eftGross: 1000, bankNet: 985 }, // comm 15
    { date: "2026-07-02", tillPin: 500, eftGross: 500, bankNet: 492 },   // comm 8
    { date: "2026-07-03", tillPin: 800, eftGross: 750, bankNet: 745 },   // gross mismatch
    { date: "2026-07-04", tillPin: 600, eftGross: 600 },                 // incomplete (no bank)
  ]);
  check("total commission = 23 (15 + 8, mismatch/incomplete excluded)", near(p.totalCommission, 23));
  check("1 gross-mismatch day", p.grossMismatchDays === 1);
  check("incomplete day counted", p.incompleteDays >= 1);
}

// [EXCEPTION-COUNT] A commission_issue day books NO commission, so the period's costs are knowingly
// incomplete — yet it used to be counted in NEITHER exception total, which made it invisible to
// every surface except the accountant's CSV. The three counters must also stay mutually exclusive
// (one status per day), because the truth screen SUMS them into one "kassadagen" figure.
console.log("\n— period aggregation: commission_issue days are counted, and the counters never overlap —");
{
  const p = reconcileCardPeriod([
    { date: "2026-07-01", tillPin: 1000, eftGross: 1000, bankNet: 985 },  // ok, comm 15
    { date: "2026-07-02", tillPin: 500, eftGross: 500, bankNet: 520 },    // payout > gross → issue
    { date: "2026-07-03", tillPin: 800, eftGross: 800, bankNet: 600 },    // 25% "commission" → issue
    { date: "2026-07-04", tillPin: 600, eftGross: 550, bankNet: 540 },    // gross mismatch
    { date: "2026-07-05", tillPin: 700, eftGross: 700 },                  // incomplete (no bank)
  ]);
  check("2 commission-issue days", p.commissionIssueDays === 2);
  check("1 gross-mismatch day", p.grossMismatchDays === 1);
  check("1 incomplete day", p.incompleteDays === 1);
  check("only the clean day books commission", near(p.totalCommission, 15));
  // 5 days in, 4 exceptions + 1 ok out: no day is counted twice, so the screen may sum them.
  check(
    "counters are disjoint (sum ≤ day count)",
    p.commissionIssueDays + p.grossMismatchDays + p.incompleteDays === 4,
  );
}

console.log("\n— netCommissionToBook: de-dup against acquirer fee invoices (Finding 1) —");
{
  check("no acquirer invoice → book full commission", near(netCommissionToBook(30, 0), 30));
  check("acquirer invoice fully covers → book 0 (no double-count)", near(netCommissionToBook(30, 30), 0));
  check("partial acquirer invoice → book residual", near(netCommissionToBook(30, 18), 12));
  check("over-covering invoice → floored at 0, never negative", near(netCommissionToBook(30, 45), 0));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
