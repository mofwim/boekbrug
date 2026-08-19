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
  // [KENMERK-BEIDE] This used to read "betalingskenmerk wins over invoice number" and asserted
  // "KENMERK-77, F-1002" — the kenmerk REPLACING F-1001. It is not a contest: the two identify
  // different things. A kenmerk says which account or which werkgever; the invoice number says
  // which document. Measured on a pension invoice that asks for both in its own words and charges
  // interest on a payment it cannot place, dropping either half is what makes a debit
  // unallocatable — and on a bundle it means the supplier sees one payment and cannot tell which
  // of the invoices in it were settled.
  check("both identifiers travel, per invoice", r.reference === "KENMERK-77 / F-1001, F-1002");
  check("…and the invoice with only a number is unchanged", (r.reference ?? "").endsWith("F-1002"));
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

// ─── [CREDIT-VERREKEN] …and is now SETTLED by deducting it ───────────────────
//
// The refusal above was right about the arithmetic and wrong as an answer. A wholesaler who takes
// goods back sends a creditnota and expects it off the next payment: you transfer the difference
// and name both documents. Reported with the screen open on exactly that — an invoice of
// € 1.764,76 and a credit of € 52,38 from Enka Horeca, selected together, refused.
//
// So the credit joins the bundle and SUBTRACTS. What must never come back is the direction: the
// number below is 749,83, and both 853,43 (added) and 801,63 (ignored) are failures.

check("a creditnota SUBTRACTS from the transfer", (() => {
  const r = buildBundelBetaling([
    ...creditRows,
    inv({ id: "c", invoice_number: "CR9", total_inc_btw: -51.80, invoice_type: "creditnota" }),
  ]);
  return r.ok === true && Math.abs((r.amount ?? 0) - 749.83) < 0.005;
})());

check("…never added (the € 103,60 defect), never ignored", (() => {
  const r = buildBundelBetaling([
    ...creditRows,
    inv({ id: "c", invoice_number: "CR9", total_inc_btw: -51.80, invoice_type: "creditnota" }),
  ]);
  return (r.amount ?? 0) !== 853.43 && (r.amount ?? 0) !== 801.63;
})());

check("a negative total alone is enough — however the supplier typed it", (() => {
  const r = buildBundelBetaling([
    ...creditRows,
    inv({ id: "c", invoice_number: "51190", total_inc_btw: -51.80 }),
  ]);
  return r.ok === true && Math.abs((r.amount ?? 0) - 749.83) < 0.005;
})());

check("the kenmerk names the invoices AND the creditnota, after -/-", (() => {
  const r = buildBundelBetaling([
    ...creditRows,
    inv({ id: "c", invoice_number: "CR9", total_inc_btw: -51.80, invoice_type: "creditnota" }),
  ]);
  return r.reference === "RE1, RE2 -/- CR9";
})());

check("the credit line is signed, so the sheet can show it as a deduction", (() => {
  const r = buildBundelBetaling([
    ...creditRows,
    inv({ id: "c", invoice_number: "CR9", total_inc_btw: -51.80, invoice_type: "creditnota" }),
  ]);
  const credit = r.items?.find((it) => it.invoiceNumber === "CR9");
  return credit?.amount === -51.80 && r.items?.length === 3
    && r.debtTotal === 801.63 && r.creditTotal === 51.80;
})());

check("an ordinary bundle carries no netting fields at all", (() => {
  const r = buildBundelBetaling(creditRows);
  return r.ok === true && r.debtTotal === undefined && r.creditTotal === undefined;
})());

check("the reported case: 1.764,76 minus 52,38 is 1.712,38", (() => {
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "26709711", total_inc_btw: 1764.76 }),
    inv({ id: "b", invoice_number: "2671141810155", total_inc_btw: -52.38, invoice_type: "creditnota" }),
  ]);
  return r.ok === true
    && Math.abs((r.amount ?? 0) - 1712.38) < 0.005
    && r.reference === "26709711 -/- 2671141810155"
    && !!r.epcPayload && r.epcPayload.includes("EUR1712.38");
})());

check("a partially paid invoice nets against its OPEN rest, not its total", (() => {
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "RE1", total_inc_btw: 1000, amount_paid: 400 }),
    inv({ id: "b", invoice_number: "RE2", total_inc_btw: 100 }),
    inv({ id: "c", invoice_number: "CR9", total_inc_btw: -50, invoice_type: "creditnota" }),
  ]);
  return r.ok === true && Math.abs((r.amount ?? 0) - 650) < 0.005;
})());

// ─── The four rules that keep the deduction safe ─────────────────────────────

check("a creditnota alone is refused — there is nothing to transfer", (() => {
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "CR8", total_inc_btw: -10, invoice_type: "creditnota" }),
    inv({ id: "b", invoice_number: "CR9", total_inc_btw: -20, invoice_type: "creditnota" }),
  ]);
  return r.ok === false && /kies er een factuur/i.test(r.error ?? "");
})());

check("credits worth more than the invoices are refused, with both totals named", (() => {
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "RE1", total_inc_btw: 100 }),
    inv({ id: "b", invoice_number: "CR9", total_inc_btw: -150, invoice_type: "creditnota" }),
  ]);
  return r.ok === false
    && /150,00/.test(r.error ?? "")
    && /100,00/.test(r.error ?? "")
    && /terug/.test(r.error ?? "");
})());

check("exactly equal is refused too — a transfer of € 0,00 is not a payment", (() => {
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "RE1", total_inc_btw: 100 }),
    inv({ id: "b", invoice_number: "CR9", total_inc_btw: -100, invoice_type: "creditnota" }),
  ]);
  return r.ok === false;
})());

check("a creditnota from ANOTHER supplier's IBAN is refused", (() => {
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "RE1", total_inc_btw: 100 }),
    inv({ id: "b", invoice_number: "RE2", total_inc_btw: 100 }),
    inv({ id: "c", invoice_number: "CR9", total_inc_btw: -50, invoice_type: "creditnota", vendor_iban: IBAN_B }),
  ]);
  return r.ok === false && /andere leverancier/i.test(r.error ?? "");
})());

check("a creditnota with NO iban is allowed when the name matches — spelled either way", (() => {
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "RE1", total_inc_btw: 100, client_name: "Enka Horeca B.V.", vendor_iban: IBAN_A }),
    inv({ id: "b", invoice_number: "RE2", total_inc_btw: 100, client_name: "Enka Horeca B.V.", vendor_iban: IBAN_A }),
    inv({ id: "c", invoice_number: "CR9", total_inc_btw: -50, invoice_type: "creditnota", vendor_iban: null, client_name: "ENKA HORECA BV" }),
  ]);
  return r.ok === true && Math.abs((r.amount ?? 0) - 150) < 0.005;
})());

check("…and refused when the name does not", (() => {
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "RE1", total_inc_btw: 100, client_name: "Enka Horeca B.V." }),
    inv({ id: "b", invoice_number: "RE2", total_inc_btw: 100, client_name: "Enka Horeca B.V." }),
    inv({ id: "c", invoice_number: "CR9", total_inc_btw: -50, invoice_type: "creditnota", vendor_iban: null, client_name: "Sligro Food Group" }),
  ]);
  return r.ok === false && /geen IBAN/.test(r.error ?? "") && /te weinig/.test(r.error ?? "");
})());

check("a row typed creditnota with POSITIVE money is refused — the app contradicting itself", (() => {
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "RE1", total_inc_btw: 100 }),
    inv({ id: "b", invoice_number: "CR9", total_inc_btw: 50, invoice_type: "creditnota" }),
  ]);
  return r.ok === false && /positief/.test(r.error ?? "");
})());

check("a SUSPECTED credit note is refused until it is confirmed", (() => {
  // Its number carries a credit prefix and the same supplier uses another prefix for invoices —
  // creditnota-signal's two requirements. Netting on that guess would pay too little; paying it in
  // full is what happens today. Neither is something to do silently, so it is refused by name.
  const r = buildBundelBetaling(
    [
      inv({ id: "a", invoice_number: "RE1", total_inc_btw: 100 }),
      inv({ id: "b", invoice_number: "CN2401", total_inc_btw: 50 }),
    ],
    ["RE1", "RE2", "CN2401"],
  );
  return r.ok === false && /bevestig/i.test(r.error ?? "");
})());

check("…and without the supplier's other numbers that check cannot fire", (() => {
  // Stated rather than left to be discovered: one prefix on its own is not evidence, so a caller
  // that passes no history gets the behaviour this module had before the parameter existed.
  const r = buildBundelBetaling([
    inv({ id: "a", invoice_number: "RE1", total_inc_btw: 100 }),
    inv({ id: "b", invoice_number: "CN2401", total_inc_btw: 50 }),
  ]);
  return r.ok === true;
})());

check("the 140-char kenmerk limit counts the creditnota's too", (() => {
  const many = Array.from({ length: 12 }, (_, i) =>
    inv({ id: `d${i}`, invoice_number: `FACTUURNUMMER-2026-${String(i).padStart(4, "0")}`, total_inc_btw: 100 }));
  const r = buildBundelBetaling([...many, inv({ id: "c", invoice_number: "CREDITNOTA-2026-0001", total_inc_btw: -50, invoice_type: "creditnota" })]);
  return r.ok === false && /tekens/.test(r.error ?? "");
})());

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
