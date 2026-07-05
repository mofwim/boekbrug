// [BOEK-011] Pure node test for isLikelyInvoiceCandidate — run: npx tsx isLikelyInvoiceCandidate.test.ts
//
// The pre-Claude attachment filter decides whether an email attachment is worth
// an AI call. In a financial app a FALSE DROP (a real invoice filtered out) is
// catastrophic — a silently missing number in a tax return. These tests focus
// hardest on the "must keep" cases, especially vendors whose NAME contains
// chrome words like 'logo' / 'icon' / 'banner' (the bug in the first draft,
// where substring matching would have dropped their invoices).
import { isLikelyInvoiceCandidate } from "./src/lib/email-integration";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const img = (filename: string, size: number) => ({ filename, mimeType: "image/png", size });
const pdf = (filename: string, size: number) => ({ filename, mimeType: "application/pdf", size });

console.log("\n— MUST KEEP: false-drop is catastrophic —");
check("PDF any size", isLikelyInvoiceCandidate(pdf("factuur.pdf", 5000)) === true);
check("PDF tiny 3KB", isLikelyInvoiceCandidate(pdf("inv.pdf", 3000)) === true);
check('vendor "Iconic Foods" image kept',
  isLikelyInvoiceCandidate(img("iconic-foods-factuur.png", 50000)) === true);
check('vendor "Banner Print" image kept',
  isLikelyInvoiceCandidate(img("banner-print-invoice.png", 40000)) === true);
check('vendor "LogoMakers" image kept',
  isLikelyInvoiceCandidate(img("logomakers-2026.png", 60000)) === true);
check("receipt photo 30KB", isLikelyInvoiceCandidate(img("IMG_2938.jpg", 30000)) === true);
check("small receipt 15KB", isLikelyInvoiceCandidate(img("kassabon.jpg", 15000)) === true);
check("unknown size (0) passes", isLikelyInvoiceCandidate(img("scan.png", 0)) === true);
check("normal scan name", isLikelyInvoiceCandidate(img("scan_20260703.png", 45000)) === true);

console.log("\n— MUST DROP: email chrome (the point) —");
check("image001.png dropped", isLikelyInvoiceCandidate(img("image001.png", 8000)) === false);
check("ATT00001.png dropped", isLikelyInvoiceCandidate(img("ATT00001.png", 5000)) === false);
check("logo.png dropped", isLikelyInvoiceCandidate(img("logo.png", 9000)) === false);
check("logo2.png dropped", isLikelyInvoiceCandidate(img("logo2.png", 7000)) === false);
check("signature.png dropped", isLikelyInvoiceCandidate(img("signature.png", 6000)) === false);
check("sig.png dropped", isLikelyInvoiceCandidate(img("sig.png", 4000)) === false);
check("tiny 5KB image dropped", isLikelyInvoiceCandidate(img("whatever.png", 5000)) === false);

console.log("\n— EDGE CASES —");
check("50KB file named logo.png → name rule wins (drop)",
  isLikelyInvoiceCandidate(img("logo.png", 50000)) === false);
check("image12.png (2 digits, not inline pattern) kept",
  isLikelyInvoiceCandidate(img("image12.png", 30000)) === true);
check("att123.png (3 digits, not 5) kept",
  isLikelyInvoiceCandidate(img("att123.png", 30000)) === true);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);