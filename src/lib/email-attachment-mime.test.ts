// [H2] Pure node test — run: npx tsx src/lib/email-attachment-mime.test.ts
// Locks the mislabelled-MIME recovery: a real invoice sent with a wrong/generic content
// type is still recognised by its extension, so it is not dropped from the import.
import { normalizeAttachmentMime } from "./email-integration";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— correct MIME types pass through unchanged —");
check("application/pdf", normalizeAttachmentMime("application/pdf", "factuur.pdf") === "application/pdf");
check("image/jpeg", normalizeAttachmentMime("image/jpeg", "bon.jpg") === "image/jpeg");
check("image/heic (broad image passthrough kept)", normalizeAttachmentMime("image/heic", "foto.heic") === "image/heic");

console.log("\n— a real PDF mislabelled by the mail server is RECOVERED by extension —");
check("octet-stream + .pdf → application/pdf", normalizeAttachmentMime("application/octet-stream", "Factuur-2026-04.pdf") === "application/pdf");
check("empty mime + .pdf → application/pdf", normalizeAttachmentMime("", "invoice.PDF") === "application/pdf");
check("octet-stream + .jpg → image/jpeg", normalizeAttachmentMime("application/octet-stream", "scan.JPG") === "image/jpeg");
check("binary + .png → image/png", normalizeAttachmentMime("binary/octet-stream", "receipt.png") === "image/png");

console.log("\n— types we cannot classify return null (left for the could-not-read/skip path) —");
check(".xml (UBL/Peppol) → null", normalizeAttachmentMime("application/xml", "einvoice.xml") === null);
check(".docx → null", normalizeAttachmentMime("application/octet-stream", "factuur.docx") === null);
check("no extension + generic mime → null", normalizeAttachmentMime("application/octet-stream", "attachment") === null);

console.log("\n— [SECURITY] SVG is never accepted (stored-XSS vector; not a readable invoice) —");
check("image/svg+xml → null (blocked)", normalizeAttachmentMime("image/svg+xml", "logo.svg") === null);
check("image/svg → null (blocked)", normalizeAttachmentMime("image/svg", "logo.svg") === null);
check("spoofed generic mime + .svg name → null", normalizeAttachmentMime("application/octet-stream", "invoice.svg") === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
