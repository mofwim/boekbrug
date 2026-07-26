// [BUNDEL-BETAALVERZOEK] Round-trip test — run: npx tsx src/lib/bundel-reference-roundtrip.test.ts
//
// The app generates a bundled payment request whose EPC remittance lists every invoice number
// (buildBundelBetaalverzoek). The customer's bank copies that remittance into the statement, the
// importer extracts a reference from it (extractInvoiceReference), and the batch engine has to
// recover EVERY number again (parseReferenceNumbers -> planBatchAutoConfirm) or the payment the
// app asked for cannot be booked automatically.
//
// Four links, three modules, no shared test until now. This walks the whole chain with realistic
// Dutch bank remittances instead of hand-made references.

import { buildBundelBetaalverzoek, type BetaalverzoekInvoice } from "./betaalverzoek";
import { extractInvoiceReference } from "./bank-parser";
import { parseReferenceNumbers } from "./bank-matching";
import { planBatchAutoConfirm, type BatchCandidateInvoice } from "./bank-batch-reconcile";
import { buildBundelBetaling } from "./bundel-betaling";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const OWNER = { iban: "NL91ABNA0417164300", company_name: "Test BV", full_name: null };

function inv(number: string, total: number, paid = 0): BetaalverzoekInvoice {
  return {
    id: "id-" + number, direction: "outgoing", invoice_type: "factuur", status: "sent",
    invoice_number: number, payment_reference: null, total_inc_btw: total,
    client_name: "Klant BV", pay_token: null, due_date: null, amount_paid: paid,
  };
}
function cand(number: string, total: number, paid = 0): BatchCandidateInvoice {
  return {
    id: "id-" + number, invoice_number: number, total_inc_btw: total, amount_paid: paid,
    client_name: "Klant BV", direction: "outgoing", status: "sent",
  };
}

/** The full chain: what the app asks for -> what the bank writes -> what the app recovers. */
function roundTrip(numbers: string[], totals: number[], remitWrapper: (ref: string) => string) {
  const invoices = numbers.map((n, i) => inv(n, totals[i]));
  const built = buildBundelBetaalverzoek(invoices, OWNER);
  if (!built.ok) return { built, refs: [] as string[], plan: null };
  // The bank puts our remittance in the statement, possibly with its own wrapper text.
  const remi = remitWrapper(built.reference!);
  const extracted = extractInvoiceReference(remi, { isPos: false, isCard: false })
    // The importer falls back to the cleaned remittance when it recognises no number token.
    ?? remi;
  const refs = parseReferenceNumbers(extracted);
  const plan = planBatchAutoConfirm({
    reference: extracted,
    bankAmount: built.amount!, // a CREDIT: money in, settles outgoing invoices
    invoices: numbers.map((n, i) => cand(n, totals[i])),
  });
  return { built, refs, plan };
}

console.log("\n— default numbering ({year}{seq}, padding 4) —");
{
  // Exactly what the app mints today: 20260001, 20260002.
  const r = roundTrip(["20260001", "20260002"], [605, 495], (ref) => ref);
  check("the QR asks the summed amount", r.built.ok === true && r.built.amount === 1100);
  check("both numbers survive the round trip", r.refs.length === 2);
  check("the batch is auto-bookable", r.plan !== null && r.plan.invoiceIds.length === 2);
}
{
  // Banks routinely prepend their own words to the remittance.
  const r = roundTrip(["20260001", "20260002"], [605, 495],
    (ref) => `SEPA Overboeking Omschrijving: Betaling facturen ${ref}`);
  check("a bank prefix does not lose a number", r.refs.length === 2);
  check("still auto-bookable with a bank prefix", r.plan !== null);
}
{
  const r = roundTrip(["20260001", "20260002"], [605, 495],
    (ref) => `/TRTP/SEPA OVERBOEKING/IBAN/NL91ABNA0417164300/BIC/ABNANL2A/NAME/KLANT BV/REMI/${ref}`);
  check("an ABN-style structured remittance still resolves both", r.refs.length === 2);
  check("still auto-bookable from a structured remittance", r.plan !== null);
}
{
  // Three invoices, one already partly paid → the QR asks the OPEN sum.
  const invoices = [inv("20260001", 1000, 400), inv("20260002", 500), inv("20260003", 250)];
  const built = buildBundelBetaalverzoek(invoices, OWNER);
  const extracted = extractInvoiceReference(built.reference!, { isPos: false, isCard: false }) ?? built.reference!;
  const plan = planBatchAutoConfirm({
    reference: extracted,
    bankAmount: built.amount!,
    invoices: [cand("20260001", 1000, 400), cand("20260002", 500), cand("20260003", 250)],
  });
  check("three invoices, one partly paid → asks 1350", built.amount === 1350);
  check("all three numbers survive", parseReferenceNumbers(extracted).length === 3);
  check("the partly-paid bundle is auto-bookable", plan !== null && plan.invoiceIds.length === 3);
}

console.log("\n— [BUNDEL-REFERENCE-FITS] the app never mints an unreconcilable request —");
{
  // The EPC remittance (line 11) is capped at 140 chars and buildEpcQrPayload truncates
  // SILENTLY. A bundle whose numbers do not all fit would make the customer pay the full sum
  // while quoting only part of the list — the batch engine then sums the invoices it can see,
  // finds they do not equal the payment, and reports a mismatch nothing can resolve.
  const mk = (count: number) =>
    buildBundelBetaalverzoek(
      Array.from({ length: count }, (_, i) => inv(`2026${String(i + 1).padStart(4, "0")}`, 100)),
      OWNER,
    );

  const at14 = mk(14);
  check("14 eight-char numbers fit exactly (14x8 + 13x2 = 138)", at14.ok === true);
  check("...the whole reference fits the remittance", (at14.reference ?? "").length <= 140);
  check("...and every number is really in the QR", parseReferenceNumbers(at14.epcPayload!.split("\n")[10]).length === 14);
  check("...so the QR and the reference agree exactly",
    parseReferenceNumbers(at14.epcPayload!.split("\n")[10]).length === parseReferenceNumbers(at14.reference!).length);

  const at15 = mk(15);
  check("15 are refused instead of silently truncated", at15.ok === false);
  check("the refusal says how many DO fit", /maximaal 14/.test(at15.error ?? ""));
  check("the refusal explains the bank limit", /140 tekens/.test(at15.error ?? ""));

  const at20 = mk(20);
  check("the old 20-invoice bundle is now refused", at20.ok === false);

  // The limit is CHARACTERS, not invoices: long custom numbers hit it sooner.
  const long = buildBundelBetaalverzoek(
    Array.from({ length: 8 }, (_, i) => inv(`FACTUUR-2026-000${i + 1}-NL`, 100)),
    OWNER,
  );
  check("long invoice numbers hit the wall with far fewer invoices", long.ok === false);
}
{
  // The mirror rule on the supplier side (one transfer paying several purchase invoices).
  const supplier = (n: string) => ({
    id: "s" + n, status: "received", invoice_number: n, payment_reference: null,
    client_name: "Groothandel BV", vendor_iban: "NL91ABNA0417164300",
    total_inc_btw: 100, amount_paid: 0,
  });
  const many = buildBundelBetaling(Array.from({ length: 15 }, (_, i) => supplier(`2026${String(i + 1).padStart(4, "0")}`)));
  check("incoming bundle refuses an untruncatable reference too", many.ok === false);
  const few = buildBundelBetaling(Array.from({ length: 5 }, (_, i) => supplier(`2026${String(i + 1).padStart(4, "0")}`)));
  check("a normal incoming bundle is unaffected", few.ok === true);
  check("...and its reference fits", (few.reference ?? "").length <= 140);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
