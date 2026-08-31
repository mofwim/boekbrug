// src/lib/supplier-balances.test.ts
// [LEVERANCIER-SALDO] Pure node test — run: npx tsx --test src/lib/supplier-balances.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  supplierBalances,
  totalOf,
  type SettlementRow,
  type SupplierInvoiceRow,
} from "./supplier-balances";
import { openAmountSigned, settledAmountSigned } from "./partial-payment";

function inv(over: Partial<SupplierInvoiceRow>): SupplierInvoiceRow {
  return {
    id: over.id ?? "i1",
    invoiceNumber: over.invoiceNumber ?? "2034488",
    supplierKey: over.supplierKey === undefined ? "can" : over.supplierKey,
    supplierName: over.supplierName ?? "CAN Vleesgroothandel B.V.",
    invoiceDate: over.invoiceDate === undefined ? "2026-08-15" : over.invoiceDate,
    dueDate: over.dueDate === undefined ? "2026-08-29" : over.dueDate,
    status: over.status ?? "received",
    invoiceType: over.invoiceType ?? "factuur",
    totalIncBtw: over.totalIncBtw === undefined ? 1165.73 : over.totalIncBtw,
    amountPaid: over.amountPaid === undefined ? 0 : over.amountPaid,
  };
}

// ─── The photo, reproduced ────────────────────────────────────────────────────────────────────

test("[LEVERANCIER-SALDO] the wholesaler's two invoices add up to the wholesaler's own subtotal", () => {
  // Straight off the supplier's screen: 2034488 of 15-8 for € 1.165,73 and 2034534 of 22-8 for
  // € 1.217,92, both open, subtotal € 2.383,65. The whole point of this module is that BoekBrug
  // can now produce that same line from the other side of the same two invoices.
  const r = supplierBalances({
    asOf: "2026-08-30",
    invoices: [
      inv({ id: "a", invoiceNumber: "2034488", invoiceDate: "2026-08-15", dueDate: "2026-08-29", totalIncBtw: 1165.73 }),
      inv({ id: "b", invoiceNumber: "2034534", invoiceDate: "2026-08-22", dueDate: "2026-09-05", totalIncBtw: 1217.92 }),
    ],
  });
  assert.equal(r.suppliers.length, 1);
  assert.equal(r.suppliers[0].open, 2383.65, "to the cent, and it is the supplier's own figure");
  assert.equal(r.suppliers[0].openCount, 2);
  assert.equal(r.suppliers[0].overdueCount, 1, "only the one past 29 August");
  assert.equal(r.suppliers[0].overdue, 1165.73);
  assert.equal(r.suppliers[0].oldestDueDate, "2026-08-29");
  assert.equal(r.total, 2383.65);
});

// ─── The peildatum is a real answer, not a label ──────────────────────────────────────────────

test("[LEVERANCIER-SALDO] a payment made AFTER the peildatum did not happen yet", () => {
  // The reason this module takes dated settlements at all. An accountant closing 2026 needs what
  // was open on 31 December; the invoice's status and amount_paid both answer "now", and no
  // arrangement of them can recover the past.
  const invoices = [inv({ id: "a", status: "paid", amountPaid: 1165.73, invoiceDate: "2026-08-15" })];
  const settlements: SettlementRow[] = [{ invoiceId: "a", amountApplied: 1165.73, paidOn: "2026-09-04" }];

  const before = supplierBalances({ invoices, settlements, asOf: "2026-08-31" });
  assert.equal(before.basis, "settlements");
  assert.equal(before.total, 1165.73, "on 31 August this invoice was still open");

  const after = supplierBalances({ invoices, settlements, asOf: "2026-09-30" });
  assert.equal(after.total, 0, "…and on 30 September it was not");
});

test("[LEVERANCIER-SALDO] without settlements the answer is TODAY'S, and it says so", () => {
  // The dangerous case: a screen asks for 31 December, gets today's figure, and prints the date it
  // asked for above it. `basis` is the only thing standing between that and a filed balance.
  const r = supplierBalances({
    invoices: [inv({ status: "paid", amountPaid: 1165.73 })],
    asOf: "2026-01-31",
  });
  assert.equal(r.basis, "huidig");
  assert.equal(r.total, 0);
});

test("[LEVERANCIER-SALDO] an empty settlement list is not the same as no list", () => {
  // An administration where nothing has been paid yet is a real state. Reading it as "no data,
  // fall back to now" would answer a different question and look identical on screen.
  const invoices = [inv({ status: "paid", amountPaid: 1165.73 })];
  assert.equal(supplierBalances({ invoices, settlements: [], asOf: "2026-08-30" }).total, 1165.73,
    "paid, but no dated settlement proves it by this date");
  assert.equal(supplierBalances({ invoices, asOf: "2026-08-30" }).total, 0);
});

test("[LEVERANCIER-SALDO] a partial payment leaves the remainder, on the date it was made", () => {
  // Dated before the earliest peildatum below — otherwise the invoice is correctly excluded as
  // not-yet-issued, which is a different behaviour and is proven on its own two tests down.
  const invoices = [inv({ id: "a", invoiceDate: "2026-04-20", dueDate: "2026-05-04",
                          totalIncBtw: 3685.78, status: "received", amountPaid: 2000 })];
  const settlements: SettlementRow[] = [
    { invoiceId: "a", amountApplied: 2000, paidOn: "2026-05-07" },
    { invoiceId: "a", amountApplied: 1685.78, paidOn: "2026-06-20" },
  ];
  assert.equal(supplierBalances({ invoices, settlements, asOf: "2026-05-06" }).total, 3685.78);
  assert.equal(supplierBalances({ invoices, settlements, asOf: "2026-05-31" }).total, 1685.78);
  assert.equal(supplierBalances({ invoices, settlements, asOf: "2026-06-30" }).total, 0);
});

test("[LEVERANCIER-SALDO] a legacy link with no amount settled its invoice in full", () => {
  // The same reading bank-line-budget.ts and payment-evidence.ts already apply. Treating NULL as
  // zero would resurrect every historical payment in the app as an open debt.
  const r = supplierBalances({
    invoices: [inv({ id: "a", status: "paid", amountPaid: 0 })],
    settlements: [{ invoiceId: "a", amountApplied: null, paidOn: "2026-08-20" }],
    asOf: "2026-08-30",
  });
  assert.equal(r.total, 0);
});

test("[LEVERANCIER-SALDO] an invoice dated after the peildatum is not on the balance", () => {
  const r = supplierBalances({
    invoices: [inv({ invoiceDate: "2026-09-15" })],
    settlements: [],
    asOf: "2026-08-31",
  });
  assert.equal(r.suppliers.length, 0);
  assert.equal(r.total, 0);
});

// ─── Credit notes, which are the reason a total is signed ─────────────────────────────────────

test("[LEVERANCIER-SALDO] a supplier's creditnota REDUCES what is owed", () => {
  // Summing magnitudes would make a creditnota increase the debt — the opposite of what it is, and
  // the opposite of what the same screen prints on its own row.
  const r = supplierBalances({
    asOf: "2026-08-30",
    settlements: [],
    invoices: [
      inv({ id: "a", totalIncBtw: 1000 }),
      inv({ id: "b", invoiceNumber: "CN-1", totalIncBtw: -250, invoiceType: "creditnota" }),
    ],
  });
  assert.equal(r.suppliers[0].open, 750, "1000 minus 250, which is what the eye adds up");
  assert.equal(r.suppliers[0].invoices.find((i) => i.invoiceNumber === "CN-1")?.open, -250);
  assert.equal(r.suppliers[0].invoices.find((i) => i.invoiceNumber === "CN-1")?.isCreditNote, true);
});

// ─── What is counted and what is added ────────────────────────────────────────────────────────

test("[LEVERANCIER-SALDO] an unverified bill is counted beside the total, never inside it", () => {
  // Read by a machine and by nobody else. Folding it in puts an unchecked amount into a figure
  // people act on; dropping it silently understates what the shop owes.
  const r = supplierBalances({
    asOf: "2026-08-30",
    settlements: [],
    invoices: [
      inv({ id: "a", totalIncBtw: 1000 }),
      inv({ id: "b", totalIncBtw: 9999, status: "processing" }),
    ],
  });
  assert.equal(r.total, 1000);
  assert.equal(r.unverifiedCount, 1);
  assert.equal(r.suppliers[0].unverifiedCount, 1);
});

test("[LEVERANCIER-SALDO] an open invoice with no supplier is REPORTED, and still counts in the total", () => {
  // [NO-SILENT-EMPTY]. It cannot be grouped, so it is not on any supplier's line — but the money is
  // owed, and a creditors total that quietly excludes it is wrong in the direction that matters.
  const r = supplierBalances({
    asOf: "2026-08-30",
    settlements: [],
    invoices: [inv({ id: "a", supplierKey: null, totalIncBtw: 400 }), inv({ id: "b", totalIncBtw: 600 })],
  });
  assert.equal(r.unkeyedCount, 1);
  assert.equal(r.unkeyedOpen, 400);
  assert.equal(r.total, 1000, "the total is complete even though one row has no supplier line");
  assert.equal(totalOf(r), 1000);
});

// ─── Aging ────────────────────────────────────────────────────────────────────────────────────

test("[LEVERANCIER-SALDO] the aging buckets are by days PAST DUE, and a dateless bill is not aged", () => {
  const r = supplierBalances({
    asOf: "2026-08-30",
    settlements: [],
    invoices: [
      inv({ id: "a", dueDate: "2026-09-10", totalIncBtw: 100 }),  // not yet due
      inv({ id: "b", dueDate: "2026-08-30", totalIncBtw: 200 }),  // due today → not overdue
      inv({ id: "c", dueDate: "2026-08-20", totalIncBtw: 300 }),  // 10 days
      inv({ id: "d", dueDate: "2026-07-20", totalIncBtw: 400 }),  // 41 days
      inv({ id: "e", dueDate: "2026-06-20", totalIncBtw: 500 }),  // 71 days
      inv({ id: "f", dueDate: "2026-01-20", totalIncBtw: 600 }),  // 222 days
      inv({ id: "g", dueDate: null, totalIncBtw: 700 }),          // no date at all
    ],
  });
  assert.deepEqual(r.aging, {
    nietVervallen: 300, dag1tot30: 300, dag31tot60: 400,
    dag61tot90: 500, dag90plus: 600, zonderVervaldatum: 700,
  });
  assert.equal(r.totalOverdue, 1800, "everything past its date, and nothing else");
  assert.equal(r.suppliers[0].invoices.find((i) => i.id === "g")?.overdueDays, null,
    "a bill with no due date is undateable, not current — it is the one nobody chases");
});

// ─── The identity that keeps two screens agreeing ─────────────────────────────────────────────

test("[LEVERANCIER-SALDO] on today's date the two bases agree, invoice for invoice", () => {
  // openAmountSigned is the app's one authority for "still open". If this module drifted from it,
  // a creditors list and an invoice row would print two different numbers for the same bill.
  const rows = [
    inv({ id: "a", totalIncBtw: 1000, status: "received", amountPaid: 0 }),
    inv({ id: "b", totalIncBtw: 1000, status: "received", amountPaid: 400 }),
    inv({ id: "c", totalIncBtw: 1000, status: "paid", amountPaid: 1000 }),
    inv({ id: "d", totalIncBtw: -250, status: "received", amountPaid: 0, invoiceType: "creditnota" }),
  ];
  const settlements: SettlementRow[] = [
    { invoiceId: "b", amountApplied: 400, paidOn: "2026-08-01" },
    { invoiceId: "c", amountApplied: 1000, paidOn: "2026-08-01" },
  ];
  const viaLinks = supplierBalances({ invoices: rows, settlements, asOf: "2026-08-30" });
  const viaNow = supplierBalances({ invoices: rows, asOf: "2026-08-30" });
  assert.equal(viaLinks.total, viaNow.total);
  assert.equal(viaNow.total, rows.reduce(
    (s, r) => s + openAmountSigned({ total_inc_btw: r.totalIncBtw, amount_paid: r.amountPaid, status: r.status }), 0));

  // And the identity the settled half rests on, stated here so a change to either breaks something.
  for (const r of rows) {
    const pay = { total_inc_btw: r.totalIncBtw, amount_paid: r.amountPaid, status: r.status };
    assert.equal(
      openAmountSigned(pay) + settledAmountSigned(pay), r.totalIncBtw,
      `open + settled must equal the signed total on ${r.id}`);
  }
});

test("[LEVERANCIER-SALDO] suppliers come out most-owed first, invoices oldest-first", () => {
  const r = supplierBalances({
    asOf: "2026-08-30",
    settlements: [],
    invoices: [
      inv({ id: "a", supplierKey: "klein", supplierName: "Klein", totalIncBtw: 100, dueDate: "2026-08-01" }),
      inv({ id: "b", supplierKey: "groot", supplierName: "Groot", totalIncBtw: 900, dueDate: "2026-08-10" }),
      inv({ id: "c", supplierKey: "groot", supplierName: "Groot", totalIncBtw: 500, dueDate: "2026-07-01" }),
    ],
  });
  assert.deepEqual(r.suppliers.map((s) => s.name), ["Groot", "Klein"], "a payment order, read top-down");
  assert.deepEqual(r.suppliers[0].invoices.map((i) => i.id), ["c", "b"], "the one being chased is on top");
});
