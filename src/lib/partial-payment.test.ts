// [PARTIAL-PAY] Pure node test — run: npx tsx src/lib/partial-payment.test.ts
import {
  openAmount,
  isPartiallyPaid,
  parseAmountInput,
  interpretAmountEntry,
  paidAmount,
  toCents,
  buildPaymentResult,
} from "./partial-payment";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— openAmount —");
check("fully open invoice → full total", openAmount({ status: "sent", total_inc_btw: 1000, amount_paid: 0 }) === 1000);
check("half paid → remainder", openAmount({ status: "sent", total_inc_btw: 1000, amount_paid: 400 }) === 600);
check("status paid → 0 regardless of amount_paid", openAmount({ status: "paid", total_inc_btw: 1000, amount_paid: 0 }) === 0);
check("legacy paid row (no amount_paid) → 0", openAmount({ status: "paid", total_inc_btw: 250 }) === 0);
check("creditnota negative total → magnitude", openAmount({ status: "sent", total_inc_btw: -500, amount_paid: 0 }) === 500);
check("over-recorded amount_paid never goes negative", openAmount({ status: "sent", total_inc_btw: 100, amount_paid: 250 }) === 0);
check("missing total → 0", openAmount({ status: "sent" }) === 0);
check("float dust is rounded to cents", openAmount({ status: "sent", total_inc_btw: 0.3, amount_paid: 0.1 }) === 0.2);
check("paidAmount clamps negatives", paidAmount({ amount_paid: -50 }) === 0);
check("toCents rounds half up", toCents(1.005) === 1.01 || toCents(1.005) === 1.0);

console.log("\n— isPartiallyPaid —");
check("nothing paid → false", isPartiallyPaid({ status: "sent", total_inc_btw: 1000, amount_paid: 0 }) === false);
check("half paid → true", isPartiallyPaid({ status: "sent", total_inc_btw: 1000, amount_paid: 400 }) === true);
check("fully covered but still 'sent' → false", isPartiallyPaid({ status: "sent", total_inc_btw: 1000, amount_paid: 1000 }) === false);
check("status paid → false", isPartiallyPaid({ status: "paid", total_inc_btw: 1000, amount_paid: 400 }) === false);
check("a cent of dust does not count as partial", isPartiallyPaid({ status: "sent", total_inc_btw: 1000, amount_paid: 0.004 }) === false);

console.log("\n— parseAmountInput —");
check("plain integer", parseAmountInput("400") === 400);
check("dutch decimal comma", parseAmountInput("400,50") === 400.5);
check("english decimal point", parseAmountInput("400.50") === 400.5);
check("dutch grouped thousands", parseAmountInput("1.000,00") === 1000);
check("dutch grouped, no decimals", parseAmountInput("1.000") === 1000);
check("english grouped thousands", parseAmountInput("1,000.00") === 1000);
check("euro sign and spaces stripped", parseAmountInput(" € 1.234,56 ") === 1234.56);
check("millions, dutch", parseAmountInput("1.234.567,89") === 1234567.89);
check("two decimals after dot stays decimal", parseAmountInput("10.50") === 10.5);
check("empty → null", parseAmountInput("") === null);
check("whitespace only → null", parseAmountInput("   ") === null);
check("null input → null", parseAmountInput(null) === null);
check("letters → null", parseAmountInput("abc") === null);
check("mixed junk → null", parseAmountInput("40a0") === null);
check("negative sign rejected", parseAmountInput("-40") === null);
check("ambiguous double dot → null", parseAmountInput("1.2.3") === null);
check("zero parses to zero (not null)", parseAmountInput("0") === 0);

console.log("\n— interpretAmountEntry —");
{
  const e = interpretAmountEntry("", 1000);
  check("blank = settle everything", e.amount === null && e.valid === true && e.settlesFully === true);
  check("blank leaves nothing open", e.remainingAfter === 0);
}
{
  const e = interpretAmountEntry("400", 1000);
  check("partial amount is valid", e.valid === true && e.amount === 400);
  check("partial leaves the rest open", e.remainingAfter === 600);
  check("partial does not settle fully", e.settlesFully === false);
}
{
  const e = interpretAmountEntry("1000", 1000);
  check("exact open amount settles fully", e.valid === true && e.settlesFully === true && e.remainingAfter === 0);
  check("exact open amount reports amount null (= settle everything)", e.amount === null);
}
{
  const e = interpretAmountEntry("4000", 1000);
  check("above the open balance is rejected", e.valid === false);
  check("rejection names the maximum", (e.error ?? "").includes("1.000,00"));
}
{
  const e = interpretAmountEntry("0", 1000);
  check("zero is rejected", e.valid === false && (e.error ?? "").includes("hoger"));
}
{
  const e = interpretAmountEntry("abc", 1000);
  check("junk is rejected with a clear message", e.valid === false && (e.error ?? "").includes("geldig"));
}
{
  const e = interpretAmountEntry("999,995", 1000);
  check("within a cent of the balance settles fully", e.settlesFully === true);
}
{
  const e = interpretAmountEntry("", 0);
  check("nothing open → blank entry is not submittable", e.valid === false);
}
{
  const e = interpretAmountEntry("1.000,00", 1000);
  check("formatted dutch input is accepted at the boundary", e.valid === true && e.settlesFully === true);
}

console.log("\n— buildPaymentResult (the API contract both clients branch on) —");
{
  // A real deelbetaling: €400 of €1000. The clients decide "still open" from `partial`.
  const r = buildPaymentResult({ applied: 400, amount_paid: 400, total: 1000, is_paid: false }, "sent");
  check("partial booking reports partial=true", r.partial === true);
  check("partial booking keeps the open status", r.status === "sent");
  check("partial booking reports what was applied", r.applied === 400);
  check("partial booking reports the running total", r.amountPaid === 400);
  check("partial booking reports what is left", r.remaining === 600);
  check("no duplicate flag on a real booking", r.duplicate === undefined);
}
{
  const r = buildPaymentResult({ applied: 600, amount_paid: 1000, total: 1000, is_paid: true }, "sent");
  check("completing booking reports partial=false", r.partial === false);
  check("completing booking flips the status to paid", r.status === "paid");
  check("completing booking leaves nothing open", r.remaining === 0);
}
{
  // The replay of a partial must be indistinguishable from the original, plus the flag.
  const first = buildPaymentResult({ applied: 400, amount_paid: 400, total: 1000, is_paid: false }, "received");
  const replay = buildPaymentResult({ applied: 400, amount_paid: 400, total: 1000, is_paid: false, duplicate: true }, "received");
  check("replay carries the duplicate flag", replay.duplicate === true);
  check("replay agrees with the original on partial", replay.partial === first.partial);
  check("replay agrees with the original on remaining", replay.remaining === first.remaining);
  check("replay agrees with the original on status", replay.status === first.status);
  check("incoming invoice keeps 'received' while partly paid", first.status === "received");
}
{
  const r = buildPaymentResult({ applied: 100, amount_paid: 100, total: 100, is_paid: true }, null);
  check("missing open status falls back safely", r.status === "paid");
  const p = buildPaymentResult({ applied: 30, amount_paid: 30, total: 100, is_paid: false }, null);
  check("missing open status on a partial defaults to sent", p.status === "sent");
}
{
  const r = buildPaymentResult({ applied: 0.1, amount_paid: 0.3, total: 1, is_paid: false }, "sent");
  check("remaining is rounded to cents", r.remaining === 0.7);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
