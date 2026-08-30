// src/lib/supplier-balance-copy.test.ts
// [LEVERANCIER-SALDO] Pure node test — run: npx tsx --test src/lib/supplier-balance-copy.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { buildCorroborationPanel, buildSupplierBalancePanel } from "./supplier-balance-copy";
import { supplierBalances, type SupplierInvoiceRow } from "./supplier-balances";
import { corroboratePayments, type PaymentClaim } from "./payment-corroboration";

const TODAY = "2026-08-30";

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

function claim(over: Partial<PaymentClaim>): PaymentClaim {
  return {
    invoiceId: over.invoiceId ?? "i1",
    invoiceNumber: over.invoiceNumber ?? "2034488",
    supplierName: over.supplierName ?? "CAN Vleesgroothandel B.V.",
    supplierKey: over.supplierKey === undefined ? "can" : over.supplierKey,
    amountApplied: over.amountApplied ?? 1165.73,
    paidOn: over.paidOn === undefined ? "2026-08-17" : over.paidOn,
    method: over.method === undefined ? "bank" : over.method,
    transactionId: over.transactionId === undefined ? null : over.transactionId,
  };
}

// ─── The balance panel ────────────────────────────────────────────────────────────────────────

test("[LEVERANCIER-SALDO] the panel prints the supplier's own subtotal, with its date", () => {
  const panel = buildSupplierBalancePanel(
    supplierBalances({
      asOf: TODAY,
      settlements: [],
      invoices: [
        inv({ id: "a", invoiceNumber: "2034488", dueDate: "2026-08-29", totalIncBtw: 1165.73 }),
        inv({ id: "b", invoiceNumber: "2034534", invoiceDate: "2026-08-22", dueDate: "2026-09-05", totalIncBtw: 1217.92 }),
      ],
    }),
    "nl", TODAY,
  );
  assert.equal(panel.totaal, "€ 2.383,65");
  assert.equal(panel.peildatum, "Stand op 30-08-2026",
    "an amount without its date is not a fact — the line is never optional");
  assert.equal(panel.leveranciers.length, 1);
  assert.equal(panel.leveranciers[0].aantal, "2 facturen");
  assert.equal(panel.leveranciers[0].vervallen, "waarvan € 1.165,73 vervallen");
  assert.equal(panel.leveranciers[0].oudste, "oudste vervaldatum 29-08-2026");
  assert.equal(panel.leeg, null);
});

test("[LEVERANCIER-SALDO] one invoice is not '1 facturen'", () => {
  const p = buildSupplierBalancePanel(
    supplierBalances({ asOf: TODAY, settlements: [], invoices: [inv({})] }), "nl", TODAY);
  assert.equal(p.leveranciers[0].aantal, "1 factuur");
});

test("[LEVERANCIER-SALDO] a today's-figure under a past date says so, and only then", () => {
  // The dangerous case this warning exists for: the screen asks for 31 December and prints today's
  // number under it. Firing the warning when the date IS today would train the owner to ignore it.
  const past = buildSupplierBalancePanel(
    supplierBalances({ asOf: "2026-01-31", invoices: [inv({ invoiceDate: "2026-01-05", dueDate: "2026-01-19" })] }),
    "nl", TODAY);
  assert.ok(past.basisWaarschuwing, "an earlier date on a 'huidig' basis is warned about");
  assert.match(past.basisWaarschuwing!, /stand van nu/);

  const now = buildSupplierBalancePanel(
    supplierBalances({ asOf: TODAY, invoices: [inv({})] }), "nl", TODAY);
  assert.equal(now.basisWaarschuwing, null, "today on a 'huidig' basis is the same answer");

  const dated = buildSupplierBalancePanel(
    supplierBalances({ asOf: "2026-01-31", settlements: [], invoices: [inv({ invoiceDate: "2026-01-05" })] }),
    "nl", TODAY);
  assert.equal(dated.basisWaarschuwing, null, "with dated settlements the peildatum is real");
});

test("[LEVERANCIER-SALDO] an empty balance is a SENTENCE, never an empty list", () => {
  const p = buildSupplierBalancePanel(
    supplierBalances({ asOf: TODAY, settlements: [], invoices: [] }), "nl", TODAY);
  assert.equal(p.leveranciers.length, 0);
  assert.equal(p.leeg, "Er staat op dit moment niets open bij een leverancier.");
  assert.equal(p.totaal, "€ 0,00");
});

test("[LEVERANCIER-SALDO] the aging table drops the empty buckets and keeps the rest", () => {
  const p = buildSupplierBalancePanel(
    supplierBalances({
      asOf: TODAY, settlements: [],
      invoices: [
        inv({ id: "a", dueDate: "2026-09-10", totalIncBtw: 100, invoiceDate: "2026-08-01" }),
        inv({ id: "b", dueDate: "2026-01-20", totalIncBtw: 600, invoiceDate: "2026-01-06" }),
      ],
    }), "nl", TODAY);
  assert.deepEqual(p.ouderdom.map((r) => r.label), ["Nog niet vervallen", "90+"]);
  assert.deepEqual(p.ouderdom.map((r) => r.vervallen), [false, true]);
  assert.equal(p.ouderdom[1].bedrag, "€ 600,00");
});

test("[LEVERANCIER-SALDO] the counted-but-not-added figures get their own sentences", () => {
  const p = buildSupplierBalancePanel(
    supplierBalances({
      asOf: TODAY, settlements: [],
      invoices: [
        inv({ id: "a", totalIncBtw: 600 }),
        inv({ id: "b", totalIncBtw: 9999, status: "processing" }),
        inv({ id: "c", supplierKey: null, totalIncBtw: 400 }),
      ],
    }), "nl", TODAY);
  assert.match(p.onbevestigd!, /wachten 1 inkoopfacturen nog op je bevestiging/);
  assert.match(p.zonderLeverancier!, /€ 400,00/);
  assert.equal(p.totaal, "€ 1.000,00", "the unkeyed money is IN the total, just not on a line");
});

// ─── The corroboration panel ──────────────────────────────────────────────────────────────────

test("[BETAALD-MAAR-WAAR] the live case leads, and it is phrased as a fact about OUR data", () => {
  // Invoice 2034488: ticked paid on 29 August against bank data ending 21 August, while the
  // wholesaler's ledger had it open and overdue. The sentence may not accuse the owner of
  // anything — the app has no evidence about the payment, only about its own reach.
  const panel = buildCorroborationPanel(
    corroboratePayments({
      claims: [claim({ paidOn: "2026-08-29" })],
      debits: [],
      coverage: { from: "2026-01-01", to: "2026-08-21" },
    }), "nl")!;
  assert.equal(panel.regels.length, 1);
  assert.match(panel.regels[0], /ná je nieuwste bankafschrift \(21-08-2026\)/);
  assert.match(panel.regels[0], /1 factuur afgevinkt/, "one is not '1 facturen'");
  assert.doesNotMatch(panel.regels[0], /klopt niet|onjuist|fout/,
    "it states what we cannot see, never what the owner did wrong");
  assert.equal(panel.allesKlopt, false);
});

test("[BETAALD-MAAR-WAAR] a real gap names the supplier, both figures and the difference", () => {
  const panel = buildCorroborationPanel(
    corroboratePayments({
      claims: [claim({ supplierKey: "bal", supplierName: "GROOTHANDEL M.H. BAL V.O.F.", amountApplied: 2000, paidOn: "2026-08-05" })],
      debits: [{ supplierKey: "bal", date: "2026-08-05", amount: 1200 }],
      coverage: { from: "2026-01-01", to: "2026-08-21" },
    }), "nl")!;
  assert.match(panel.regels[0], /€ 2\.000,00/);
  assert.match(panel.regels[0], /GROOTHANDEL M\.H\. BAL/);
  assert.match(panel.regels[0], /€ 1\.200,00/);
  assert.match(panel.regels[0], /Verschil: € 800,00/);
});

test("[BETAALD-MAAR-WAAR] 'everything checks out' is a sentence, and it is not the same as silence", () => {
  // Silence would be indistinguishable from "we did not look". Both states exist and both are said.
  const covered = buildCorroborationPanel(
    corroboratePayments({
      claims: [claim({ paidOn: "2026-08-05", amountApplied: 1000 })],
      debits: [{ supplierKey: "can", date: "2026-08-05", amount: 1000 }],
      coverage: { from: "2026-01-01", to: "2026-08-21" },
    }), "nl")!;
  assert.equal(covered.allesKlopt, true);
  assert.equal(covered.regels.length, 0);
  assert.match(covered.klopt!, /past binnen wat er in die periode van je rekening is gegaan/);

  const nothing = buildCorroborationPanel(
    corroboratePayments({ claims: [], debits: [], coverage: { from: "2026-01-01", to: "2026-08-21" } }), "nl");
  assert.equal(nothing, null, "no hand-ticked payment at all → no panel, which is a third state");
});

test("[BETAALD-MAAR-WAAR] history does not bury the live case", () => {
  const panel = buildCorroborationPanel(
    corroboratePayments({
      claims: [
        claim({ invoiceId: "live", paidOn: "2026-08-29" }),
        ...Array.from({ length: 60 }, (_, i) => claim({ invoiceId: `oud${i}`, paidOn: "2025-06-01" })),
      ],
      debits: [],
      coverage: { from: "2026-01-01", to: "2026-08-21" },
    }), "nl")!;
  assert.match(panel.regels[0], /ná je nieuwste bankafschrift/, "the live one is first");
  assert.equal(panel.regels.length, 2, "sixty old ones collapse into one sentence");
  assert.match(panel.regels[1], /60 afgevinkte betalingen liggen vóór je oudste afschrift/);
});

test("[BETAALD-MAAR-WAAR] with no statement at all the panel says exactly that", () => {
  const panel = buildCorroborationPanel(
    corroboratePayments({ claims: [claim({})], debits: [], coverage: { from: null, to: null } }), "nl")!;
  assert.match(panel.regels[0], /nog geen bankafschrift ingelezen/);
  assert.equal(panel.allesKlopt, false, "not checked is never the same as checked and fine");
});

// ─── Language ─────────────────────────────────────────────────────────────────────────────────

test("[TAAL] the panels translate, carry their direction, and leak no key", () => {
  const balance = supplierBalances({ asOf: TODAY, settlements: [], invoices: [inv({})] });
  const corro = corroboratePayments({
    claims: [claim({ paidOn: "2026-08-29" })], debits: [],
    coverage: { from: "2026-01-01", to: "2026-08-21" },
  });

  for (const locale of ["nl", "en", "ar", "tr"] as const) {
    const b = buildSupplierBalancePanel(balance, locale, TODAY);
    const c = buildCorroborationPanel(corro, locale)!;
    const words = [b.heading, b.totaalLabel, b.peildatum, b.ouderdomKop, ...b.leveranciers.map((l) => l.aantal),
                   c.heading, ...c.regels];
    for (const w of words) {
      assert.ok(w.length > 0, `empty string in ${locale}`);
      // A dotted identifier with no whitespace is a key that escaped the catalogue. The test is
      // shaped that way on purpose: legitimate Dutch sentences contain dots, and "betaalcheck."
      // at the end of one is not a leak.
      assert.doesNotMatch(w, /(^|\s)[a-z][a-zA-Z]*\.[a-zA-Z]+\.[a-zA-Z]+(\s|$)/, `key leaked in ${locale}: ${w}`);
    }
    assert.equal(b.dir, locale === "ar" ? "rtl" : "ltr");
    assert.equal(c.dir, b.dir);
  }

  // Arabic is a real translation, not the Dutch fallback, on the sentences that matter most.
  const ar = buildCorroborationPanel(corro, "ar")!;
  assert.doesNotMatch(ar.regels[0], /bankafschrift/);
});
