// [BUNDEL-BETAALVERZOEK] Pure node test — run: npx tsx src/lib/betaalverzoek-bundel.test.ts
import {
  buildBundelBetaalverzoek,
  toPublicBundlePayView,
  MAX_BUNDLE_INVOICES,
  type BetaalverzoekInvoice,
  type BetaalverzoekOwner,
} from "./betaalverzoek";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const OWNER: BetaalverzoekOwner = {
  iban: "NL91ABNA0417164300",
  company_name: "Test BV",
  full_name: "Jan Test",
};

function inv(over: Partial<BetaalverzoekInvoice> = {}): BetaalverzoekInvoice {
  return {
    id: over.id ?? "00000000-0000-0000-0000-000000000001",
    direction: "outgoing",
    invoice_type: "factuur",
    status: "sent",
    invoice_number: "2026-001",
    payment_reference: null,
    total_inc_btw: 121,
    client_name: "Klant BV",
    pay_token: null,
    due_date: "2026-08-01",
    amount_paid: 0,
    ...over,
  };
}

console.log("\n— buildBundelBetaalverzoek —");
{
  const r = buildBundelBetaalverzoek(
    [inv({ id: "a", invoice_number: "2026-001", total_inc_btw: 121 }),
     inv({ id: "b", invoice_number: "2026-002", total_inc_btw: 60.5 })],
    OWNER
  );
  check("two open invoices build ok", r.ok === true);
  check("amount = sum of totals", r.amount === 181.5);
  check("reference lists every number", r.reference === "2026-001, 2026-002");
  check("EPC payload carries the sum", !!r.epcPayload && r.epcPayload.includes("EUR181.50"));
  check("items carry per-invoice amounts", r.items?.length === 2 && r.items[1].amount === 60.5);
}
{
  const r = buildBundelBetaalverzoek(
    [inv({ id: "a", total_inc_btw: 1000, amount_paid: 400, invoice_number: "2026-010" }),
     inv({ id: "b", invoice_number: "2026-011", total_inc_btw: 100 })],
    OWNER
  );
  check("partially paid invoice asks only the open rest", r.ok === true && r.amount === 700);
}
check("single invoice rejected", buildBundelBetaalverzoek([inv()], OWNER).ok === false);
check("over the cap rejected", buildBundelBetaalverzoek(
  Array.from({ length: MAX_BUNDLE_INVOICES + 1 }, (_, i) => inv({ id: `x${i}`, invoice_number: `2026-${i}` })),
  OWNER
).ok === false);
check("mixed clients rejected", buildBundelBetaalverzoek(
  [inv({ id: "a" }), inv({ id: "b", client_name: "Andere Klant" })], OWNER
).ok === false);
check("same client, different casing accepted", buildBundelBetaalverzoek(
  [inv({ id: "a" }), inv({ id: "b", invoice_number: "2026-002", client_name: " klant bv " })], OWNER
).ok === true);
check("draft in the set rejected", buildBundelBetaalverzoek(
  [inv({ id: "a" }), inv({ id: "b", status: "draft" })], OWNER
).ok === false);
check("paid invoice in the set rejected", buildBundelBetaalverzoek(
  [inv({ id: "a" }), inv({ id: "b", status: "paid" })], OWNER
).ok === false);
check("creditnota in the set rejected", buildBundelBetaalverzoek(
  [inv({ id: "a" }), inv({ id: "b", invoice_type: "creditnota", total_inc_btw: -50 })], OWNER
).ok === false);
check("incoming invoice rejected", buildBundelBetaalverzoek(
  [inv({ id: "a" }), inv({ id: "b", direction: "incoming" })], OWNER
).ok === false);
check("fully covered invoice (open = 0) rejected", buildBundelBetaalverzoek(
  [inv({ id: "a" }), inv({ id: "b", total_inc_btw: 100, amount_paid: 100 })], OWNER
).ok === false);
check("missing owner IBAN rejected", buildBundelBetaalverzoek(
  [inv({ id: "a" }), inv({ id: "b", invoice_number: "2026-002" })],
  { iban: null, company_name: "Test BV", full_name: null }
).ok === false);

console.log("\n— toPublicBundlePayView —");
{
  const v = toPublicBundlePayView(
    [inv({ id: "a", invoice_number: "2026-001", total_inc_btw: 121 }),
     inv({ id: "b", invoice_number: "2026-002", total_inc_btw: 60.5, due_date: "2026-07-15" })],
    OWNER
  );
  check("open bundle renders", v !== null);
  check("amount = open sum", v?.amount === 181.5);
  check("earliest due date wins", v?.dueDate === "2026-07-15");
  check("two items", v?.items.length === 2);
  check("not alreadyPaid", v?.alreadyPaid === false);
}
{
  const v = toPublicBundlePayView(
    [inv({ id: "a", invoice_number: "2026-001", total_inc_btw: 121, status: "paid" }),
     inv({ id: "b", invoice_number: "2026-002", total_inc_btw: 60.5 })],
    OWNER
  );
  check("paid sibling drops out of the amount", v?.amount === 60.5);
  check("paid sibling marked in items", v?.items[0].alreadyPaid === true);
  check("reference quotes only the open invoice", v?.reference === "2026-002");
}
{
  const v = toPublicBundlePayView(
    [inv({ id: "a", status: "paid" }),
     inv({ id: "b", invoice_number: "2026-002", status: "paid", total_inc_btw: 60.5 })],
    OWNER
  );
  check("all paid → alreadyPaid banner view", v?.alreadyPaid === true);
  check("all paid → settled sum shown, not €0", v?.amount === 181.5);
}
check("draft in bundle → null (404)", toPublicBundlePayView(
  [inv({ id: "a" }), inv({ id: "b", status: "draft" })], OWNER
) === null);
check("no invoices → null", toPublicBundlePayView([], OWNER) === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
