// [BANK-REMATCH] Pure node test — run: npx tsx src/lib/bank-rematch.test.ts
import { planRematch } from "./bank-rematch";
import type { BankTransaction } from "./bank-parser";
import type { InvoiceForMatching } from "./bank-matching";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const tx = (o: Partial<BankTransaction> & { transactionId: string }): BankTransaction => ({
  date: "2026-06-20",
  amount: -242,
  currency: "EUR",
  description: "",
  counterpartName: "ATAPACK Cash & Carry B.V.",
  counterpartIban: null,
  reference: null,
  rawLine: "",
  ...o,
});

const inv = (o: Partial<InvoiceForMatching> & { id: string }): InvoiceForMatching => ({
  invoice_number: "26302050",
  total_inc_btw: 242,
  invoice_date: "2026-06-18",
  due_date: "2026-07-18",
  client_name: "ATAPACK Cash & Carry B.V.",
  direction: "incoming",
  status: "received",
  accountant_status: null,
  ...o,
});

console.log("— the invoice arrived after the line was set aside —");
{
  // June: no invoice, owner ignores the payment. August: the invoice is imported.
  const plan = planRematch({
    ignored: [tx({ transactionId: "t1", reference: "factuur 26302050" })],
    pending: [],
    invoices: [inv({ id: "i1" })],
  });
  check("the set-aside line is restored", plan.restore.length === 1);
  check("…pointing at the invoice that arrived", plan.restore[0]?.invoiceId === "i1");
  check("…carrying its number for the audit trail", plan.restore[0]?.invoiceNumber === "26302050");
  check("nothing is reported as ambiguous", plan.ambiguous.length === 0);
}

console.log("\n— a decision with no new evidence is left alone —");
{
  // The standing order the owner ignored on purpose. Nothing matches it; it must stay ignored.
  const plan = planRematch({
    ignored: [tx({ transactionId: "t1", amount: -850, counterpartName: "Woningstichting Huur", reference: null })],
    pending: [],
    invoices: [inv({ id: "i1" })], // €242 ATAPACK — unrelated
  });
  check("not restored", plan.restore.length === 0);
  check("not even reported as ambiguous", plan.ambiguous.length === 0);
  check("counted as unchanged, so the report can say so", plan.unchanged === 1);
}

console.log("\n— an AMBIGUOUS match is reported, never acted on —");
{
  // Two open invoices of the same amount, same supplier: the matcher cannot pick, so this is
  // exactly the nagging the owner used "Genegeerd" to escape. Report it; do not resurrect it.
  const plan = planRematch({
    ignored: [tx({ transactionId: "t1", reference: null })],
    pending: [],
    invoices: [
      inv({ id: "i1", invoice_number: "26302050" }),
      inv({ id: "i2", invoice_number: "26302362", invoice_date: "2026-06-19" }),
    ],
  });
  check("NOT restored on an ambiguous match", plan.restore.length === 0);
  check("but the owner is told it exists", plan.ambiguous.length === 1 && plan.ambiguous[0] === "t1");
}

console.log("\n— an invoice the ACTIVE list is working on is never taken away —");
{
  // Case A — identity vs coincidence. The live line literally prints the invoice number; the
  // set-aside one only matches on amount + name + date. Since [BANK-IDENTITY-OUTRANKS] capped the
  // identity-less path below the reference score, the one-to-one guard now hands the invoice to
  // the live line ON MERIT — the set-aside line ends with no candidate at all, so the honest
  // answer is "unchanged", not "ambiguous". (Before that cap the coincidence scored 1.0 vs 0.97
  // and would have STOLEN the invoice; the inPlay guard below was the only thing stopping it.)
  const planA = planRematch({
    ignored: [tx({ transactionId: "t-ignored", reference: null })],
    pending: [tx({ transactionId: "t-live", reference: "factuur 26302050" })],
    invoices: [inv({ id: "i1" })],
  });
  check("identity wins: the set-aside line is NOT restored", planA.restore.length === 0);
  check("…and with no candidate left it counts as unchanged", planA.unchanged === 1);
  check("no pending line is ever part of the plan",
    !planA.restore.some((r) => r.transactionId === "t-live") && !planA.ambiguous.includes("t-live"));

  // Case B — no identity on EITHER side, so the guard ranks on confidence alone. The set-aside
  // line (payment near the invoice date) out-scores the live one (payment months later, date
  // bonus 0) and wins outcome 'auto'. THIS is where the inPlay guard earns its keep: the invoice
  // is a live line's candidate, so reviving the set-aside line would steal it from the active
  // list — report it, never act on it.
  const planB = planRematch({
    ignored: [tx({ transactionId: "t-ignored", reference: null, date: "2026-06-20" })],
    pending: [tx({ transactionId: "t-live", reference: null, date: "2026-10-05" })],
    invoices: [inv({ id: "i1" })],
  });
  check("no-identity tie: the set-aside line is NOT restored against an invoice in play", planB.restore.length === 0);
  check("…but it IS reported, so nothing is hidden", planB.ambiguous.includes("t-ignored"));

  // Control: with no live line competing, the very same set-aside line IS restored.
  const alone = planRematch({
    ignored: [tx({ transactionId: "t-ignored", reference: null })],
    pending: [],
    invoices: [inv({ id: "i1" })],
  });
  check("CONTROL: with nothing competing, the same line is restored", alone.restore.length === 1);
}

console.log("\n— guards —");
{
  check("no ignored lines → an empty plan",
    planRematch({ ignored: [], pending: [tx({ transactionId: "p" })], invoices: [inv({ id: "i1" })] }).restore.length === 0);
  check("no invoices → nothing restored, everything counted unchanged", (() => {
    const p = planRematch({ ignored: [tx({ transactionId: "t1" }), tx({ transactionId: "t2" })], pending: [], invoices: [] });
    return p.restore.length === 0 && p.unchanged === 2;
  })());
  check("a paid invoice can never revive a line", (() => {
    const p = planRematch({
      ignored: [tx({ transactionId: "t1", reference: "factuur 26302050" })],
      pending: [],
      invoices: [inv({ id: "i1", status: "paid" })],
    });
    return p.restore.length === 0;
  })());
  check("an accountant-'verwerkt' invoice can never revive a line", (() => {
    const p = planRematch({
      ignored: [tx({ transactionId: "t1", reference: "factuur 26302050" })],
      pending: [],
      invoices: [inv({ id: "i1", accountant_status: "verwerkt" })],
    });
    return p.restore.length === 0;
  })());
  check("the sign guard still holds (a credit cannot pay a purchase invoice)", (() => {
    const p = planRematch({
      ignored: [tx({ transactionId: "t1", amount: 242, reference: "factuur 26302050" })],
      pending: [],
      invoices: [inv({ id: "i1", direction: "incoming" })],
    });
    return p.restore.length === 0;
  })());
  check("two set-aside lines never claim the SAME invoice", (() => {
    const p = planRematch({
      ignored: [
        tx({ transactionId: "t1", reference: "factuur 26302050" }),
        tx({ transactionId: "t2", reference: "factuur 26302050" }),
      ],
      pending: [],
      invoices: [inv({ id: "i1" })],
    });
    const ids = p.restore.map((r) => r.invoiceId);
    return new Set(ids).size === ids.length;
  })());
  check("re-running the same plan is idempotent (pure, no state)", (() => {
    const args = {
      ignored: [tx({ transactionId: "t1", reference: "factuur 26302050" })],
      pending: [],
      invoices: [inv({ id: "i1" })],
    };
    return JSON.stringify(planRematch(args)) === JSON.stringify(planRematch(args));
  })());
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
