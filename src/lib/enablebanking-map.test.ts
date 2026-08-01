// [ENABLEBANKING] Pure node test — run: npx tsx --test src/lib/enablebanking-map.test.ts
//
// Two properties carry this file.
//
// The FIRST is the sign. Enable Banking sends an unsigned magnitude plus credit_debit_indicator,
// where GoCardless sends an already-signed amount. Get it backwards and every expense imports as
// income — kosten become omzet and the btw-aangifte inverts, on every line, silently. The rows
// below marked "vendor sample" are copied verbatim from Enable Banking's own sample export, so
// this is pinned against their data and not against our reading of it.
//
// The SECOND is the one gocardless-map.test.ts also exists for: the same transaction, delivered
// once as a CAMT.053 file the owner uploaded and once over the bank feed, must produce the SAME
// contentKey. If it does not, it is stored twice and every figure built on it doubles.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collectRemittance,
  counterpartIbanOf,
  isBooked,
  mapEnableBankingTransaction,
  mapEnableBankingTransactions,
  parseSignedAmount,
  pickTransactionDate,
  readSignedAmount,
} from "./enablebanking-map";
import type { EnableBankingRawTransaction } from "./enablebanking-map";
import { contentKey } from "./bank-import";
import { parseCAMT053 } from "./bank-parser";
import type { BankTransaction } from "./bank-parser";

const keyOf = (t: Pick<BankTransaction, "date" | "amount" | "counterpartName" | "reference">) =>
  contentKey(t.date, t.amount, t.counterpartName, t.reference);

// ─── the sign ─────────────────────────────────────────────────────────────────────────────────

test("DBIT is money out and CRDT is money in — the amount itself carries no sign", () => {
  // Vendor sample, verbatim: a card payment of 88,00 DKK. The amount string is "88.0"; only
  // credit_debit_indicator says it left the account. Reading it as GoCardless does (+88) would
  // file this expense as revenue.
  const spent = mapEnableBankingTransaction({
    entry_reference: "2581644165",
    merchant_category_code: "5131",
    transaction_amount: { currency: "DKK", amount: "88.0" },
    creditor: { name: "Krestoffer )))) 59476" },
    debtor_account: { iban: null, other: { identification: "2345533245", scheme_name: "CPAN" } },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2020-09-14",
    value_date: "2020-09-14",
    remittance_information: ["Krestoffer )))) 59476"],
  });
  assert.equal(spent?.amount, -88);

  // Vendor sample, verbatim: salary in.
  const received = mapEnableBankingTransaction({
    entry_reference: "D126890141",
    transaction_amount: { currency: "DKK", amount: "18350.0" },
    debtor: { name: "AXB LTD A/S" },
    credit_debit_indicator: "CRDT",
    status: "BOOK",
    booking_date: "2020-09-28",
    value_date: "2020-09-28",
    remittance_information: ["Løn September\nWe have received the following payment from:\nAXB LTD A/S"],
  });
  assert.equal(received?.amount, 18350);
});

test("an indicator beats a sign the bank also sent — the two can never disagree", () => {
  // If a bank ever signs its amounts AND sets the indicator, the indicator wins, so -15 + DBIT
  // stays -15 rather than becoming +15 by double negation.
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "-15.00" }, credit_debit_indicator: "DBIT" }), -15);
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "15.00" }, credit_debit_indicator: "DBIT" }), -15);
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "15.00" }, credit_debit_indicator: "crdt" }), 15);
});

test("an unsigned amount with no direction is refused, not guessed as income", () => {
  // The CAMT parser may default a missing <CdtDbtInd> to CRDT because the schema makes the element
  // mandatory. Here there is no such guarantee, and guessing "credit" turns expenses into revenue.
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "88.0" } }), null);
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "88.0" }, credit_debit_indicator: "XXXX" }), null);
  // A value that carries its own minus sign is still unambiguous — do not throw money away.
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "-88.0" } }), -88);
});

test("the direction that sets the sign is the one that picks the counterpart", () => {
  const out = readSignedAmount({ transaction_amount: { amount: "88.0" }, credit_debit_indicator: "DBIT" });
  assert.deepEqual(out, { amount: -88, isCredit: false });
  const zero = readSignedAmount({ transaction_amount: { amount: "0" }, credit_debit_indicator: "DBIT" });
  // -0 would round-trip through JSON as "-0"; zero has no direction in the books.
  assert.equal(Object.is(zero?.amount, 0), true);
  assert.equal(zero?.isCredit, false);
});

test("an unreadable amount is null, never NaN and never a fabricated zero", () => {
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "abc" }, credit_debit_indicator: "DBIT" }), null);
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "1e999" }, credit_debit_indicator: "DBIT" }), null);
  // Number("") is 0 — a blank amount must warn, not book 0,00.
  assert.equal(parseSignedAmount({ transaction_amount: { amount: "   " }, credit_debit_indicator: "DBIT" }), null);
  assert.equal(parseSignedAmount({ transaction_amount: {} }), null);
  assert.equal(parseSignedAmount({}), null);
});

test("a dropped line says WHICH of the two things was missing", () => {
  const { transactions, warnings } = mapEnableBankingTransactions([
    {
      booking_date: "2026-03-02",
      transaction_amount: { amount: "88.00" },
      remittance_information: ["Factuur 12345"],
    },
  ]);
  assert.equal(transactions.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2026-03-02/);
  assert.match(warnings[0], /Factuur 12345/);
  // The amount was perfectly readable — saying "bedrag ongeldig" would send the owner looking in
  // the wrong place, and hide that it is his bank that is sending an incomplete record.
  assert.match(warnings[0], /bij- of afschrijving/);
});

// ─── booked only ──────────────────────────────────────────────────────────────────────────────

test("pending entries are passed over and counted, not imported and not warned about", () => {
  // A pending line may still change amount or vanish, and its booked twin days later would dedup
  // against nothing — so importing it means the owner ends up with both.
  const { transactions, warnings, skipped } = mapEnableBankingTransactions([
    { value_date: "2026-03-01", transaction_amount: { amount: "10.00" }, credit_debit_indicator: "CRDT", status: "BOOK" },
    { value_date: "2026-03-02", transaction_amount: { amount: "20.00" }, credit_debit_indicator: "CRDT", status: "PDNG" },
  ]);
  assert.deepEqual(transactions.map((t) => t.amount), [10]);
  assert.equal(skipped, 1);
  assert.equal(warnings.length, 0, "a pending line is not lost money");
  // An absent status is the kind we asked the API for.
  assert.equal(isBooked({}), true);
  assert.equal(isBooked({ status: "book" }), true);
});

// ─── date ─────────────────────────────────────────────────────────────────────────────────────

test("value_date wins over booking_date — the same order MT940/CAMT use", () => {
  // Choosing booking_date here would shift weekend bookings by a day or two against the same
  // transaction in an uploaded file, and the dedup fingerprint would miss.
  assert.equal(pickTransactionDate({ booking_date: "2026-03-02", value_date: "2026-02-28" }), "2026-02-28");
  assert.equal(pickTransactionDate({ transaction_date: "2026-02-28T14:03:11Z" }), "2026-02-28");
  // A malformed date reaching a Postgres `date` column fails the whole batch INSERT.
  assert.equal(pickTransactionDate({ value_date: "9999-99-99", booking_date: "2026-13-40" }), null);
  assert.equal(pickTransactionDate({}), null);
});

// ─── remittance ───────────────────────────────────────────────────────────────────────────────

test("a multi-line remittance reads exactly like the file door's joined <Ustrd> elements", () => {
  // Vendor sample, verbatim: what a CAMT file splits across elements arrives here as one string
  // with newlines. 80 of its 611 lines look like this.
  assert.equal(
    collectRemittance({
      remittance_information: ["Til Mad\nWe have transferred the amount to:\n4092 3342223455"],
    }),
    "Til Mad We have transferred the amount to: 4092 3342223455",
  );
});

test("runs of spaces survive — the fee label and the store name are cut on them", () => {
  // Banks pad statement text into columns. Collapsing those runs would make this door read a
  // different counterpart name from the uploaded file, which is a different fingerprint.
  assert.equal(
    collectRemittance({ remittance_information: ["otay-shop.dk       15423"] }),
    "otay-shop.dk       15423",
  );
});

test("the structured reference is read too, and repeated text does not double", () => {
  assert.equal(
    collectRemittance({
      remittance_information: ["Betaling factuur", "26302050", "Betaling factuur"],
      reference_number: "KENMERK-9",
    }),
    "Betaling factuur 26302050 KENMERK-9",
  );
});

test("a betaalverzoek that carries its kenmerk ONLY as reference_number still gets a reference", () => {
  const tx = mapEnableBankingTransaction({
    value_date: "2026-03-02",
    transaction_amount: { amount: "121.00", currency: "EUR" },
    credit_debit_indicator: "CRDT",
    debtor: { name: "Jansen Bouw B.V." },
    reference_number: "26302050",
  });
  assert.equal(tx?.reference, "26302050");
});

// ─── counterpart ──────────────────────────────────────────────────────────────────────────────

test("money in names the debtor, money out names the creditor", () => {
  const incoming = mapEnableBankingTransaction({
    value_date: "2026-03-02",
    transaction_amount: { amount: "45.00" },
    credit_debit_indicator: "CRDT",
    debtor: { name: "Mon Mothma" },
    debtor_account: { iban: "NL02ABNA0123456789" },
    creditor: { name: "Wij Zelf" },
    remittance_information: ["Factuur 26302050"],
  });
  assert.equal(incoming?.counterpartName, "Mon Mothma");
  assert.equal(incoming?.counterpartIban, "NL02ABNA0123456789");

  const outgoing = mapEnableBankingTransaction({
    value_date: "2026-03-02",
    transaction_amount: { amount: "45.00" },
    credit_debit_indicator: "DBIT",
    debtor: { name: "Wij Zelf" },
    creditor: { name: "Alderaan Coffee" },
    creditor_account: { iban: "NL91RABO0315273637" },
    remittance_information: ["Factuur 26302050"],
  });
  assert.equal(outgoing?.counterpartName, "Alderaan Coffee");
  assert.equal(outgoing?.counterpartIban, "NL91RABO0315273637");
});

test("a card refund keeps the CAMT rule even though the bank fills the other party", () => {
  // Vendor sample, verbatim: 13 of its rows are refunds — CRDT, yet still naming the shop as
  // `creditor`. Reading that field would give a name the uploaded file cannot give (the CAMT
  // parser looks at <Dbtr> here too), and a name that differs by door is a double import.
  const refund = mapEnableBankingTransaction({
    entry_reference: "0000005026",
    merchant_category_code: "4899",
    transaction_amount: { currency: "DKK", amount: "78.0" },
    creditor: { name: "Disney Plus" },
    debtor_account: { iban: null, other: { identification: "233111XXXXXX4455", scheme_name: "CPAN" } },
    credit_debit_indicator: "CRDT",
    status: "BOOK",
    value_date: "2021-07-14",
    booking_date: "2021-07-14",
    remittance_information: ["Disney Plus"],
  });
  assert.equal(refund?.amount, 78);
  // Both doors fall through to the description and agree on it.
  assert.equal(refund?.counterpartName, "Disney Plus");
});

test("a card number is never stored as an IBAN", () => {
  // Vendor sample: every transaction-level account id is a card PAN or a domestic number — 364 of
  // them, zero IBANs. Writing one into counterpart_iban puts a PAN where nobody expects one and
  // would match against the owner's own accounts as if it were one.
  assert.equal(counterpartIbanOf({ iban: null, other: { identification: "233111XXXXXX4455", scheme_name: "CPAN" } }), null);
  assert.equal(counterpartIbanOf({ iban: null, other: { identification: "12517826136334", scheme_name: "BBAN" } }), null);
  assert.equal(counterpartIbanOf({ iban: null, other: { identification: "3342223455", scheme_name: "OTHI" } }), null);
  // Unless the scheme itself says it is one.
  assert.equal(counterpartIbanOf({ iban: null, other: { identification: "NL91RABO0315273637", scheme_name: "IBAN" } }), "NL91RABO0315273637");
  assert.equal(counterpartIbanOf({ iban: "NL91RABO0315273637" }), "NL91RABO0315273637");
  assert.equal(counterpartIbanOf(null), null);
});

test("a card payment with no party at all still gets a readable store name and no fake reference", () => {
  const tx = mapEnableBankingTransaction({
    value_date: "2026-03-02",
    transaction_amount: { amount: "24.31" },
    credit_debit_indicator: "DBIT",
    remittance_information: ["CCV*ASM Supermarkt TILBURG NLD 29-05 TERMINALID 1234 PASVOLGNR 003"],
  });
  assert.equal(tx?.counterpartName, "ASM Supermarkt");
  // A terminal sequence number is not an invoice number and must never become one.
  assert.equal(tx?.reference, null);
});

test("a bank charge with no party is labelled from its own description", () => {
  const tx = mapEnableBankingTransaction({
    value_date: "2026-03-31",
    transaction_amount: { amount: "11.45" },
    credit_debit_indicator: "DBIT",
    remittance_information: ["Kosten Zakelijk Betalingsverkeer  Factuurnr. 9912"],
  });
  assert.equal(tx?.counterpartName, "Kosten Zakelijk Betalingsverkeer");
});

// ─── reference ────────────────────────────────────────────────────────────────────────────────

test("a SEPA incasso yields only the invoice number, not the batch and order ids", () => {
  // The ONS IT Incasso case from [BANK-REF-ONE-SOURCE]: three numbers instead of one both breaks
  // the dedup key and silently stops the line from auto-booking.
  const tx = mapEnableBankingTransaction({
    value_date: "2026-06-02",
    transaction_amount: { amount: "302.50" },
    credit_debit_indicator: "DBIT",
    creditor: { name: "ONS IT" },
    remittance_information: ["/IncassobatchId/26-06-0001/OpdrachtId/994872215/Betaling fact. 1260405"],
  });
  assert.equal(tx?.reference, "1260405");
});

test("entry_reference is stored for debugging but is not an identity", () => {
  // Vendor sample: 611 transactions under 481 distinct entry_reference values. "3845245274" alone
  // covers 44 unrelated MobilePay lines — keying on it would collapse real transactions together.
  const a = mapEnableBankingTransaction({
    entry_reference: "3845245274",
    value_date: "2020-09-24",
    transaction_amount: { amount: "200.0", currency: "DKK" },
    credit_debit_indicator: "CRDT",
    remittance_information: ["MobilePay: Emma Nielsen"],
  });
  const b = mapEnableBankingTransaction({
    entry_reference: "3845245274",
    value_date: "2020-09-25",
    transaction_amount: { amount: "24.0", currency: "DKK" },
    credit_debit_indicator: "CRDT",
    remittance_information: ["MobilePay: Christina Nielsen"],
  });
  assert.equal(a?.transactionId, b?.transactionId);
  assert.notEqual(keyOf(a!), keyOf(b!), "two different transactions must keep two fingerprints");
});

// ─── the property this file exists for ────────────────────────────────────────────────────────

test("the SAME transaction from an uploaded CAMT file and from the bank feed dedups", () => {
  const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document><BkToCstmrStmt><Stmt>
  <Acct><Id><IBAN>NL02ABNA0123456789</IBAN></Id></Acct>
  <Ntry>
    <Amt Ccy="EUR">1210.00</Amt>
    <CdtDbtInd>CRDT</CdtDbtInd>
    <BookgDt><Dt>2026-03-03</Dt></BookgDt>
    <ValDt><Dt>2026-03-02</Dt></ValDt>
    <NtryRef>2026030200123</NtryRef>
    <NtryDtls><TxDtls>
      <Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
      <RltdPties>
        <Dbtr><Nm>Jansen Bouw B.V.</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>NL91RABO0315273637</IBAN></Id></DbtrAcct>
      </RltdPties>
      <RmtInf><Ustrd>Betaling factuur 26302050</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
  </Ntry>
</Stmt></BkToCstmrStmt></Document>`;

  const fromFile = parseCAMT053(camt).transactions;
  assert.equal(fromFile.length, 1, "the CAMT fixture must parse to exactly one transaction");

  const fromApi = mapEnableBankingTransaction({
    entry_reference: "2026030200123",
    booking_date: "2026-03-03",
    value_date: "2026-03-02",
    transaction_amount: { amount: "1210.00", currency: "EUR" },
    credit_debit_indicator: "CRDT",
    status: "BOOK",
    debtor: { name: "Jansen Bouw B.V." },
    debtor_account: { iban: "NL91RABO0315273637" },
    remittance_information: ["Betaling factuur 26302050"],
  });
  assert.ok(fromApi, "the API twin must map");

  assert.equal(
    keyOf(fromApi),
    keyOf(fromFile[0]),
    "same transaction, two doors, one fingerprint — otherwise it imports twice",
  );

  // And the fields the owner reads must agree too, not just the hash.
  assert.equal(fromApi.date, fromFile[0].date);
  assert.equal(fromApi.amount, fromFile[0].amount);
  assert.equal(fromApi.counterpartName, fromFile[0].counterpartName);
  assert.equal(fromApi.reference, fromFile[0].reference);
  assert.equal(fromApi.counterpartIban, fromFile[0].counterpartIban);
});

test("a card line from both doors dedups too — the branch with no party at all", () => {
  const camt = `<Document><Ntry>
    <Amt Ccy="EUR">24.31</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <ValDt><Dt>2026-03-02</Dt></ValDt>
    <NtryDtls><TxDtls><RmtInf>
      <Ustrd>CCV*ASM Supermarkt TILBURG NLD 29-05 TERMINALID 1234 PASVOLGNR 003</Ustrd>
    </RmtInf></TxDtls></NtryDtls>
  </Ntry></Document>`;

  const fromFile = parseCAMT053(camt).transactions;
  assert.equal(fromFile.length, 1);
  assert.equal(fromFile[0].amount, -24.31, "the file door signs this with <CdtDbtInd>");

  const fromApi = mapEnableBankingTransaction({
    value_date: "2026-03-02",
    transaction_amount: { amount: "24.31", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    remittance_information: ["CCV*ASM Supermarkt TILBURG NLD 29-05 TERMINALID 1234 PASVOLGNR 003"],
  });
  assert.ok(fromApi);

  assert.equal(keyOf(fromApi), keyOf(fromFile[0]));
});

test("a fee line split only by column padding dedups too", () => {
  // The [BANK-PARSE-FEE] label is cut on a run of spaces. If this door collapsed that run, the
  // counterpart would be the whole sentence here and the fingerprint would not match the file.
  const camt = `<Document><Ntry>
    <Amt Ccy="EUR">11.45</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <ValDt><Dt>2026-03-31</Dt></ValDt>
    <NtryDtls><TxDtls><RmtInf>
      <Ustrd>Kosten Zakelijk Betalingsverkeer   01-03-2026 / 31-03-2026</Ustrd>
    </RmtInf></TxDtls></NtryDtls>
  </Ntry></Document>`;

  const fromFile = parseCAMT053(camt).transactions;
  assert.equal(fromFile.length, 1);
  assert.equal(fromFile[0].counterpartName, "Kosten Zakelijk Betalingsverkeer");

  const fromApi = mapEnableBankingTransaction({
    value_date: "2026-03-31",
    transaction_amount: { amount: "11.45", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    remittance_information: ["Kosten Zakelijk Betalingsverkeer   01-03-2026 / 31-03-2026"],
  });
  assert.ok(fromApi);
  assert.equal(keyOf(fromApi), keyOf(fromFile[0]));
});

// ─── list mapping ─────────────────────────────────────────────────────────────────────────────

test("mapping a list keeps order and reports every line it could not read", () => {
  const raw: EnableBankingRawTransaction[] = [
    { value_date: "2026-03-01", transaction_amount: { amount: "10.00" }, credit_debit_indicator: "CRDT", debtor: { name: "A" } },
    { value_date: "not-a-date", transaction_amount: { amount: "20.00" }, credit_debit_indicator: "CRDT", debtor: { name: "B" } },
    { value_date: "2026-03-03", transaction_amount: { amount: "30.00" }, credit_debit_indicator: "DBIT", creditor: { name: "C" } },
  ];
  const { transactions, warnings, skipped } = mapEnableBankingTransactions(raw);
  assert.deepEqual(transactions.map((t) => t.amount), [10, -30]);
  assert.equal(warnings.length, 1);
  assert.equal(skipped, 0);
});
