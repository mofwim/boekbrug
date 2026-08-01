// [GOCARDLESS] Pure node test — run: npx tsx --test src/lib/gocardless-map.test.ts
//
// The load-bearing test in this file is the LAST one: the same transaction, delivered once as a
// CAMT.053 file the owner uploaded and once as the JSON his bank fed us, must produce the SAME
// contentKey. If it does not, the transaction is stored twice and every figure built on it —
// omzet, kosten, de btw-aangifte — doubles. The rest of the file pins the branches that key
// depends on: which party is the counterpart, where the reference comes from, and which lines
// are dropped rather than imported with a wrong figure.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collectRemittance,
  mapGoCardlessTransaction,
  mapGoCardlessTransactions,
  parseSignedAmount,
  pickTransactionDate,
} from "./gocardless-map";
import type { GoCardlessRawTransaction } from "./gocardless-client";
import { contentKey } from "./bank-import";
import { parseCAMT053 } from "./bank-parser";

// ─── amount ───────────────────────────────────────────────────────────────────────────────────

test("amount keeps the sign the bank sent — no CdtDbtInd to apply", () => {
  assert.equal(parseSignedAmount({ transactionAmount: { amount: "-15.00" } }), -15);
  assert.equal(parseSignedAmount({ transactionAmount: { amount: "45.00" } }), 45);
  // Some banks send a number rather than the documented string.
  assert.equal(parseSignedAmount({ transactionAmount: { amount: -7.5 } }), -7.5);
});

test("an unreadable amount is null, never NaN", () => {
  // NaN in bank_transactions.amount poisons every sum downstream, so these must not map.
  assert.equal(parseSignedAmount({ transactionAmount: { amount: "abc" } }), null);
  assert.equal(parseSignedAmount({ transactionAmount: { amount: "1e999" } }), null);
  assert.equal(parseSignedAmount({ transactionAmount: {} }), null);
  assert.equal(parseSignedAmount({}), null);
});

test("a transaction without a usable amount is dropped with a warning, not imported as zero", () => {
  const { transactions, warnings } = mapGoCardlessTransactions([
    { bookingDate: "2026-03-02", transactionAmount: { amount: "abc" }, remittanceInformationUnstructured: "Factuur 12345" },
  ]);
  assert.equal(transactions.length, 0);
  assert.equal(warnings.length, 1);
  // The warning has to name the line well enough that the owner can find it at his bank.
  assert.match(warnings[0], /2026-03-02/);
  assert.match(warnings[0], /Factuur 12345/);
});

// ─── date ─────────────────────────────────────────────────────────────────────────────────────

test("valueDate wins over bookingDate — the same order MT940/CAMT use", () => {
  // Choosing bookingDate here would shift weekend bookings by a day or two against the same
  // transaction in an uploaded file, and the dedup fingerprint would miss.
  assert.equal(
    pickTransactionDate({ bookingDate: "2026-03-02", valueDate: "2026-02-28" }),
    "2026-02-28",
  );
});

test("a datetime is truncated to its date, and an impossible date is refused", () => {
  assert.equal(pickTransactionDate({ valueDateTime: "2026-02-28T14:03:11Z" }), "2026-02-28");
  // A malformed date reaching a Postgres `date` column fails the whole batch INSERT.
  assert.equal(pickTransactionDate({ valueDate: "9999-99-99", bookingDate: "2026-13-40" }), null);
  assert.equal(pickTransactionDate({}), null);
});

// ─── remittance ───────────────────────────────────────────────────────────────────────────────

test("every remittance field is read, in order, without repeating itself", () => {
  // ISO 20022 caps one element at 140 chars, so banks split long text across the array. The
  // scalar is usually the first element repeated — it must de-duplicate away, not double.
  const remi = collectRemittance({
    remittanceInformationUnstructuredArray: ["Betaling factuur", "26302050"],
    remittanceInformationUnstructured: "Betaling factuur",
    remittanceInformationStructured: "KENMERK-9",
  });
  assert.equal(remi, "Betaling factuur 26302050 KENMERK-9");
});

test("a betaalverzoek that carries its kenmerk ONLY as structured info still gets a reference", () => {
  const tx = mapGoCardlessTransaction({
    valueDate: "2026-03-02",
    transactionAmount: { amount: "121.00", currency: "EUR" },
    debtorName: "Jansen Bouw B.V.",
    remittanceInformationStructured: "26302050",
  });
  assert.equal(tx?.reference, "26302050");
});

// ─── counterpart ──────────────────────────────────────────────────────────────────────────────

test("money in names the debtor, money out names the creditor", () => {
  const incoming = mapGoCardlessTransaction({
    valueDate: "2026-03-02",
    transactionAmount: { amount: "45.00" },
    debtorName: "Mon Mothma",
    debtorAccount: { iban: "NL02ABNA0123456789" },
    creditorName: "Wij Zelf",
    remittanceInformationUnstructured: "Factuur 26302050",
  });
  assert.equal(incoming?.counterpartName, "Mon Mothma");
  assert.equal(incoming?.counterpartIban, "NL02ABNA0123456789");

  const outgoing = mapGoCardlessTransaction({
    valueDate: "2026-03-02",
    transactionAmount: { amount: "-45.00" },
    debtorName: "Wij Zelf",
    creditorName: "Alderaan Coffee",
    creditorAccount: { iban: "NL91RABO0315273637" },
    remittanceInformationUnstructured: "Factuur 26302050",
  });
  assert.equal(outgoing?.counterpartName, "Alderaan Coffee");
  assert.equal(outgoing?.counterpartIban, "NL91RABO0315273637");
});

test("a card payment with no party at all still gets a readable store name and no fake reference", () => {
  // The documented GoCardless example has exactly this shape: a debit with remittance text and
  // no creditorName. Without the fallback the owner sees a blank counterpart on every card line.
  const tx = mapGoCardlessTransaction({
    valueDate: "2026-03-02",
    transactionAmount: { amount: "-24.31" },
    remittanceInformationUnstructured:
      "CCV*ASM Supermarkt TILBURG NLD 29-05 TERMINALID 1234 PASVOLGNR 003",
  });
  assert.equal(tx?.counterpartName, "ASM Supermarkt");
  // A terminal sequence number is not an invoice number and must never become one.
  assert.equal(tx?.reference, null);
});

test("a bank charge with no party is labelled from its own description", () => {
  const tx = mapGoCardlessTransaction({
    valueDate: "2026-03-31",
    transactionAmount: { amount: "-11.45" },
    remittanceInformationUnstructured: "Kosten Zakelijk Betalingsverkeer  Periode 01-03-2026 / 31-03-2026",
  });
  assert.equal(tx?.counterpartName, "Kosten Zakelijk Betalingsverkeer");
});

// ─── reference ────────────────────────────────────────────────────────────────────────────────

test("endToEndId is a fallback for a real transfer, never for a POS batch", () => {
  const transfer = mapGoCardlessTransaction({
    valueDate: "2026-03-02",
    transactionAmount: { amount: "500.00" },
    debtorName: "Klant BV",
    endToEndId: "MIJN-KENMERK-1",
    remittanceInformationUnstructured: "",
  });
  assert.equal(transfer?.reference, "MIJN-KENMERK-1");

  // On a POS settlement endToEndId holds the batch id. Booking that as an invoice number would
  // match the payment to the wrong invoice.
  const pos = mapGoCardlessTransaction({
    valueDate: "2026-03-02",
    transactionAmount: { amount: "812.45" },
    endToEndId: "BATCH-99887766",
    remittanceInformationUnstructured: "AFREK. BETAALAUTOMAAT 02-03-2026",
  });
  assert.equal(pos?.reference, null);
});

test("NOTPROVIDED is not a reference", () => {
  const tx = mapGoCardlessTransaction({
    valueDate: "2026-03-02",
    transactionAmount: { amount: "500.00" },
    debtorName: "Klant BV",
    endToEndId: "NOTPROVIDED",
    remittanceInformationUnstructured: "",
  });
  assert.equal(tx?.reference, null);
});

test("a SEPA incasso yields only the invoice number, not the batch and order ids", () => {
  // The ONS IT Incasso case from [BANK-REF-ONE-SOURCE]: three numbers instead of one both
  // breaks the dedup key and silently stops the line from auto-booking.
  const tx = mapGoCardlessTransaction({
    valueDate: "2026-06-02",
    transactionAmount: { amount: "-302.50" },
    creditorName: "ONS IT",
    remittanceInformationUnstructured:
      "/IncassobatchId/26-06-0001/OpdrachtId/994872215/Betaling fact. 1260405",
  });
  assert.equal(tx?.reference, "1260405");
});

// ─── the property this file exists for ────────────────────────────────────────────────────────

test("the SAME transaction from an uploaded CAMT file and from the bank feed dedups", () => {
  // One transaction, two doors. If the fingerprints differ, it is stored twice and the owner's
  // omzet doubles — so this asserts on contentKey itself, the exact value dedupTransactions uses.
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

  const fromApi = mapGoCardlessTransaction({
    transactionId: "GC-8f21a0",              // the bank feed's own id — different, and excluded
    bookingDate: "2026-03-03",
    valueDate: "2026-03-02",
    transactionAmount: { amount: "1210.00", currency: "EUR" },
    debtorName: "Jansen Bouw B.V.",
    debtorAccount: { iban: "NL91RABO0315273637" },
    endToEndId: "NOTPROVIDED",
    remittanceInformationUnstructured: "Betaling factuur 26302050",
  });
  assert.ok(fromApi, "the API twin must map");

  const keyOf = (t: { date: string; amount: number; counterpartName: string | null; reference: string | null }) =>
    contentKey(t.date, t.amount, t.counterpartName, t.reference);

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

  const fromApi = mapGoCardlessTransaction({
    valueDate: "2026-03-02",
    transactionAmount: { amount: "-24.31", currency: "EUR" },
    remittanceInformationUnstructured:
      "CCV*ASM Supermarkt TILBURG NLD 29-05 TERMINALID 1234 PASVOLGNR 003",
  });
  assert.ok(fromApi);

  assert.equal(
    contentKey(fromApi.date, fromApi.amount, fromApi.counterpartName, fromApi.reference),
    contentKey(fromFile[0].date, fromFile[0].amount, fromFile[0].counterpartName, fromFile[0].reference),
  );
});

// ─── list mapping ─────────────────────────────────────────────────────────────────────────────

test("mapping a list keeps order and reports every line it could not read", () => {
  const raw: GoCardlessRawTransaction[] = [
    { valueDate: "2026-03-01", transactionAmount: { amount: "10.00" }, debtorName: "A" },
    { valueDate: "not-a-date", transactionAmount: { amount: "20.00" }, debtorName: "B" },
    { valueDate: "2026-03-03", transactionAmount: { amount: "30.00" }, debtorName: "C" },
  ];
  const { transactions, warnings } = mapGoCardlessTransactions(raw);
  assert.deepEqual(transactions.map((t) => t.amount), [10, 30]);
  assert.equal(warnings.length, 1);
});
