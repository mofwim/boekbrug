// [GELD-INVARIANT] Pure node test — run: npx tsx --test src/lib/money-invariants.test.ts
//
// An audit is only worth running if you believe it, and belief breaks in two directions. It must
// find the real thing (a euro booked twice, a creditnota adding where it should subtract), and it
// must stay quiet about the ordinary (an invoice paid by hand, a figure that is simply absent).
// A false alarm on a healthy administration is not a small cost: it is how the next real finding
// gets ignored.
//
// So these tests come in pairs — the violation, and the innocent case that looks just like it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  findMoneyViolations,
  findDrawerViolations,
  moneyAuditHeadline,
  type InvoiceRow,
  type LinkRow,
} from "./money-invariants";

const inv = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: "i1",
  invoiceNumber: "2026-0042",
  direction: "incoming",
  status: "received",
  invoiceType: "factuur",
  totalExBtw: 100,
  btwAmount: 21,
  totalIncBtw: 121,
  amountPaid: 0,
  ...over,
});

const link = (over: Partial<LinkRow> = {}): LinkRow => ({
  transactionId: "t1",
  invoiceId: "i1",
  amountApplied: 121,
  ...over,
});

const kinds = (v: ReturnType<typeof findMoneyViolations>) => v.map((x) => x.kind);

// ── A clean administration must be silent ────────────────────────────

test("[GELD-INVARIANT] books that add up produce nothing at all", () => {
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [link()],
    transactions: [{ id: "t1", amount: -121 }],
  });
  assert.deepEqual(v, []);
  assert.match(moneyAuditHeadline(v), /kloppen met zichzelf/);
});

test("[GELD-INVARIANT] an invoice paid BY HAND has no links, and that is not a finding", () => {
  // pay-toggle books a payment with no bank line at all. An audit that flagged those would fire on
  // every cash purchase in the country — and then nobody reads the one that matters.
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [],
  });
  assert.deepEqual(v, []);
});

test("[GELD-INVARIANT] a pre-migration link (NULL amount) is not read as a missing payment", () => {
  // NULL means "settled its invoice in full" — reading it as €0 would report every old payment as
  // money that never arrived, on exactly the rows that are hardest to verify.
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [link({ amountApplied: null })],
  });
  assert.deepEqual(v, []);
});

test("[GELD-INVARIANT] a missing figure is absent, not wrong", () => {
  const v = findMoneyViolations({
    invoices: [inv({ totalExBtw: null, btwAmount: null, amountPaid: 0 })],
    links: [],
  });
  assert.deepEqual(kinds(v), [], "inventing a violation from a gap is how an audit stops being believed");
});

// ── amount_paid against the payments that exist ──────────────────────

test("[GELD-INVARIANT] money booked as paid that no payment covers", () => {
  // Deliberately status 'paid': otherwise this fixture is ALSO a fully-covered-but-open invoice,
  // and it would report two findings. That is correct behaviour — an invoice can be wrong in more
  // than one way at once — but it makes a poor test of one rule. Written out because the first
  // version of this test asserted a single finding and failed, which is how the direction-aware
  // wording below was found.
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [link({ amountApplied: 50 })],
  });
  assert.deepEqual(kinds(v), ["paid_without_payments"]);
  assert.equal(v[0].euros, 71);
  assert.match(v[0].message, /71,00/);
});

test("[GELD-INVARIANT] one invoice can be wrong in two ways, and both are reported", () => {
  const v = findMoneyViolations({
    invoices: [inv({ status: "received", amountPaid: 121 })],
    links: [link({ amountApplied: 50 })],
  });
  assert.deepEqual(kinds(v).sort(), ["paid_without_payments", "status_open_but_covered"]);
});

test("[GELD-INVARIANT] the consequence of paid-but-open differs by direction, so the sentence does", () => {
  // On a purchase invoice, "you are still reminding someone who paid" is nonsense — the real risk
  // is that the owner pays it a SECOND time. One sentence for both would be vague about exactly
  // the part that matters.
  const inkoop = findMoneyViolations({
    invoices: [inv({ direction: "incoming", status: "received", amountPaid: 121 })],
    links: [],
  });
  assert.match(inkoop[0].message, /twee keer/);
  const verkoop = findMoneyViolations({
    invoices: [inv({ direction: "outgoing", status: "sent", amountPaid: 121 })],
    links: [],
  });
  assert.match(verkoop[0].message, /al betaald heeft/);
});

test("[GELD-INVARIANT] payments booked that the invoice does not show", () => {
  const v = findMoneyViolations({
    invoices: [inv({ amountPaid: 50 })],
    links: [link({ amountApplied: 121 })],
  });
  assert.deepEqual(kinds(v), ["payments_without_paid"]);
  assert.equal(v[0].euros, 71);
});

test("[GELD-INVARIANT] two payments on one invoice add up correctly", () => {
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [link({ transactionId: "t1", amountApplied: 60 }), link({ transactionId: "t2", amountApplied: 61 })],
  });
  assert.deepEqual(v, [], "instalments are ordinary, not a defect");
});

test("[GELD-INVARIANT] more paid than the invoice is worth", () => {
  const v = findMoneyViolations({
    invoices: [inv({ amountPaid: 200, status: "paid" })],
    links: [link({ amountApplied: 200 })],
  });
  assert.ok(kinds(v).includes("overpaid"));
  assert.equal(v.find((x) => x.kind === "overpaid")!.euros, 79);
});

test("[GELD-INVARIANT] a negative paid amount cannot exist", () => {
  const v = findMoneyViolations({ invoices: [inv({ amountPaid: -20 })], links: [] });
  assert.ok(kinds(v).includes("negative_paid"));
});

// ── The status against the amount ────────────────────────────────────

test("[GELD-INVARIANT] 'betaald' while money is still open", () => {
  const v = findMoneyViolations({ invoices: [inv({ status: "paid", amountPaid: 100 })], links: [] });
  assert.deepEqual(kinds(v), ["status_paid_but_open"]);
  assert.equal(v[0].euros, 21);
});

test("[GELD-INVARIANT] fully covered but still open — the invoice that chases someone who paid", () => {
  const v = findMoneyViolations({
    invoices: [inv({ direction: "outgoing", status: "sent", amountPaid: 121 })],
    links: [link()],
  });
  assert.deepEqual(kinds(v), ["status_open_but_covered"]);
  assert.match(v[0].message, /al betaald heeft/);
});

test("[GELD-INVARIANT] a draft or an archived invoice is not chasing anyone", () => {
  for (const status of ["draft", "archived"]) {
    const v = findMoneyViolations({ invoices: [inv({ status, amountPaid: 121 })], links: [link()] });
    assert.equal(
      kinds(v).includes("status_open_but_covered"),
      false,
      `${status} is deliberately out of the flow`,
    );
  }
});

// ── The invoice's own arithmetic — the figure the aangifte reads ─────

test("[GELD-INVARIANT] ex + btw must be inc, on what is actually STORED", () => {
  // The import gate checks this on the way in. This checks what ended up in the row, which is what
  // the BTW return reads — and those are not the same thing after a manual correction.
  const v = findMoneyViolations({
    invoices: [inv({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 130 })],
    links: [],
  });
  assert.ok(kinds(v).includes("btw_arithmetic"));
  assert.equal(v.find((x) => x.kind === "btw_arithmetic")!.euros, 9);
  assert.match(v[0].message, /staat in je aangifte/);
});

test("[GELD-INVARIANT] one cent of rounding is not a defect", () => {
  const v = findMoneyViolations({
    invoices: [inv({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 121.01 })],
    links: [],
  });
  assert.equal(kinds(v).includes("btw_arithmetic"), false);
});

// ── The creditnota's sign — wrong twice, in the same direction ───────

test("[GELD-INVARIANT] a creditnota stored POSITIVE adds where it should subtract", () => {
  const v = findMoneyViolations({
    invoices: [inv({ invoiceType: "creditnota", totalExBtw: 100, btwAmount: 21, totalIncBtw: 121 })],
    links: [],
  });
  assert.ok(kinds(v).includes("creditnota_sign"));
  // Twice the amount, because it is on the wrong side: €121 added where €121 should come off.
  assert.equal(v.find((x) => x.kind === "creditnota_sign")!.euros, 242);
});

test("[GELD-INVARIANT] a correctly negative creditnota is silent", () => {
  const v = findMoneyViolations({
    invoices: [inv({ invoiceType: "creditnota", totalExBtw: -100, btwAmount: -21, totalIncBtw: -121, status: "paid", amountPaid: 121 })],
    links: [],
  });
  assert.equal(kinds(v).includes("creditnota_sign"), false);
});

// ── A payment cannot give more than it moved ─────────────────────────

test("[GELD-INVARIANT] a bank line spread over more than it carried", () => {
  const v = findMoneyViolations({
    invoices: [inv({ id: "a", totalIncBtw: 3000 }), inv({ id: "b", totalIncBtw: 3200 })],
    links: [
      { transactionId: "t1", invoiceId: "a", amountApplied: 3000 },
      { transactionId: "t1", invoiceId: "b", amountApplied: 3200 },
    ],
    transactions: [{ id: "t1", amount: -5000 }],
  });
  assert.ok(kinds(v).includes("transaction_overallocated"));
  assert.equal(v.find((x) => x.kind === "transaction_overallocated")!.euros, 1200);
});

test("[GELD-INVARIANT] a creditnota in a batch SUBTRACTS — the false alarm this fixed", () => {
  // The real shape: a supplier bills €1.000, credits €150, and debits €850. amount_applied is a
  // MAGNITUDE per invoice (which is what recompute_invoice_amount_paid and the unlink reversal
  // need), so the links hold 1.000 and 150. Summing magnitudes gave 1.150 against a line of 850
  // and reported a €300 over-allocation on a batch that was exactly right.
  //
  // A false alarm on correct books is not a smaller failure than a missed one — it is how the next
  // real finding gets ignored, and this audit's only value is that it is believed.
  const v = findMoneyViolations({
    invoices: [
      inv({ id: "f", totalExBtw: 826.45, btwAmount: 173.55, totalIncBtw: 1000, amountPaid: 1000, status: "paid" }),
      inv({ id: "c", invoiceType: "creditnota", totalExBtw: -123.97, btwAmount: -26.03, totalIncBtw: -150, amountPaid: 150, status: "paid" }),
    ],
    links: [
      { transactionId: "t1", invoiceId: "f", amountApplied: 1000 },
      { transactionId: "t1", invoiceId: "c", amountApplied: 150 },
    ],
    transactions: [{ id: "t1", amount: -850 }],
  });
  assert.deepEqual(v, [], "1.000 − 150 IS the 850 the bank moved");
});

test("[GELD-INVARIANT] a link whose invoice was not passed in makes the line unjudgeable, not guilty", () => {
  // Auditing a subset is a real thing to do (--user). A link pointing outside that subset cannot be
  // signed, and guessing "positive" would recreate exactly the creditnota false alarm above. The
  // whole transaction is skipped: a check that cannot run must never report a result.
  const v = findMoneyViolations({
    invoices: [inv({ id: "a", totalIncBtw: 3000 })],
    links: [
      { transactionId: "t1", invoiceId: "a", amountApplied: 3000 },
      { transactionId: "t1", invoiceId: "elders", amountApplied: 9000 },
    ],
    transactions: [{ id: "t1", amount: -3000 }],
  });
  assert.equal(kinds(v).includes("transaction_overallocated"), false);
});

test("[GELD-INVARIANT] a batch that exactly spends its line is fine", () => {
  const v = findMoneyViolations({
    invoices: [],
    links: [
      { transactionId: "t1", invoiceId: "a", amountApplied: 3000 },
      { transactionId: "t1", invoiceId: "b", amountApplied: 2000 },
    ],
    transactions: [{ id: "t1", amount: -5000 }],
  });
  assert.deepEqual(v, []);
});

test("[GELD-INVARIANT] transactions are only checked when they were passed in", () => {
  // A check that did not run must never read as one that passed.
  const v = findMoneyViolations({
    invoices: [],
    links: [{ transactionId: "t1", invoiceId: "a", amountApplied: 99_999 }],
  });
  assert.deepEqual(v, []);
});

// ── [BANK-SPLIT] The Bank page and the invoice list must tell the same story ─────────
//
// The case a person actually found by eye: a bank line rendered "afgehandeld, automatisch
// gekoppeld" while the invoice it points at sat on the incoming list as open and overdue. Every
// booking path writes the pair consistently TODAY, but nothing ever re-checked the pairs that
// already exist — damage from before the orderings (or from a crash between two writes) persisted
// with both screens contradicting each other and no finding anywhere.

test("[BANK-SPLIT] a matched line whose invoice the list still shows open is the finding itself", () => {
  const v = findMoneyViolations({
    invoices: [inv({ id: "i1", status: "received", amountPaid: 0, totalIncBtw: 121 })],
    links: [],
    transactions: [{ id: "t1", amount: -121, invoiceId: "i1", status: "matched" }],
  });
  assert.deepEqual(kinds(v), ["matched_tx_unpaid_invoice"]);
  assert.equal(v[0].entityId, "t1");
  assert.equal(v[0].euros, 121);
  // The message must name both sides of the contradiction and the button as it is written on the
  // Bank page — the owner may not be sent hunting for a word the interface nowhere shows.
  assert.match(v[0].message, /2026-0042/);
  assert.match(v[0].message, /nog € 121,00 open/);
  assert.match(v[0].message, /"Ontkoppelen"/);
});

test("[BANK-SPLIT] a matched line whose invoice is paid is the ordinary case — silent", () => {
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [link()],
    transactions: [{ id: "t1", amount: -121, invoiceId: "i1", status: "matched" }],
  });
  assert.deepEqual(v, []);
});

test("[BANK-SPLIT] a pending line carrying an invoice_id is mid-multi-confirm, not a finding", () => {
  // /api/bank/confirm records invoice_id while money remains unbooked and only flips to 'matched'
  // when the line is fully spent. Flagging that intermediate state would fire on every partly
  // confirmed batch in the country.
  const v = findMoneyViolations({
    invoices: [inv({ status: "received", amountPaid: 50, totalIncBtw: 121 })],
    links: [link({ amountApplied: 50 })],
    transactions: [{ id: "t1", amount: -500, invoiceId: "i1", status: "pending" }],
  });
  assert.ok(!kinds(v).includes("matched_tx_unpaid_invoice"), `fired on a pending line: ${JSON.stringify(v)}`);
});

test("[BANK-SPLIT] a matched line to an invoice that was not passed in is unjudgeable, not guilty", () => {
  // The route reads invoices with .neq(status,'archived'), so a link onto an archived row lands
  // here: no verdict — a check that cannot run must not report. (The read-only SQL sweep covers
  // archived rows; this audit covers the live books.)
  const v = findMoneyViolations({
    invoices: [],
    links: [],
    transactions: [{ id: "t1", amount: -121, invoiceId: "gone", status: "matched" }],
  });
  assert.deepEqual(v, []);
});

test("[BANK-SPLIT] covered-but-open stays status_open_but_covered's finding — never two verdicts on one row", () => {
  // amount_paid says fully covered while status still says open: that contradiction is already
  // reported, with the opposite advice ("hij IS betaald"). A second finding from the bank side
  // saying "één van de twee is onwaar" about the same row would argue with it.
  const v = findMoneyViolations({
    invoices: [inv({ status: "received", amountPaid: 121, totalIncBtw: 121 })],
    links: [link({ amountApplied: 121 })],
    transactions: [{ id: "t1", amount: -121, invoiceId: "i1", status: "matched" }],
  });
  assert.ok(kinds(v).includes("status_open_but_covered"), `expected the covered finding: ${JSON.stringify(v)}`);
  assert.ok(!kinds(v).includes("matched_tx_unpaid_invoice"), "both verdicts fired on one row");
});

test("[BANK-SPLIT] the partial that is honestly mid-payment fires too, for the OPEN remainder", () => {
  // 'matched' means the bank considers this line fully spent. If the invoice it spent itself on
  // still shows €71 open, that €71 is the dispute — not the full total.
  const v = findMoneyViolations({
    invoices: [inv({ status: "received", amountPaid: 50, totalIncBtw: 121 })],
    links: [link({ amountApplied: 50 })],
    transactions: [{ id: "t1", amount: -121, invoiceId: "i1", status: "matched" }],
  });
  const split = v.find((x) => x.kind === "matched_tx_unpaid_invoice");
  assert.ok(split, `expected the split finding: ${JSON.stringify(v)}`);
  assert.equal(split!.euros, 71);
});

// ── [DUBBEL-GEBOEKT] The same bill must not live twice ───────────────────────────────
//
// Straight from the FAMZFOOD audit trail: the reader spelled one number "26/3958" AND
// "26 / 3958", both rows reached the books, the matcher paid one and the twin stayed open —
// and 26/1876 ended up paid twice. Each copy counts kosten + voorbelasting a second time.

test("[DUBBEL-GEBOEKT] the FAMZFOOD twin: two spellings, one paid, one still open", () => {
  const v = findMoneyViolations({
    invoices: [
      inv({ id: "a", invoiceNumber: "26/3958", clientName: "FAMZFOOD BV", status: "paid", amountPaid: 630.15, totalExBtw: null, btwAmount: null, totalIncBtw: 630.15 }),
      inv({ id: "b", invoiceNumber: "26 / 3958", clientName: "FAMZFOOD B.V.", status: "received", amountPaid: 0, totalExBtw: null, btwAmount: null, totalIncBtw: 630.15 }),
    ],
    links: [],
  });
  const dup = v.filter((x) => x.kind === "duplicate_live_pair");
  assert.equal(dup.length, 1, `expected exactly one pair finding: ${JSON.stringify(v)}`);
  assert.equal(dup[0].euros, 630.15); // the copy's worth — the amount counted double
  assert.match(dup[0].message, /2 keer/);
  assert.match(dup[0].message, /betaald en openstaand/);
  assert.match(dup[0].message, /Genegeerd/);
});

test("[DUBBEL-GEBOEKT] paid twice — the 26/1876 case — is the worst copy and still one finding", () => {
  const v = findMoneyViolations({
    invoices: [
      inv({ id: "a", invoiceNumber: "26/1876", clientName: "FAMZFOOD BV", status: "paid", amountPaid: 665.02, totalExBtw: null, btwAmount: null, totalIncBtw: 665.02 }),
      inv({ id: "b", invoiceNumber: "26 / 1876", clientName: "FAMZFOOD BV", status: "paid", amountPaid: 665.02, totalExBtw: null, btwAmount: null, totalIncBtw: 665.02 }),
    ],
    links: [],
  });
  const dup = v.filter((x) => x.kind === "duplicate_live_pair");
  assert.equal(dup.length, 1);
  assert.match(dup[0].message, /betaald en betaald/);
});

test("[DUBBEL-GEBOEKT] two suppliers who both number an invoice 2026-001 are not a pair", () => {
  // Every January is full of these. A false alarm here is how the audit stops being believed.
  const v = findMoneyViolations({
    invoices: [
      inv({ id: "a", invoiceNumber: "2026-001", clientName: "Bakkerij Jansen", totalExBtw: null, btwAmount: null }),
      inv({ id: "b", invoiceNumber: "2026-001", clientName: "Groente Import BV", totalExBtw: null, btwAmount: null }),
    ],
    links: [],
  });
  assert.ok(!kinds(v).includes("duplicate_live_pair"), `paired across suppliers: ${JSON.stringify(v)}`);
});

test("[DUBBEL-GEBOEKT] a creditnota legitimately carries its factuur's number — no pair", () => {
  const v = findMoneyViolations({
    invoices: [
      inv({ id: "a", invoiceNumber: "26/4000", clientName: "FAMZFOOD BV", invoiceType: "factuur", totalExBtw: null, btwAmount: null }),
      inv({ id: "b", invoiceNumber: "26/4000", clientName: "FAMZFOOD BV", invoiceType: "creditnota", totalExBtw: null, btwAmount: null, totalIncBtw: -630.15, amountPaid: 0 }),
    ],
    links: [],
  });
  assert.ok(!kinds(v).includes("duplicate_live_pair"), `factuur paired with its creditnota: ${JSON.stringify(v)}`);
});

test("[DUBBEL-GEBOEKT] an archived copy is already dealt with, and a nameless row is unjudgeable", () => {
  const v = findMoneyViolations({
    invoices: [
      inv({ id: "a", invoiceNumber: "26/5000", clientName: "FAMZFOOD BV", status: "paid", amountPaid: 121, totalExBtw: null, btwAmount: null }),
      inv({ id: "b", invoiceNumber: "26/5000", clientName: "FAMZFOOD BV", status: "archived", totalExBtw: null, btwAmount: null }),
      inv({ id: "c", invoiceNumber: "26/5000", clientName: null, totalExBtw: null, btwAmount: null }),
    ],
    links: [],
  });
  assert.ok(!kinds(v).includes("duplicate_live_pair"), `archived or nameless row formed a pair: ${JSON.stringify(v)}`);
});

test("[DUBBEL-GEBOEKT] three copies: everything beyond the biggest counts as the damage", () => {
  const v = findMoneyViolations({
    invoices: [
      inv({ id: "a", invoiceNumber: "26/6000", clientName: "FAMZFOOD BV", status: "paid", amountPaid: 100, totalExBtw: null, btwAmount: null, totalIncBtw: 100 }),
      inv({ id: "b", invoiceNumber: "26 /6000", clientName: "FAMZFOOD BV", status: "received", amountPaid: 0, totalExBtw: null, btwAmount: null, totalIncBtw: 100 }),
      inv({ id: "c", invoiceNumber: "26/ 6000", clientName: "FAMZFOOD BV", status: "processing", amountPaid: 0, totalExBtw: null, btwAmount: null, totalIncBtw: 100 }),
    ],
    links: [],
  });
  const dup = v.filter((x) => x.kind === "duplicate_live_pair");
  assert.equal(dup.length, 1);
  assert.equal(dup[0].euros, 200);
  assert.match(dup[0].message, /3 keer/);
});

test("[DUBBEL-GEBOEKT] the route feeds the supplier name — without it the check silently sleeps", () => {
  const route = readFileSync("src/app/api/money-audit/route.ts", "utf8");
  assert.match(route, /amount_paid, sender_id, receiver_id, client_name"/,
    "client_name left the invoices select — the duplicate-pair check no longer runs");
  assert.match(route, /clientName: \(r\.client_name as string \| null\) \?\? null/,
    "client_name is read but never mapped into InvoiceRow");
});

test("[BANK-SPLIT] the money-audit route actually feeds the check — columns AND mapping", () => {
  // findMoneyViolations skips what it cannot see, BY DESIGN — so the route quietly dropping
  // invoice_id or status from its select would switch this check off with every test above still
  // green. The wiring is the assertion: the select carries the columns, the mapper hands them on.
  const route = readFileSync("src/app/api/money-audit/route.ts", "utf8");
  assert.match(
    route, /\.select\("id, amount, invoice_id, status"\)/,
    "the bank_transactions read no longer carries invoice_id + status — the matched-line check is switched off",
  );
  assert.match(route, /invoiceId: \(r\.invoice_id as string \| null\) \?\? null/, "invoice_id is read but never mapped");
  assert.match(route, /status: \(r\.status as string \| null\) \?\? null,\n\s*\}\)\);\n\s*\} catch/, "status is read but never mapped into TransactionRow");
});

// ── The headline, and the order ──────────────────────────────────────

test("[GELD-INVARIANT] the biggest euros come first, and the headline names the total", () => {
  const v = findMoneyViolations({
    invoices: [
      inv({ id: "small", invoiceNumber: "A", status: "paid", amountPaid: 120 }),          // €1 open
      inv({ id: "big", invoiceNumber: "B", totalIncBtw: 5000, amountPaid: 5000, status: "paid", totalExBtw: 4132.23, btwAmount: 867.77 }),
      inv({ id: "huge", invoiceNumber: "C", totalIncBtw: 900, amountPaid: 4000, status: "paid", totalExBtw: 743.80, btwAmount: 156.20 }),
    ],
    links: [],
  });
  assert.ok(v.length >= 2);
  assert.equal(v[0].entityId, "huge", "€3.100 too much outranks €1 still open");
  for (let i = 1; i < v.length; i++) assert.ok(v[i - 1].euros >= v[i].euros);
  assert.match(moneyAuditHeadline(v), /verschillen gevonden, samen/);
});

// ── [GELD-INVARIANT-KAS] The drawer, checked backwards ───────────────────────────────
//
// Same pairing rule as everything above: each violation next to the innocent case that looks like
// it. The drawer earns the extra scrutiny — cash-settle.ts NAMES the three states it can leave
// behind ("the kas balance is now too high", "…too low", "half-healed") and nothing ever looked
// again, while that same drawer decides whether a quarter may be filed.

test("[GELD-INVARIANT-KAS] a cash payment with no drawer movement: the balance stands too HIGH", () => {
  const v = findDrawerViolations({
    settlementEntries: [],
    sync: {
      toCreate: [{ invoice_id: "inv-1", amount: 250, description: "Betaling factuur 2026-014 — Bakker" }],
      toUpdate: [], toDeleteIds: [],
    },
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].kind, "drawer_settlement_missing");
  assert.equal(v[0].entityId, "inv-1");
  assert.equal(v[0].euros, 250);
  assert.match(v[0].message, /HOGER/, "it must say WHICH WAY the drawer is wrong — that decides what to do");
});

test("[GELD-INVARIANT-KAS] a movement belonging to no cash payment: the balance stands too LOW", () => {
  const v = findDrawerViolations({
    settlementEntries: [{ id: "e1", invoice_id: "inv-9", amount: 80, entry_date: "2026-05-03" }],
    sync: { toCreate: [], toUpdate: [], toDeleteIds: ["e1"] },
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].kind, "drawer_settlement_orphan");
  assert.equal(v[0].euros, 80);
  assert.equal(v[0].entityId, "inv-9", "it names the INVOICE, so the finding is actionable");
  assert.match(v[0].message, /LAGER/);
  assert.match(v[0].message, /2026-05-03/, "the day matters: a running balance is wrong from there on");
});

test("[GELD-INVARIANT-KAS] a corrected invoice the drawer did not follow reports only the DELTA", () => {
  const v = findDrawerViolations({
    settlementEntries: [{ id: "e1", invoice_id: "inv-2", amount: 100, entry_date: "2026-05-01" }],
    sync: {
      toCreate: [], toDeleteIds: [],
      toUpdate: [{ id: "e1", row: { invoice_id: "inv-2", amount: 121, entry_date: "2026-05-01", description: "Betaling factuur 7" } }],
    },
  });
  assert.equal(v[0].kind, "drawer_settlement_stale");
  assert.equal(v[0].euros, 21, "€21 is at stake, not the €121 that is mostly right");
  assert.match(v[0].message, /100,00[\s\S]*121,00/, "both figures, so nobody has to look them up");
});

test("[GELD-INVARIANT-KAS] a right amount on the wrong DAY is still a finding, at €0", () => {
  // The day is not cosmetic in a running balance: every eindsaldo after it is wrong, which is what
  // the kasboek an inspector reads is made of. But no euro is missing, so the urgency is honest.
  const v = findDrawerViolations({
    settlementEntries: [{ id: "e1", invoice_id: "inv-3", amount: 60, entry_date: "2026-04-30" }],
    sync: {
      toCreate: [], toDeleteIds: [],
      toUpdate: [{ id: "e1", row: { invoice_id: "inv-3", amount: 60, entry_date: "2026-05-02", description: "Betaling factuur 8" } }],
    },
  });
  assert.equal(v[0].kind, "drawer_settlement_stale");
  assert.equal(v[0].euros, 0);
  assert.match(v[0].message, /2026-04-30[\s\S]*2026-05-02/);
});

test("[GELD-INVARIANT-KAS] a drawer in step reports nothing at all", () => {
  // The reconcile wants no change — which is what it wants in every healthy administration, because
  // it runs on every kasboek read and hourly. Silence here is the whole point of the check.
  assert.deepEqual(
    findDrawerViolations({
      settlementEntries: [{ id: "e1", invoice_id: "inv-1", amount: 250, entry_date: "2026-05-01" }],
      sync: { toCreate: [], toUpdate: [], toDeleteIds: [] },
      lowestPoint: null,
    }),
    [],
  );
});

test("[GELD-INVARIANT-KAS] a negative drawer day is reported; a positive one is not", () => {
  const bad = findDrawerViolations({
    settlementEntries: [], sync: { toCreate: [], toUpdate: [], toDeleteIds: [] },
    lowestPoint: { date: "2026-05-12", balance: -340 },
  });
  assert.equal(bad.length, 1);
  assert.equal(bad[0].kind, "drawer_negative");
  assert.equal(bad[0].euros, 340);
  assert.equal(bad[0].entityId, "2026-05-12", "the DAY is the entity — that is what you go and look at");
  assert.match(bad[0].message, /blokkeert de BTW-aangifte/, "the consequence belongs in the sentence");

  // A drawer that never went below zero, and one that touched exactly zero, are both fine. A till
  // legitimately ends a day empty, and a false fraud flag is the most expensive kind here.
  for (const lowestPoint of [{ date: "2026-05-12", balance: 0 }, { date: "2026-05-12", balance: 12.5 }]) {
    assert.deepEqual(
      findDrawerViolations({ settlementEntries: [], sync: { toCreate: [], toUpdate: [], toDeleteIds: [] }, lowestPoint }),
      [],
    );
  }
});

test("[GELD-INVARIANT-KAS] an unchecked drawer is never reported as a clean one", () => {
  // No lowestPoint passed = the witness could not be computed (a failed read, an owner with no
  // drawer). The same rule the transaction check follows above: a check that did not run must not
  // read as one that passed.
  assert.deepEqual(
    findDrawerViolations({ settlementEntries: [], sync: { toCreate: [], toUpdate: [], toDeleteIds: [] } }),
    [],
  );
});

test("[GELD-INVARIANT-KAS] the biggest euros come first here too", () => {
  const v = findDrawerViolations({
    settlementEntries: [{ id: "e1", invoice_id: "inv-9", amount: 15 }],
    sync: {
      toCreate: [{ invoice_id: "inv-1", amount: 900, description: "Betaling factuur 1" }],
      toUpdate: [], toDeleteIds: ["e1"],
    },
    lowestPoint: { date: "2026-05-12", balance: -50 },
  });
  assert.deepEqual(v.map((x) => x.euros), [900, 50, 15]);
});

// ─── The gate: the audit must actually run somewhere ─────────────────────────────────

test("[GELD-INVARIANT] the audit is wired to a route and a screen, not merely exported", () => {
  // The defect this gate exists for is the one this module HAD. Every function here was complete,
  // considered and tested, and nothing called it: no route, no screen, no cron. A sweep over the
  // exports of src/lib found it — three exports of a money audit, referenced by nothing but their
  // own tests.
  //
  // That is exactly the failure this file's own header warns about one axis over: something
  // computed and told to no one. A test suite is not a caller; it proves the arithmetic and
  // proves nothing about whether anybody is ever shown the answer.
  const route = readFileSync("src/app/api/money-audit/route.ts", "utf8");
  assert.match(route, /findMoneyViolations\(\{/, "the invoice/payments axis no longer runs");
  assert.match(route, /findDrawerViolations\(\{/, "the drawer axis no longer runs");
  assert.match(route, /moneyAuditHeadline\(violations\)/, "the one line that says whether anything needs doing");
  // Owner-only, for the reason spelled out in the route: a medewerker is the sender of no invoice,
  // so he would read an EMPTY set — and an empty set has no differences, so the screen would tell
  // him the books are fine about an administration he cannot see.
  assert.match(route, /requireOwner\(/, "[ACTING-FOR] a member would be told an empty administration is in order");
  // The drawer half must be allowed to fail ALONE and say so. Silence there reads as "checked".
  // Matched as the ASSIGNMENT, not as the bare word: `drawerChecked` also appears in its own
  // declaration and in the JSON body, so a loose match survives deleting the one line that ever
  // sets it — and then every drawer read reports as unchecked while the code still "mentions" it.
  assert.match(
    route, /drawerChecked = true;/,
    "nothing sets drawerChecked any more — every drawer read now reports as not-run",
  );
  assert.match(route, /drawerChecked,/, "…and it never reaches the screen");

  const panel = readFileSync("src/components/beveiliging/GeldPaneel.tsx", "utf8");
  // [BRUG] The panel now carries an optional clientId, so it serves both sides of the bridge: the
  // owner asking about his own books, and the accountant asking about a client he is linked to.
  // Matched on the path rather than the whole call, and separately on the clientId travelling —
  // dropping that parameter would silently show the accountant HIS OWN books under his client's
  // name, which is the worst way this screen could be wrong.
  assert.match(panel, /fetch\(`\/api\/money-audit\$\{clientId/, "the panel no longer asks, or stopped passing the client it is looking at");

  const screen = readFileSync("src/app/dashboard/klaar/KlaarClient.tsx", "utf8");
  assert.match(screen, /<GeldPaneel \/>/, "the panel exists and is on no screen — the same defect, one level up");
});

// ── [BEDRAG-NOOIT-GESCHREVEN] The gap that is not a disagreement ─────────────
//
// Measured in production on 30 August 2026: fourteen invoices, € 5.321,68, every one of them
// correctly received. Status 'paid', bank links covering the total exactly, amount_paid zero —
// runBankAutoConfirm's pay write set four columns and skipped the fifth, while the link it wrote
// on the next line recorded the whole sum. The cause is closed; the rows it left do not heal
// themselves, because amount_paid is only re-derived per invoice on a pay-toggle, an unlink or a
// statement delete.
//
// Reported as an ordinary gap it reads as € 5.321,68 missing on /dashboard/klaar — the screen
// where an owner decides to hand the quarter to their accountant. That is the false alarm that
// teaches someone to stop reading the panel. These tests pin the separation, and — more
// importantly — the four boundaries where it must NOT apply, because a suppression that is too
// eager is the same panel lying in the other direction.

test("[GELD-INVARIANT] a fully-covered paid invoice with no amount written is its own finding", () => {
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 0 })],
    links: [link({ amountApplied: 121 })],
  });
  assert.deepEqual(kinds(v), ["paid_amount_never_written"]);
  assert.equal(v[0].euros, 121, "the finding names the invoice total, not a shortfall");
  assert.match(v[0].message, /ontbreekt geen geld/, "the message no longer says no money is missing");
});

test("[GELD-INVARIANT] …and it does not also report the status as open", () => {
  // The same single cause said a second way. status_paid_but_open fires on paid < total, which is
  // exactly this row, so without the suppression one unwritten column produces two findings and
  // the panel looks twice as bad as the books are.
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 0 })],
    links: [link({ amountApplied: 121 })],
  });
  assert.ok(!kinds(v).includes("status_paid_but_open"), "the same cause was reported twice");
});

test("[GELD-INVARIANT] partial cover is a real gap and stays one", () => {
  // The boundary that matters most. € 60 of a € 121 invoice really is money that has not arrived,
  // and calling it "only a column" would hide a genuine shortfall behind a reassuring sentence.
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 0 })],
    links: [link({ amountApplied: 60 })],
  });
  assert.deepEqual(kinds(v).sort(), ["payments_without_paid", "status_paid_but_open"]);
});

test("[GELD-INVARIANT] a non-zero amount that disagrees is a real gap too", () => {
  // amount_paid was written, and written to something the links do not support. Two sources really
  // do disagree here, and which one is right is not knowable from these rows.
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 50 })],
    links: [link({ amountApplied: 121 })],
  });
  assert.deepEqual(kinds(v).sort(), ["payments_without_paid", "status_paid_but_open"]);
});

test("[GELD-INVARIANT] an invoice that does not claim to be paid is untouched by this", () => {
  // Covered links on an OPEN invoice is a different defect with a different consequence — a
  // reminder still going to somebody who paid. It must keep its own name.
  const v = findMoneyViolations({
    invoices: [inv({ status: "received", amountPaid: 0 })],
    links: [link({ amountApplied: 121 })],
  });
  assert.ok(!kinds(v).includes("paid_amount_never_written"));
  assert.ok(kinds(v).includes("payments_without_paid"));
});

test("[GELD-INVARIANT] the invoice's own arithmetic is still checked on such a row", () => {
  // The suppression is deliberately narrow. Which payment column was written has nothing to do
  // with whether ex + btw equals inc — that figure goes into the aangifte, and an earlier draft of
  // this change skipped it by returning early.
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 0, totalExBtw: 100, btwAmount: 30, totalIncBtw: 121 })],
    links: [link({ amountApplied: 121 })],
  });
  assert.ok(kinds(v).includes("paid_amount_never_written"));
  assert.ok(kinds(v).includes("btw_arithmetic"), "the arithmetic check was skipped along with the gap");
});
