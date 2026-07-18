// [TRUST-CONFIDENT-FALSE] Pure node test — run: npx tsx src/lib/ai-rescue.test.ts
// Locks the rule that a confident "not an invoice" verdict carrying a strong invoice signal
// (vendor + amount) and a non-statement filename is RESCUED to the verify queue, never
// silently discarded — while a genuine statement or a signal-less document is not rescued.
import {
  shouldRescueNonInvoice,
  isReminderFilename,
  looksLikeStatementText,
  looksLikeStatementReason,
  needsVisualReread,
  isTransientAiError,
  isAiApiError,
} from "./ai";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— rescue: strong signal + non-statement filename → keep (the HVO verzamelfactuur case) —");
check("vendor + total_inc_btw, numeric filename → rescue",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_inc_btw: 3186.42 }, "2216671.pdf") === true);
check("vendor + total_ex_btw only → rescue",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_ex_btw: 2632.0 }, "factuur.pdf") === true);
check("vendor + legacy amount field → rescue",
  shouldRescueNonInvoice({ vendor: "Sligro", amount: 812.5 }, "bon.pdf") === true);

console.log("\n— NOT rescued: a STATEMENT of account is never resurrected as one invoice (no double-count) —");
check("is_statement flag → not rescued even with vendor + balance amount (the OPENSTAANDE FACTUREN bug)",
  shouldRescueNonInvoice({ vendor: "Dutch Sweets Company B.V.", total_inc_btw: 1338.96, is_statement: true }, "factuur.pdf") === false);
check("rekeningoverzicht filename → not rescued even with signal",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_inc_btw: 3186.42 }, "rekeningoverzicht-mei.pdf") === false);
check("openstaande posten filename → not rescued",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_inc_btw: 3186.42 }, "openstaande posten.pdf") === false);
check("a genuine verzamelfactuur (is_statement false) IS still rescued",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_inc_btw: 3186.42, is_statement: false }, "2216671.pdf") === true);

console.log("\n— NOT rescued: weak signal (a newsletter/ad is genuinely not an invoice) —");
check("vendor but NO amount → not rescued",
  shouldRescueNonInvoice({ vendor: "Nieuwsbrief BV", total_inc_btw: null, amount: null }, "nieuwsbrief.pdf") === false);
check("amount but NO vendor → not rescued",
  shouldRescueNonInvoice({ vendor: null, total_inc_btw: 50 }, "flyer.pdf") === false);
check("no vendor, no amount → not rescued",
  shouldRescueNonInvoice({}, "banner.pdf") === false);
check("empty vendor string counts as no vendor",
  shouldRescueNonInvoice({ vendor: "   ", total_inc_btw: 100 }, "x.pdf") === false);

console.log("\n— [REMINDER] filename backstop flags a payment reminder (a real invoice, but check for a duplicate) —");
check("betalingsherinnering → reminder", isReminderFilename("betalingsherinnering-2216671.pdf") === true);
check("herinnering → reminder", isReminderFilename("Herinnering factuur 2216671.pdf") === true);
check("aanmaning → reminder", isReminderFilename("2e aanmaning.pdf") === true);
check("reminder (EN) → reminder", isReminderFilename("payment reminder.pdf") === true);
check("plain factuur is NOT a reminder", isReminderFilename("factuur-2216671.pdf") === false);
check("a vendor named 'Herinneringen BV' invoice is still caught (acceptable — flagged, not dropped)",
  isReminderFilename("herinnering.pdf") === true);
check("empty filename → not a reminder", isReminderFilename("") === false);

console.log("\n— [STATEMENT-HARDEN] the model's own statement REASON blocks the vendor+amount rescue —");
check("statement reason 'rekeningoverzicht' → not rescued even with vendor + amount",
  shouldRescueNonInvoice({ vendor: "Exact", total_inc_btw: 8980.05, reason: "Rekeningoverzicht — samenvatting van bestaande facturen" }, "document.pdf") === false);
check("statement reason 'overzicht van meerdere facturen' → not rescued",
  shouldRescueNonInvoice({ vendor: "M.H. Bal", total_inc_btw: 1200, reason: "overzicht van meerdere facturen, geen boekbare factuur" }, "26003666.pdf") === false);
check("statement reason 'openstaande facturen' → not rescued",
  shouldRescueNonInvoice({ vendor: "Exact", total_inc_btw: 500, reason: "openstaande facturen overzicht" }, "statement.pdf") === false);
check("a GENERIC 'geen factuur' reason still allows the verzamelfactuur rescue (not lost)",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_inc_btw: 3186.42, reason: "geen factuur herkend" }, "2216671.pdf") === true);
check("no reason at all → rescue still works on strong signal",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_inc_btw: 3186.42 }, "2216671.pdf") === true);

console.log("\n— [STATEMENT-TEXT-GUARD] content backstop recognises an OPENSTAANDE-FACTUREN overview by its text —");
check("openstaande facturen overview text → statement",
  looksLikeStatementText(
    "OPENSTAANDE FACTUREN\nFactuurnummer  Factuurdatum  Bedrag  Reeds betaald  Nog openstaand\n" +
    "26003666  01-08-2026  344,48\n26003201  01-07-2026  120,00\nTotaal openstaand 464,48"
  ) === true);
check("rekeningoverzicht text with saldo → statement",
  looksLikeStatementText("Rekeningoverzicht\nSaldo per 08-08-2026: 8.980,05") === true);
check("a single betalingsherinnering (one invoice) is NOT a statement",
  looksLikeStatementText(
    "Betalingsherinnering\nFactuurnummer 26003666\nBedrag incl. BTW 344,48\nGelieve te voldoen voor 22-08-2026"
  ) === false);
check("a normal single invoice text is NOT a statement",
  looksLikeStatementText(
    "FACTUUR\nFactuurnummer 26003666\nSubtotaal 316,04\nBTW 21% 28,44\nTotaal incl. BTW 344,48"
  ) === false);
check("empty/scanned text → not a statement (model's read stands)",
  looksLikeStatementText("") === false && looksLikeStatementText(null) === false);
check("bare overview word without balance/rows → not a statement (too weak)",
  looksLikeStatementText("Rekeningoverzicht") === false);

console.log("\n— [STATEMENT-HARDEN] looksLikeStatementReason vocabulary —");
check("'rekeningoverzicht' reason", looksLikeStatementReason("Rekeningoverzicht — geen factuur") === true);
check("'samenvatting van bestaande facturen' reason", looksLikeStatementReason("samenvatting van bestaande facturen") === true);
check("'meerdere facturen' reason", looksLikeStatementReason("overzicht van meerdere facturen") === true);
check("generic 'geen factuur' reason is NOT statement-specific", looksLikeStatementReason("geen factuur herkend") === false);
check("null reason → false", looksLikeStatementReason(null) === false);

console.log("\n— [VISUAL-REREAD] a weak invoice read triggers a visual re-read —");
check("missing invoice number (total present) → re-read",
  needsVisualReread({ is_invoice: true, invoice_number: null, total_inc_btw: 344.48, total_ex_btw: 316.04, btw_amount: 28.44 }) === true);
check("missing BTW split (only total, the €8.980 case) → re-read",
  needsVisualReread({ is_invoice: true, invoice_number: "26003666", total_inc_btw: 8980.05, total_ex_btw: null, btw_amount: null }) === true);
check("low amount confidence → re-read",
  needsVisualReread({ is_invoice: true, invoice_number: "123", total_inc_btw: 100, total_ex_btw: 82.64, btw_amount: 17.36, field_confidence: { amount: 0.4 } }) === true);
check("legacy 'amount' field as total + missing split → re-read",
  needsVisualReread({ is_invoice: true, invoice_number: "123", amount: 500 }) === true);

console.log("\n— [VISUAL-REREAD] a clean read is NOT re-read (no wasted strong call) —");
check("full clean invoice → no re-read",
  needsVisualReread({ is_invoice: true, invoice_number: "26302362", total_inc_btw: 344.48, total_ex_btw: 316.04, btw_amount: 28.44, field_confidence: { amount: 0.95 } }) === false);
check("not an invoice → no re-read",
  needsVisualReread({ is_invoice: false, invoice_number: null, total_inc_btw: 100 }) === false);
check("no total at all → no re-read (handled by the raw fallback, not here)",
  needsVisualReread({ is_invoice: true, invoice_number: null, total_inc_btw: null, amount: null }) === false);
check("null input → false", needsVisualReread(null) === false);

console.log("\n— [TRANSIENT-RETRY] transient infra errors retry; genuine read failures do not —");
check("Claude 429 → transient", isTransientAiError(new Error("Claude PDF API error 429: rate limited")) === true);
check("Claude 500 → transient", isTransientAiError(new Error("Claude API error 500: internal")) === true);
check("Claude 529 (overloaded) → transient", isTransientAiError(new Error("Claude Image API error 529: overloaded")) === true);
check("network ECONNRESET → transient", isTransientAiError(new Error("fetch failed: ECONNRESET")) === true);
check("fetchWithRetry 'request failed' → transient", isTransientAiError(new Error("Claude API: request failed")) === true);
check("cause.code ETIMEDOUT → transient", isTransientAiError(Object.assign(new Error("x"), { cause: { code: "ETIMEDOUT" } })) === true);
check("Claude 400 (bad request) → NOT transient (terminal)", isTransientAiError(new Error("Claude API error 400: invalid")) === false);
check("invalid PDF → NOT transient", isTransientAiError(new Error("Ongeldig PDF-bestand")) === false);
check("JSON parse failure → NOT transient", isTransientAiError(new Error("Unexpected token < in JSON")) === false);
check("null → NOT transient", isTransientAiError(null) === false);

console.log("\n— [REREAD-STRONG] a model-unavailable 404 is an API error (re-thrown → honest 502), not a verdict —");
check("404 model not found → API error (so it re-throws, not a false 'not invoice')",
  isAiApiError(new Error("Claude PDF API error 404: model not found")) === true);
check("404 is NOT classified transient (won't retry-loop the sync)", isTransientAiError(new Error("Claude PDF API error 404: model not found")) === false);
check("400 bad request → API error", isAiApiError(new Error("Claude API error 400: invalid")) === true);
check("429 → API error too (covered by both predicates)", isAiApiError(new Error("Claude API error 429")) === true);
check("a plain read/parse error is NOT an API error (stays FALLBACK)", isAiApiError(new Error("Unexpected token < in JSON")) === false);
check("null → NOT an API error", isAiApiError(null) === false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
