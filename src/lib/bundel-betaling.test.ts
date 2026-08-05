// [BUNDEL-BETALING] Pure node test — run: npx tsx src/lib/bundel-betaling.test.ts
import {
  buildBundelBetaling,
  MAX_BUNDEL_BETALING,
  type BundelBetalingInvoice,
} from "./bundel-betaling";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const IBAN_A = "NL91ABNA0417164300";
const IBAN_B = "NL25RABO0133368882";

function inv(over: Partial<BundelBetalingInvoice> = {}): BundelBetalingInvoice {
  return {
    id: over.id ?? "00000000-0000-0000-0000-000000000001",
    status: "received",
    invoice_number: "F-1001",
    payment_reference: null,
    client_name: "Groothandel De Vries B.V.",
    vendor_iban: IBAN_A,
    total_inc_btw: 121,
    amount_paid: 0,
    ...over,
  };
}

console.log("\n— buildBundelBetaling —");
{
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "F-1001", total_inc_btw: 121 }),
    inv({ id: "b", invoice_number: "F-1002", total_inc_btw: 60.5 }),
  ]);
  check("two open supplier invoices build ok", r.ok === true);
  check("amount = sum of totals", r.amount === 181.5);
  check("beneficiary = supplier name", r.beneficiaryName === "Groothandel De Vries B.V.");
  check("beneficiary IBAN = supplier IBAN", r.iban === IBAN_A);
  check("reference lists every number", r.reference === "F-1001, F-1002");
  check("EPC payload carries the sum", !!r.epcPayload && r.epcPayload.includes("EUR181.50"));
  check("EPC beneficiary line is the supplier IBAN", !!r.epcPayload && r.epcPayload.split("\n")[6] === IBAN_A);
}
{
  const r = buildBundelBetaling([
    inv({ id: "a", payment_reference: "KENMERK-77", invoice_number: "F-1001" }),
    inv({ id: "b", invoice_number: "F-1002", total_inc_btw: 50 }),
  ]);
  check("betalingskenmerk wins over invoice number", r.reference === "KENMERK-77, F-1002");
}
{
  const r = buildBundelBetaling([
    inv({ id: "a", total_inc_btw: 1000, amount_paid: 400 }),
    inv({ id: "b", invoice_number: "F-1002", total_inc_btw: 100 }),
  ]);
  check("partially paid invoice pays only the open rest", r.ok === true && r.amount === 700);
}
{
  // IBANs equal after normalization (spaces / lowercase) still bundle.
  const r = buildBundelBetaling([
    inv({ id: "a" }),
    inv({ id: "b", invoice_number: "F-1002", vendor_iban: "nl91 abna 0417 1643 00" }),
  ]);
  check("same IBAN with spaces/case bundles fine", r.ok === true);
}
check("single invoice rejected", buildBundelBetaling([inv()]).ok === false);
check("over the cap rejected", buildBundelBetaling(
  Array.from({ length: MAX_BUNDEL_BETALING + 1 }, (_, i) => inv({ id: `x${i}` }))
).ok === false);
check("different supplier IBANs rejected", buildBundelBetaling(
  [inv({ id: "a" }), inv({ id: "b", vendor_iban: IBAN_B })]
).ok === false);
check("missing IBAN rejected", buildBundelBetaling(
  [inv({ id: "a" }), inv({ id: "b", vendor_iban: null })]
).ok === false);
check("invalid IBAN rejected", buildBundelBetaling(
  [inv({ id: "a" }), inv({ id: "b", vendor_iban: "NL00FOUT0000000000" })]
).ok === false);
check("paid invoice in the set rejected", buildBundelBetaling(
  [inv({ id: "a" }), inv({ id: "b", status: "paid" })]
).ok === false);
check("fully covered invoice (open = 0) rejected", buildBundelBetaling(
  [inv({ id: "a" }), inv({ id: "b", total_inc_btw: 100, amount_paid: 100 })]
).ok === false);
check("missing supplier name rejected", buildBundelBetaling(
  [inv({ id: "a", client_name: null }), inv({ id: "b", client_name: "  " })]
).ok === false);
{
  // Name may be missing on ONE row as long as a sibling supplies it (same IBAN
  // = same supplier, OCR just missed the name on one document).
  const r = buildBundelBetaling([
    inv({ id: "a", client_name: null }),
    inv({ id: "b", invoice_number: "F-1002" }),
  ]);
  check("name from a sibling row fills the gap", r.ok === true && r.beneficiaryName === "Groothandel De Vries B.V.");
}

// ─── [CREDIT-SAFE] A creditnota may never join a transfer ─────────────────────
//
// The failure this closes was worth exactly twice the credit. openAmount() takes Math.abs(total),
// so a supplier creditnota — which is also 'received', also has an open balance, and is also
// selectable on Crediteuren — arrived as a POSITIVE amount and was ADDED to the bundle. The one
// guard that could have caught it, `items.some(it => it.amount <= 0)`, is defeated by that abs()
// two functions up.
//
// Measured on the real builder: two invoices of € 520,57 and € 281,06 plus a € 51,80 credit gave
// € 853,43 instead of € 749,83. The owner transfers € 103,60 too much in one tap — once for not
// subtracting it, once for adding it — and the supplier now owes them the difference on top of the
// credit they already owed.

const creditRows = [
  inv({ id: "a", invoice_number: "RE1", total_inc_btw: 520.57 }),
  inv({ id: "b", invoice_number: "RE2", total_inc_btw: 281.06 }),
];
check("two ordinary invoices still bundle", (() => {
  const r = buildBundelBetaling(creditRows);
  return r.ok === true && Math.abs((r.amount ?? 0) - 801.63) < 0.005;
})());

check("a creditnota in the selection is REFUSED, not added", buildBundelBetaling([
  ...creditRows,
  inv({ id: "c", invoice_number: "CR9", total_inc_btw: -51.80, invoice_type: "creditnota" }),
]).ok === false);

check("…and a negative total alone is enough — however the supplier typed it", buildBundelBetaling([
  ...creditRows,
  inv({ id: "c", invoice_number: "51190", total_inc_btw: -51.80 }),
]).ok === false);

check("the refusal names the row and says what to do with it", (() => {
  const r = buildBundelBetaling([
    ...creditRows,
    inv({ id: "c", invoice_number: "CR9", total_inc_btw: -51.80, invoice_type: "creditnota" }),
  ]);
  return r.ok === false
    && /CR9/.test(r.error ?? "")
    && /creditnota/.test(r.error ?? "")
    && /openstaande saldo/.test(r.error ?? "");
})());


console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
