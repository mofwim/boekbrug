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
  totalIncBtw: 121,
  forcedDuplicate: false,
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

console.log("\n— [BTW-GATE] a zero BTW auto-books ONLY when the read is explicitly 0% —");
{
  // 21% invoice misread as ex==incl, btw 0: arithmetic passes (100+0=100... here 121+0), but the
  // voorbelasting is silently zeroed → must be held for a human, not auto-booked.
  const zeroBtw = { total_ex_btw: 121, btw_amount: 0, total_inc_btw: 121, invoice_date: "2026-05-10", invoice_number: "2026-0042", invoice_type: "factuur", field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 } };
  const missingRate = shouldAutoAdvanceInvoice(clean({ health: { ...zeroBtw }, btwRate: null }));
  check("zero btw + no explicit rate → blocked", missingRate.advance === false && missingRate.reason === "zero_btw_not_explicit_zero_rate");
  check("zero btw + rate 21 (inconsistent) → blocked", shouldAutoAdvanceInvoice(clean({ health: { ...zeroBtw }, btwRate: 21 })).advance === false);
  // A genuine 0%/vrijgesteld invoice (explicit rate 0) still auto-advances.
  check("zero btw + explicit rate 0 → advances", shouldAutoAdvanceInvoice(clean({ health: { ...zeroBtw }, btwRate: 0 })).advance === true);
  // A normal invoice with real btw is unaffected (regardless of the rate field).
  check("non-zero btw + null rate → advances (unaffected)", shouldAutoAdvanceInvoice(clean({ btwRate: null })).advance === true);
}

console.log("\n— confidence bar is HIGHER than the 0.7 review line —");
{
  // 0.75 would pass import-health's 0.7 'clean' but must NOT auto-book (below HIGH_CONF 0.8).
  const d = shouldAutoAdvanceInvoice(clean({ health: { ...clean().health, field_confidence: { vendor: 0.75, invoice_number: 0.95, invoice_date: 0.95, amount: 0.95 } } }));
  check("a 0.75 field score → blocked (below the high bar)", d.advance === false && d.reason === "field_confidence_below_high_bar");
  check("low overall confidence → blocked", shouldAutoAdvanceInvoice(clean({ confidence: 0.5 })).advance === false);
  check("is_invoice false → blocked", shouldAutoAdvanceInvoice(clean({ is_invoice: false })).advance === false);
}

console.log("\n— [FIX] fail-CLOSED on missing signals (the review found these holes) —");
{
  // A null overall confidence must NOT advance (was fail-open).
  check("null overall confidence → blocked", shouldAutoAdvanceInvoice(clean({ confidence: null })).advance === false);
  check("undefined overall confidence → blocked", shouldAutoAdvanceInvoice(clean({ confidence: undefined })).advance === false);
  // No real gross (only an 'amount' fallback would have priced it) → blocked.
  check("no reliable total_inc_btw → blocked", shouldAutoAdvanceInvoice(clean({ totalIncBtw: null })).advance === false);
  check("zero total_inc_btw → blocked", shouldAutoAdvanceInvoice(clean({ totalIncBtw: 0 })).advance === false);
  // A duplicate the owner forced past the warning must never auto-book.
  check("forced duplicate → blocked", shouldAutoAdvanceInvoice(clean({ forcedDuplicate: true })).advance === false);
}

console.log("\n— [FIX] missing amount confidence does NOT skip the money gate —");
{
  // No amount score present + only ordinary overall confidence → blocked (must be VERY high).
  const noAmt = { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99 };
  const d = shouldAutoAdvanceInvoice(clean({ confidence: 0.8, health: { ...clean().health, field_confidence: noAmt } }));
  check("no amount score + overall 0.8 → blocked", d.advance === false && d.reason === "no_amount_confidence_and_overall_not_very_high");
  // No amount score but VERY high overall (≥0.9) → allowed.
  const d2 = shouldAutoAdvanceInvoice(clean({ confidence: 0.95, health: { ...clean().health, field_confidence: noAmt } }));
  check("no amount score + overall 0.95 → advance", d2.advance === true);
  // An amount score BETWEEN the review line (0.7) and the HIGH bar (0.8) passes health but must
  // be blocked by the auto-book money gate.
  const d3 = shouldAutoAdvanceInvoice(clean({ confidence: 0.99, health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.75 } } }));
  check("amount score 0.75 → blocked by the high money gate", d3.advance === false && d3.reason === "amount_confidence_below_high_bar");
  // A clearly-low amount score (below 0.7) is caught earlier by health → needs_review (still blocked).
  const d4 = shouldAutoAdvanceInvoice(clean({ confidence: 0.99, health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.6 } } }));
  check("amount score 0.6 → blocked (by health needs_review)", d4.advance === false);
}

console.log("\n— [FIND-GAP] a HIGH amount score must not mask a LOW gross (total_inc_btw) score —");
{
  // The bug: `.find` took the FIRST present of [amount, total, total_inc_btw]. A high `amount` (0.96)
  // masked a below-HIGH `total_inc_btw` (0.75) — and total_inc_btw is the value that actually becomes
  // the booked gross. 0.75 sits in the [0.7 health line, 0.8 high bar) band: health passes it, so the
  // ONLY thing that can catch it is this money gate. Now the MINIMUM of present money scores must
  // clear the high bar (fail-closed), so the low gross score is no longer masked by the high amount.
  const masked = shouldAutoAdvanceInvoice(clean({ confidence: 0.99, health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, total_inc_btw: 0.75 } } }));
  check("high amount + below-HIGH total_inc_btw → blocked (min money score gate)", masked.advance === false && masked.reason === "amount_confidence_below_high_bar");
  // Same with a below-HIGH `total` behind a high `amount`.
  const maskedTotal = shouldAutoAdvanceInvoice(clean({ confidence: 0.99, health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.95, total: 0.75 } } }));
  check("high amount + below-HIGH total → blocked", maskedTotal.advance === false && maskedTotal.reason === "amount_confidence_below_high_bar");
  // All money scores high → still advances (no false block).
  const allHigh = shouldAutoAdvanceInvoice(clean({ confidence: 0.99, health: { ...clean().health, field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96, total: 0.95, total_inc_btw: 0.92 } } }));
  check("all money scores high → advances", allHigh.advance === true);
}

console.log("\n— a clean invoice with NO per-field scores needs VERY-high overall (no free pass) —");
{
  const d = shouldAutoAdvanceInvoice(clean({ confidence: 0.95, health: { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121, invoice_date: "2026-05-10", invoice_number: "2026-9", invoice_type: "factuur", field_confidence: null } }));
  check("no field_confidence + very-high overall + clean amounts → advance", d.advance === true);
  const d2 = shouldAutoAdvanceInvoice(clean({ confidence: 0.72, health: { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121, invoice_date: "2026-05-10", invoice_number: "2026-9", invoice_type: "factuur", field_confidence: null } }));
  check("no field_confidence + only 0.72 overall → blocked", d2.advance === false);
}

console.log("\n— [DEDUP-SOFT] a POSSIBLE duplicate can NEVER auto-book (held for a human) —");
{
  // The cardinal guarantee: even a perfectly-read, high-confidence invoice must be BLOCKED from
  // auto-advancing once it carries the possible-duplicate flag — otherwise a silent second cost.
  // shouldAutoAdvanceInvoice gates on classifyImportHealth(level==='clean'); _safecore.possible_duplicate
  // makes it needs-review, so this holds for the intake + email-sync paths that drive auto-advance.
  const flagged = shouldAutoAdvanceInvoice(clean({
    health: {
      ...clean().health,
      field_confidence: {
        vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96,
        _safecore: { possible_duplicate: true, possible_duplicate_of: "F-2001", possible_duplicate_reason: "zelfde bedrag en datum" },
      },
    },
  }));
  check("possible-dup flag → NOT auto-booked", flagged.advance === false && flagged.reason === "needs_review");
  // And without the flag, the identical invoice DOES advance — proving the flag is what blocks it.
  const same = shouldAutoAdvanceInvoice(clean());
  check("same invoice without the flag → advances (flag is the cause)", same.advance === true);
}

console.log("\n— [CREDIT-PREFIX-GATE] a credit-numbered document never books itself —");
{
  // CREDITFACTUUR CR0301267, exactly as the reader delivered it: is_credit_note FALSE (the model
  // missed it), document_kind "invoice", a breakdown that reconciles to the cent (31,07 + 2,80 =
  // 33,87) and a confident read. Every gate above it says fine. Before this axis existed it
  // auto-booked as a € 33,87 debt — money the supplier owed the owner, entered as money owed to
  // the supplier, with its btw ADDED to the reclaim and no human ever asked.
  const cr = shouldAutoAdvanceInvoice(clean({
    totalIncBtw: 33.87,
    health: {
      total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
      invoice_date: "2026-07-02", invoice_number: "CR0301267", invoice_type: "factuur",
      field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 },
    },
  }));
  check("CR0301267 → held for a human", cr.advance === false && cr.reason === "needs_review");

  // The same invoice under an ordinary number DOES advance — so the number is provably the cause,
  // and this test cannot pass on a gate that has simply stopped advancing anything.
  const re = shouldAutoAdvanceInvoice(clean({
    totalIncBtw: 33.87,
    health: {
      total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
      invoice_date: "2026-07-02", invoice_number: "RE0803119", invoice_type: "factuur",
      field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 },
    },
  }));
  check("same amounts, ordinary number → advances (the prefix is the cause)", re.advance === true);

  // A credit note that is ALREADY booked right must not wear a permanent amber badge for being
  // correct. It is held by the is_credit_note / invoice_type rule above, not by this axis.
  const booked = shouldAutoAdvanceInvoice(clean({
    is_credit_note: true, invoice_type: "creditnota", totalIncBtw: -33.87,
    health: {
      total_ex_btw: -31.07, btw_amount: -2.8, total_inc_btw: -33.87,
      invoice_date: "2026-07-02", invoice_number: "CR0301267", invoice_type: "creditnota",
      field_confidence: { vendor: 0.98, invoice_number: 0.97, invoice_date: 0.99, amount: 0.96 },
    },
  }));
  check("an already-booked creditnota is held as 'creditnota', not as a defect", booked.reason === "creditnota");

  // The kassabon placeholder the camera path writes is held by the PLACEHOLDER rule that was
  // already there — not by this axis. Locked as "still held, for the older reason", because a new
  // gate that quietly takes credit for an existing one hides the day the older one breaks.
  // That "CAMERA" is not read as a credit prefix is asserted directly in creditnota-signal.test.ts.
  const bon = shouldAutoAdvanceInvoice(clean({
    health: { ...clean().health, invoice_number: "CAMERA-1784373759249" },
  }));
  check("a CAMERA-… bon placeholder is still held (placeholder rule)", bon.advance === false && bon.reason === "needs_review");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
