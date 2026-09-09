// npx tsx --test src/lib/opdrachtgevers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { opdrachtgeverYear } from "./opdrachtgevers";

const iv = (over: Partial<Parameters<typeof opdrachtgeverYear>[0]["invoices"][number]> = {}) => ({
  client_id: "k1", client_name: "Bakker BV", total_ex_btw: 1000, invoice_date: "2026-03-01", ...over,
});

test("revenue, share and the count come from the invoices themselves", () => {
  const y = opdrachtgeverYear({
    year: 2026,
    invoices: [iv(), iv({ total_ex_btw: 3000, invoice_date: "2026-06-01" }), iv({ client_id: "k2", client_name: "Gemeente", total_ex_btw: 1000 })],
    hours: [{ client_id: "k1", hours: 40 }, { client_id: "k1", hours: 2.5 }, { client_id: "k2", hours: 8 }],
  });
  assert.equal(y.revenue, 5000);
  assert.equal(y.clients, 2);
  assert.deepEqual(y.rows.map((r) => [r.name, r.revenue, r.share, r.hours, r.invoices]), [
    ["Bakker BV", 4000, 80, 42.5, 2],
    ["Gemeente", 1000, 20, 8, 1],
  ]);
  assert.equal(y.largestShare, 80);
  assert.equal(y.rows[0].firstInvoice, "2026-03-01");
  assert.equal(y.rows[0].lastInvoice, "2026-06-01");
});

test("a creditnota nets against the client it credits, never as a client of its own", () => {
  const y = opdrachtgeverYear({
    year: 2026,
    invoices: [iv({ total_ex_btw: 1000 }), iv({ total_ex_btw: -250 })],
    hours: [],
  });
  assert.equal(y.clients, 1);
  assert.equal(y.rows[0].revenue, 750);
});

test("an invoice without a client link is paired on its name, folded like everywhere else", () => {
  const y = opdrachtgeverYear({
    year: 2026,
    invoices: [iv({ client_id: null, client_name: "Café D'Oude Sluis" }), iv({ client_id: null, client_name: "café d'oude sluis" })],
    hours: [],
  });
  assert.equal(y.clients, 1, "one opdrachtgever, written twice");
  assert.equal(y.rows[0].revenue, 2000);
});

test("no revenue means no percentages — never a share of zero or of a negative year", () => {
  const empty = opdrachtgeverYear({ year: 2026, invoices: [], hours: [] });
  assert.deepEqual([empty.revenue, empty.clients, empty.largestShare], [0, 0, null]);
  const negative = opdrachtgeverYear({ year: 2026, invoices: [iv({ total_ex_btw: -100 })], hours: [] });
  assert.equal(negative.largestShare, null, "a share against a negative total means nothing");
});

test("an invoice with an unreadable amount is skipped, not counted as zero", () => {
  const y = opdrachtgeverYear({ year: 2026, invoices: [iv(), iv({ total_ex_btw: null })], hours: [] });
  assert.equal(y.rows[0].invoices, 1, "only the invoice we could read");
});
