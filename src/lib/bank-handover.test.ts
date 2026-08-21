// [AFLETTEREN] Run: npx tsx --test src/lib/bank-handover.test.ts
//
// This file is the one piece of the quarter package that hands over WORK rather than documents,
// so the ways it can be wrong are the expensive ones: a reconciliation that overstates what is
// finished, or one that hides a difference between what the bank moved and what the invoice says.
// Either turns a head start into something the accountant has to redo from scratch — which is
// worse than never receiving it, because he has to find out first.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bankHandoverTotals,
  buildBankHandoverCsv,
  type HandoverInvoice,
  type HandoverTx,
} from "./bank-handover";

const tx = (over: Partial<HandoverTx> = {}): HandoverTx => ({
  date: "2026-02-10", amount: -121, counterpart_name: "Sligro", description: "Factuur F-1",
  reference: "F-1", status: "matched", invoice_id: "inv-1", ...over,
});

const invoices = new Map<string, HandoverInvoice>([
  ["inv-1", { invoice_number: "F-1", client_name: "Sligro", total_inc_btw: 121, direction: "incoming" }],
  ["inv-2", { invoice_number: "20260002", client_name: "Klant B.V.", total_inc_btw: 500, direction: "outgoing" }],
  // [CREDIT-SIGN] A creditnota is STORED negative in this app. The refund that pays it moves real
  // money, and comparing a negative total against an absolute bank amount would report a
  // discrepancy of twice the invoice on every single one.
  ["inv-cr", { invoice_number: "CR-20260001", client_name: "Klant B.V.", total_inc_btw: -75, direction: "outgoing" }],
]);

const csv = (transactions: HandoverTx[], read = true) =>
  buildBankHandoverCsv({ quarterLabel: "Q1 2026", transactions, invoiceById: invoices, read });

/** Only the data rows. The summary block above them legitimately contains the same words. */
const rowsOf = (out: string) => {
  const at = out.indexOf("Status;Datum");
  return at === -1 ? "" : out.slice(at).split("\r\n").slice(1).join("\r\n");
};

// ─── What it must never overstate ────────────────────────────────────────────────────

test("[AFLETTEREN] a failed bank read produces a refusal, never an empty table", () => {
  // THE ONE THAT MATTERS MOST. An empty reconciliation reads as "every line is accounted for".
  // On a quarter we could not look at, that is the single lie this package must never tell.
  const out = csv([], false);
  assert.match(out, /niet omdat alles gekoppeld is/);
  assert.doesNotMatch(out, /Nog te koppelen;/, "there must be no table at all");
  assert.doesNotMatch(out, /Status;Datum/, "…not even a header row, which reads as a table with no findings");
});

test("[AFLETTEREN] the open lines are counted in euros as well as in rows", () => {
  // A professional cannot use "twelve lines matched" without knowing whether twelve was all of
  // them, and a count of rows says nothing about how much money is still unplaced.
  const out = csv([
    tx(),
    tx({ invoice_id: null, status: null, amount: -80, counterpart_name: "Onbekend" }),
    tx({ invoice_id: null, status: null, amount: 300, counterpart_name: "Klant" }),
  ]);
  assert.match(out, /Gekoppeld aan een factuur;1;/);
  assert.match(out, /Nog te koppelen;2;.*?380/, "80 + 300, absolute — direction does not cancel out");
});

test("[AFLETTEREN] the work that is LEFT stands above the work that is done", () => {
  const out = csv([tx({ date: "2026-01-05" }), tx({ invoice_id: null, status: null, date: "2026-03-30" })]);
  const body = rowsOf(out);
  assert.ok(
    body.indexOf("Nog te koppelen;2026-03-30") < body.indexOf("Gekoppeld;2026-01-05"),
    "an open line from March must still come before a matched one from January",
  );
});

// ─── The honesty column ──────────────────────────────────────────────────────────────

test("[AFLETTEREN] a matched line whose amount differs says so, with the difference", () => {
  // Not always an error — a partial payment looks exactly like this — but always something to
  // look at. Hiding it would make every "Gekoppeld" row worth re-checking, which is the whole
  // value of the file gone.
  const differs = rowsOf(csv([tx({ amount: -100 })])); // invoice says 121
  assert.match(differs, /Gekoppeld — bedrag wijkt af/);
  assert.match(differs, /21,00/, "the difference itself, not just a flag");

  const exact = rowsOf(csv([tx({ amount: -121 })]));
  assert.match(exact, /^"?Gekoppeld"?;/m);
  assert.doesNotMatch(exact, /wijkt af/, "an exact match must not be flagged — a flag on everything is no flag");
});

test("[AFLETTEREN] the sign of the bank line never invents a difference", () => {
  // A purchase is paid with a NEGATIVE bank amount and the invoice total is stored positive; a sale is
  // the reverse. Comparing them without taking the magnitude would flag every single line.
  const purchase = rowsOf(csv([tx({ amount: -121, invoice_id: "inv-1" })]));
  const sale = rowsOf(csv([tx({ amount: 500, invoice_id: "inv-2", counterpart_name: "Klant B.V." })]));
  assert.doesNotMatch(purchase, /wijkt af/);
  assert.doesNotMatch(sale, /wijkt af/);
});

test("[AFLETTEREN] a creditnota's stored minus does not invent a discrepancy", () => {
  // Found by breaking the magnitude on the INVOICE side and watching nothing fail: every fixture
  // held a positive total, so the abs there was doing no visible work. A creditnota is exactly
  // where it does — stored at −75 ([CREDIT-SIGN]), refunded as −75 on the statement. Compared
  // signed, the difference reads as 150 and every credit note in the quarter is flagged.
  const refund = rowsOf(csv([tx({ invoice_id: "inv-cr", amount: -75, counterpart_name: "Klant B.V." })]));
  assert.doesNotMatch(refund, /wijkt af/);
  assert.match(refund, /CR-20260001/);

  const totals = bankHandoverTotals([tx({ invoice_id: "inv-cr", amount: -75 })], invoices);
  assert.equal(totals.withDifference, 0);
});

test("[AFLETTEREN] an invoice from another quarter is matched, not broken", () => {
  // A January invoice paid in April. The link is real and the invoice is simply not in this
  // package, so the difference is unknowable — which is not the same as zero.
  const out = csv([tx({ invoice_id: "inv-elders" })]);
  assert.match(out, /factuur buiten dit kwartaal/);
  const totals = bankHandoverTotals([tx({ invoice_id: "inv-elders" })], invoices);
  assert.equal(totals.matched, 1);
  assert.equal(totals.withDifference, 0, "an unknown difference must not be reported as a discrepancy…");
  assert.equal(totals.unmatched, 0, "…nor as an unmatched line");
});

// ─── The totals, which are quoted elsewhere ──────────────────────────────────────────

test("[AFLETTEREN] the totals are computed once and add up", () => {
  // They land in overzicht.json and in the LEESMIJ as well. A second implementation of them is a
  // number that will one day disagree with the file it is supposed to summarise.
  const rows = [
    tx({ amount: -121 }),                                   // exact
    tx({ amount: -100 }),                                   // matched, differs
    tx({ invoice_id: null, status: null, amount: -40 }),    // open
    tx({ invoice_id: null, status: null, amount: 60 }),     // open
  ];
  const t = bankHandoverTotals(rows, invoices);
  assert.equal(t.lines, 4);
  assert.equal(t.matched + t.unmatched, t.lines, "every line is in exactly one of the two buckets");
  assert.equal(t.matched, 2);
  assert.equal(t.unmatched, 2);
  assert.equal(t.matchedAmount, 221);
  assert.equal(t.unmatchedAmount, 100);
  assert.equal(t.withDifference, 1);
});

test("[AFLETTEREN] a semicolon in a description does not open a new column", () => {
  // Dutch Excel splits on ';'. An unquoted one in a bank description shifts every field after it
  // for that row, and an amount lands under a date with nothing looking broken.
  const out = csv([tx({ description: "Betaling; termijn 2" })]);
  const row = out.split("\r\n").find((l) => l.includes("termijn 2"))!;
  assert.match(row, /"Betaling; termijn 2"/);
});
