// [BETAALVERZOEK] Pure node test — run: npx tsx src/lib/betaalverzoek.test.ts
// Locks the payability guards (only a real, unpaid, outgoing invoice with a valid
// owner IBAN → a QR) and, critically, the public-projection ALLOWLIST: the /pay
// page must never receive client email/address/BTW or internal ids.
import { buildBetaalverzoek, toPublicPayView, type BetaalverzoekInvoice, type BetaalverzoekOwner } from "./betaalverzoek";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const OWNER: BetaalverzoekOwner = { iban: "NL91ABNA0417164300", company_name: "Kiwi Food Market", full_name: "Basil Ibrahim" };
function inv(p: Partial<BetaalverzoekInvoice>): BetaalverzoekInvoice {
  return {
    id: "inv-1", direction: "outgoing", invoice_type: "factuur", status: "sent",
    invoice_number: "2026-014", payment_reference: null, total_inc_btw: 121.0,
    client_name: "Jansen BV", pay_token: null, due_date: "2026-08-01", ...p,
  };
}

console.log("\n— buildBetaalverzoek: the happy path —");
{
  const r = buildBetaalverzoek(inv({}), OWNER);
  check("ok for a sent outgoing factuur", r.ok);
  check("beneficiary = company name (owner, not client)", r.beneficiaryName === "Kiwi Food Market");
  check("iban is the owner's, canonicalized", r.iban === "NL91ABNA0417164300");
  check("amount = total incl BTW", r.amount === 121);
  check("reference = invoice number (lands in the reconciliation loop)", r.reference === "2026-014");
  check("EPC payload carries the invoice number as remittance", (r.epcPayload ?? "").includes("2026-014"));
  check("EPC payload beneficiary is the OWNER", (r.epcPayload ?? "").includes("Kiwi Food Market"));
}

console.log("\n— payment_reference wins over invoice number —");
check("betalingskenmerk takes precedence", buildBetaalverzoek(inv({ payment_reference: "KENM-9" }), OWNER).reference === "KENM-9");

console.log("\n— guards: what must be REFUSED (no false QR) —");
check("draft refused (no legal number yet)", !buildBetaalverzoek(inv({ status: "draft" }), OWNER).ok);
check("already paid refused", !buildBetaalverzoek(inv({ status: "paid" }), OWNER).ok);
check("incoming invoice refused", !buildBetaalverzoek(inv({ direction: "incoming" }), OWNER).ok);
check("offerte/pro_forma refused", !buildBetaalverzoek(inv({ invoice_type: "pro_forma" }), OWNER).ok);
check("negative amount (creditnota) refused", !buildBetaalverzoek(inv({ invoice_type: "creditnota", total_inc_btw: -50 }), OWNER).ok);
check("zero amount refused", !buildBetaalverzoek(inv({ total_inc_btw: 0 }), OWNER).ok);
check("missing owner IBAN → helpful error, no QR", (() => { const r = buildBetaalverzoek(inv({}), { ...OWNER, iban: null }); return !r.ok && /IBAN/i.test(r.error ?? ""); })());
check("invalid owner IBAN refused", !buildBetaalverzoek(inv({}), { ...OWNER, iban: "NL00BANK0000000000" }).ok);
check("missing beneficiary name refused", !buildBetaalverzoek(inv({}), { ...OWNER, company_name: null, full_name: null }).ok);
check("falls back to full_name when no company", buildBetaalverzoek(inv({}), { ...OWNER, company_name: null }).beneficiaryName === "Basil Ibrahim");

console.log("\n— toPublicPayView: the ALLOWLIST (security boundary) —");
{
  // A row that ALSO carries sensitive fields the public view must never surface.
  const rowWithSecrets = {
    ...inv({}),
    // Intentionally add fields not in the interface to prove they're dropped by the projection.
    client_email: "jansen@example.com", client_address: "Kerkstraat 1", client_btw_number: "NL0011",
    sender_id: "owner-uuid", receiver_id: "x",
  } as BetaalverzoekInvoice;
  const view = toPublicPayView(rowWithSecrets, OWNER);
  check("payable invoice → a view", view !== null);
  const keys = view ? Object.keys(view) : [];
  const allowed = ["invoiceNumber", "clientName", "beneficiaryName", "iban", "amount", "reference", "status", "dueDate", "epcPayload", "alreadyPaid"];
  check("view exposes ONLY the allowlisted keys", keys.every((k) => allowed.includes(k)) && keys.length === allowed.length);
  const blob = JSON.stringify(view);
  check("no client email leaks", !blob.includes("jansen@example.com"));
  check("no client address leaks", !blob.includes("Kerkstraat"));
  check("no client BTW leaks", !blob.includes("NL0011"));
  check("no internal ids leak (sender_id/receiver_id/id)", !blob.includes("owner-uuid") && !/"id"\s*:/.test(blob));
  check("client name IS shown (for recognition)", view?.clientName === "Jansen BV");
}

console.log("\n— toPublicPayView: paid + non-payable —");
{
  const paid = toPublicPayView(inv({ status: "paid" }), OWNER);
  check("paid invoice still renders, flagged alreadyPaid", paid !== null && paid.alreadyPaid === true);
  check("draft → null (404, no existence leak)", toPublicPayView(inv({ status: "draft" }), OWNER) === null);
  check("no owner IBAN → null (can't build a safe view)", toPublicPayView(inv({}), { ...OWNER, iban: null }) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
