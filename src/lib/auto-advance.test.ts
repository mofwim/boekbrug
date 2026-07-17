// [AUTO-ADVANCE] Pure node test — run: npx tsx src/lib/auto-advance.test.ts
// The bar for auto-booking without a human is HIGH. These tests pin exactly when an invoice may
// skip the verify tap — and, more importantly, every case where it must NOT.
import { shouldAutoAdvanceInvoice, type AutoAdvanceSignals } from "./auto-advance";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A perfectly-read, arithmetic-clean, high-confidence ordinary invoice.
const clean = (over: Partial<AutoAdvanceSignals> = {}): AutoAdvanceSignals => ({
  is_invoice: true,
  is_statement: false,
  is_reminder: false,
  is_credit_note: false,
  document_kind: "invoice",
  invoice_type: "factuur",
  confidence: 0.95,
  health: {
    total_ex_btw: 100,
    btw_amount: 21,
    total_inc_btw: 121,
    invoice_date: "2026-05-10",
    invoice_number: "2026-0042",
    invoice_type: "factuur",
    field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 },
  },
  ...over,
});

console.log("\n— a clean, confident, ordinary invoice ADVANCES —");
{
  const d = shouldAutoAdvanceInvoice(clean());
  check("advance = true", d.advance === true);
  check("reason names it clean", d.reason === "clean_high_confidence");
}

console.log("\n— never auto-book a statement / reminder / creditnota —");
{
  check("statement flag → blocked", shouldAutoAdvanceInvoice(clean({ is_statement: true })).advance === false);
  check("reminder flag → blocked", shouldAutoAdvanceInvoice(clean({ is_reminder: true })).advance === false);
  check("credit-note flag → blocked", shouldAutoAdvanceInvoice(clean({ is_credit_note: true })).advance === false);
  check("invoice_type creditnota → blocked", shouldAutoAdvanceInvoice(clean({ invoice_type: "creditnota", health: { ...clean().health, invoice_type: "creditnota" } })).advance === false);
  check("document_kind statement → blocked", shouldAutoAdvanceInvoice(clean({ document_kind: "statement" })).advance === false);
}

console.log("\n— never auto-book an ambiguous read (needs-review) —");
{
  check("missing total → blocked", shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, total_inc_btw: null } })).advance === false);
  check("€0 total → blocked", shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, total_inc_btw: 0 } })).advance === false);
  check("arithmetic mismatch (ex+btw≠inc) → blocked",
    shouldAutoAdvanceInvoice(clean({ health: { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 200, invoice_date: "2026-05-10", invoice_number: "X1", invoice_type: "factuur", field_confidence: null } })).advance === false);
  check("missing date → blocked", shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, invoice_date: null } })).advance === false);
  check("missing/placeholder number → blocked", shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, invoice_number: "EMAIL-1717000000000" } })).advance === false);
}

console.log("\n— confidence bar is HIGHER than the 0.7 review line —");
{
  // 0.75 would pass import-health's 0.7 'clean' but must NOT auto-book (below HIGH_CONF 0.8).
  const d = shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, field_confidence: { vendor: 0.75, invoice_number: 0.95, invoice_date: 0.95, amount: 0.95 } } }));
  check("a 0.75 field score → blocked (below the high bar)", d.advance === false && d.reason === "confidence_below_high_bar");
  check("low overall confidence → blocked", shouldAutoAdvanceInvoice(clean({ confidence: 0.5 })).advance === false);
  check("is_invoice false → blocked", shouldAutoAdvanceInvoice(clean({ is_invoice: false })).advance === false);
}

console.log("\n— a clean invoice with NO per-field scores still advances (missing = confident, like the badge) —");
{
  const d = shouldAutoAdvanceInvoice(clean({ health: { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121, invoice_date: "2026-05-10", invoice_number: "2026-9", invoice_type: "factuur", field_confidence: null } }));
  check("no field_confidence + clean amounts → advance", d.advance === true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
