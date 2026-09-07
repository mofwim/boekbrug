// src/lib/asset-candidates.test.ts — run: npx tsx --test src/lib/asset-candidates.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assetCandidates, RARE_SUPPLIER_MAX_INVOICES, type CandidateInvoiceRow } from "./asset-candidates";

const row = (o: Partial<CandidateInvoiceRow> & { id: string }): CandidateInvoiceRow => ({
  invoice_date: "2026-05-27", invoice_number: null, client_name: "X", supplier_id: null,
  total_ex_btw: 1000, total_inc_btw: 1210, invoice_type: "factuur", status: "paid", ...o,
});
const none = { registered: new Set<string>(), dismissed: new Set<string>() };

test("[BEDRIJFSMIDDEL] the weekly wholesaler is never asked about, the one-off equipment supplier is", () => {
  const rows: CandidateInvoiceRow[] = [
    ...Array.from({ length: 34 }, (_, i) => row({ id: `hvo${i}`, client_name: "HVO Meat", supplier_id: "hvo", total_ex_btw: 2500, total_inc_btw: 2725 })),
    row({ id: "rama", client_name: "HorecaRama BV", total_ex_btw: 756, total_inc_btw: 914.76 }),
    row({ id: "small", client_name: "Bakkerij", total_ex_btw: 120, total_inc_btw: 130.8 }),
  ];
  const c = assetCandidates(rows, { btwDeductible: true, ...none });
  assert.deepEqual(c.map((x) => x.invoiceId), ["rama"]);
  assert.equal(c[0].amount, 756);
  assert.equal(c[0].supplierInvoices, 1);
  assert.equal(RARE_SUPPLIER_MAX_INVOICES, 2);
});

test("[BEDRIJFSMIDDEL] a registered or dismissed invoice, a creditnota, and an unverified row are not candidates", () => {
  const rows = [
    row({ id: "a" }), row({ id: "b" }),
    row({ id: "cn", invoice_type: "creditnota", total_ex_btw: -1000, total_inc_btw: -1210 }),
    row({ id: "q", status: "processing" }),
  ];
  const c = assetCandidates(rows, { btwDeductible: true, registered: new Set(["a"]), dismissed: new Set(["b"]) });
  assert.deepEqual(c, []);
});

test("[BEDRIJFSMIDDEL] the threshold follows the btw regime", () => {
  const r = row({ id: "x", total_ex_btw: 400, total_inc_btw: 484 });
  assert.equal(assetCandidates([r], { btwDeductible: true, ...none }).length, 0, "€ 400 ex is under the line when btw is deducted");
  assert.equal(assetCandidates([r], { btwDeductible: false, ...none }).length, 1, "€ 484 incl is over it when btw is not deducted");
});

test("[BEDRIJFSMIDDEL] suppliers are counted by id first, then by name; two invoices is still rare, three is not", () => {
  const rows = [
    row({ id: "1", client_name: "Enka Horeca", supplier_id: "enka" }),
    row({ id: "2", client_name: "ENKA HORECA B.V.", supplier_id: "enka" }),
    row({ id: "3", client_name: "Enka horeca", supplier_id: "enka", total_ex_btw: 300, total_inc_btw: 363 }),
    row({ id: "4", client_name: "Metro", supplier_id: null }),
    row({ id: "5", client_name: "metro ", supplier_id: null }),
  ];
  const c = assetCandidates(rows, { btwDeductible: true, ...none }).map((x) => x.invoiceId);
  assert.deepEqual(c.sort(), ["4", "5"], "Enka has three invoices → a regular supplier; Metro two → asked");
});
