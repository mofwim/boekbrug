// Run: npx tsx --test src/lib/ubl-embedded-pdf.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { extractEmbeddedPdf, MAX_EMBEDDED_PDF_BYTES } from "./ubl-embedded-pdf";

const pdfBytes = Buffer.from("%PDF-1.4\nfake invoice body\n%%EOF");
const pdf64 = pdfBytes.toString("base64");

/** The shape production sends: Exact Online's UBL 2.0, prefixes and all. */
const ubl = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>26702771</cbc:ID>
  <cac:AdditionalDocumentReference>
    <cbc:ID>NL009454226B01_Inv_26702771</cbc:ID>
    <cac:Attachment>${inner}</cac:Attachment>
  </cac:AdditionalDocumentReference>
</Invoice>`;

test("[XML-PDF] the printable invoice inside an e-factuur is found and decoded", () => {
  const got = extractEmbeddedPdf(ubl(
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf" filename="Inv_26702771.pdf">${pdf64}</cbc:EmbeddedDocumentBinaryObject>`,
  ));
  assert.ok(got, "the PDF is right there in the XML — this is the whole bug");
  assert.equal(got!.bytes.toString("latin1"), pdfBytes.toString("latin1"));
  assert.equal(got!.filename, "Inv_26702771.pdf");
});

test("[XML-PDF] an e-factuur without an attachment answers null, and that is normal", () => {
  // Carrying the PDF is optional in Peppol. Null must mean "there is none", never "it failed" —
  // the caller keeps the XML either way and must not report a problem that does not exist.
  assert.equal(extractEmbeddedPdf(ubl("<cbc:Something>x</cbc:Something>")), null);
  assert.equal(extractEmbeddedPdf(""), null);
  assert.equal(extractEmbeddedPdf("not xml at all"), null);
});

test("[XML-PDF] the label and the bytes must AGREE — either alone is a stranger's word", () => {
  // Right bytes, wrong label: left alone. Guessing the type of an untrusted file is how a store
  // starts serving something other than what it says it is.
  assert.equal(extractEmbeddedPdf(ubl(
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="application/octet-stream">${pdf64}</cbc:EmbeddedDocumentBinaryObject>`,
  )), null);
  // Right label, wrong bytes: also left alone. This is the one that would actually be served.
  assert.equal(extractEmbeddedPdf(ubl(
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf">${Buffer.from("<html>hallo</html>").toString("base64")}</cbc:EmbeddedDocumentBinaryObject>`,
  )), null);
  // No label at all.
  assert.equal(extractEmbeddedPdf(ubl(
    `<cbc:EmbeddedDocumentBinaryObject>${pdf64}</cbc:EmbeddedDocumentBinaryObject>`,
  )), null);
});

test("[XML-PDF] any namespace prefix, or none, is read the same way", () => {
  for (const tag of ["cbc:EmbeddedDocumentBinaryObject", "ram:EmbeddedDocumentBinaryObject", "EmbeddedDocumentBinaryObject"]) {
    const got = extractEmbeddedPdf(`<a><${tag} mimeCode="application/pdf">${pdf64}</${tag}></a>`);
    assert.ok(got, `<${tag}> was not read — a sender's prefix is not part of the meaning`);
  }
});

test("[XML-PDF] whitespace in the base64 is normal and must not break the decode", () => {
  // Every pretty-printer in existence wraps a long base64 blob. A reader that only handles the
  // unwrapped form works on the file you tested and fails on the file that arrives.
  const gewikkeld = pdf64.replace(/(.{20})/g, "$1\n      ");
  assert.ok(extractEmbeddedPdf(ubl(
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf">\n      ${gewikkeld}\n  </cbc:EmbeddedDocumentBinaryObject>`,
  )));
});

test("[XML-PDF] two attachments: the first qualifying one is the invoice, not the pile", () => {
  const got = extractEmbeddedPdf(ubl(
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="text/csv">${Buffer.from("a;b").toString("base64")}</cbc:EmbeddedDocumentBinaryObject>` +
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf" filename="factuur.pdf">${pdf64}</cbc:EmbeddedDocumentBinaryObject>`,
  ));
  assert.equal(got?.filename, "factuur.pdf", "the CSV must not shadow the invoice behind it");
});

test("[XML-PDF] a supplier's filename can never reach storage as a path", () => {
  const got = extractEmbeddedPdf(ubl(
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf" filename="../../etc/passwd">${pdf64}</cbc:EmbeddedDocumentBinaryObject>`,
  ));
  assert.ok(got);
  assert.ok(!got!.filename!.includes("/"), "a traversal segment must not survive into a storage key");
  assert.ok(!got!.filename!.includes(".."), "nor a parent-directory hop");
});

test("[XML-PDF] an oversized blob is refused before it is decoded", () => {
  // Unattended intake: a base64 blob costs a supplier nothing to write. The ceiling is checked on
  // the ENCODED length so the allocation is bounded, not discovered afterwards.
  const groot = "A".repeat(Math.ceil((MAX_EMBEDDED_PDF_BYTES + 1024) / 3) * 4);
  assert.equal(extractEmbeddedPdf(ubl(
    `<cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf">${groot}</cbc:EmbeddedDocumentBinaryObject>`,
  )), null);
});

test("[XML-PDF] the exact opening bytes seen in the reported file", () => {
  // From the screenshot of invoice 26702771, verbatim: the element carries
  // mimeCode="application/pdf" and its content begins `JVBERi0xLjMNJeLjz9MNCjMg…`.
  // `JVBERi0x` is base64 for `%PDF-1`, so the file the owner was shown as a wall of XML had the
  // printable invoice in it all along. This test exists so that stays provable from the repo.
  const echt = "JVBERi0xLjMNJeLjz9MNCg==";
  assert.equal(Buffer.from(echt, "base64").subarray(0, 5).toString("latin1"), "%PDF-");
  const got = extractEmbeddedPdf(
    `<cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf">${echt}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>`,
  );
  assert.ok(got, "the reported production file must be readable by this module");
});
