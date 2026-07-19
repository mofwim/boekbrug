// [BAD-DEBT] Pure node test — run: npx tsx src/lib/bad-debt.test.ts
import { detectBadDebt, badDebtNote, oneYearLater, type BadDebtInput } from "./bad-debt";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

const inv = (over: Partial<BadDebtInput> = {}): BadDebtInput => ({
  invoiceNumber: "2025-001", clientName: "Klant BV", direction: "outgoing", status: "overdue",
  invoiceDate: "2025-01-01", dueDate: "2025-01-31", totalExBtw: 1000, btwAmount: 210, totalIncBtw: 1210, amountPaid: 0, ...over,
});
const run = (invoices: BadDebtInput[], asOf = "2026-07-19", scheme: "factuur" | "kas" = "factuur") =>
  detectBadDebt({ scheme, asOf, invoices });

console.log("\n— oneYearLater —");
{
  check("2025-01-31 → 2026-01-31", oneYearLater("2025-01-31") === "2026-01-31");
  check("bad input → ''", oneYearLater("nonsense") === "");
}

console.log("\n— kasstelsel: nothing to reclaim —");
{
  const r = run([inv()], "2026-07-19", "kas");
  check("kas → empty", r.eligible.length === 0 && r.totalReclaimableBtw === 0);
}

console.log("\n— eligible: >1yr past due, unpaid, declared —");
{
  const r = run([inv({ dueDate: "2025-01-31" })]); // 1yr = 2026-01-31 ≤ asOf 2026-07-19
  check("1 eligible", r.eligible.length === 1);
  check("reclaimable BTW = 210", near(r.totalReclaimableBtw, 210));
  check("unpaidEx = 1000", near(r.eligible[0].unpaidEx, 1000));
}

console.log("\n— NOT yet a year past due —");
{
  const r = run([inv({ dueDate: "2026-03-01" })]); // 1yr = 2027-03-01 > asOf
  check("not eligible before the 1-year mark", r.eligible.length === 0);
}

console.log("\n— fully paid / partially paid —");
{
  check("fully paid → nothing", run([inv({ amountPaid: 1210 })]).eligible.length === 0);
  const partial = run([inv({ amountPaid: 605 })]); // half paid → half the BTW reclaimable
  check("partial: reclaim only the unpaid half (105)", near(partial.totalReclaimableBtw, 105));
  check("partial: unpaidEx = 500", near(partial.eligible[0].unpaidEx, 500));
}

console.log("\n— excluded rows —");
{
  check("incoming ignored", run([inv({ direction: "incoming" })]).eligible.length === 0);
  check("draft ignored (BTW never declared)", run([inv({ status: "draft" })]).eligible.length === 0);
  check("processing ignored", run([inv({ status: "processing" })]).eligible.length === 0);
  check("paid status ignored (collected)", run([inv({ status: "paid" })]).eligible.length === 0);
  check("0%-sale: no BTW to reclaim", run([inv({ btwAmount: 0, totalIncBtw: 1000 })]).eligible.length === 0);
}

console.log("\n— no due_date → invoice-date fallback, flagged —");
{
  const r = run([inv({ dueDate: null, invoiceDate: "2025-01-01" })]); // 1yr from invoice = 2026-01-01 ≤ asOf
  check("eligible via invoice-date clock", r.eligible.length === 1);
  check("fallback flag set", r.usedInvoiceDateFallback === true);
  const withDue = run([inv({ dueDate: "2025-01-31" })]);
  check("fallback flag NOT set when due_date present", withDue.usedInvoiceDateFallback === false);
}

console.log("\n— asOf gate is inclusive of the exact anniversary —");
{
  const r = run([inv({ dueDate: "2025-07-19" })], "2026-07-19"); // exactly 1 year
  check("exactly 1 year → eligible", r.eligible.length === 1);
}

console.log("\n— badDebtNote —");
{
  const note = badDebtNote(run([inv(), inv({ invoiceNumber: "2025-002" })]))!;
  check("note names the count + reclaimable euros", /2 verkoopfacturen/.test(note) && /€420/.test(note));
  check("note says NOT auto-verrekend", /NIET automatisch/.test(note));
  check("empty result → null note", badDebtNote(run([inv({ amountPaid: 1210 })])) === null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
