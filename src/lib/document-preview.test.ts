// [DOC-GEEN-BLADZIJDE] Pure node test — run: npx tsx --test src/lib/document-preview.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { previewKind, structuredFormatLabel, noPageNotice } from "./document-preview";

test("[DOC-GEEN-BLADZIJDE] the two things that DO have a page keep it", () => {
  // Nothing about the ordinary case may move: a photographed receipt and a pdf are what almost
  // every incoming document is.
  for (const n of ["bon.jpg", "FACTUUR.JPEG", "scan.png", "foto.heic", "bon.webp"]) {
    assert.equal(previewKind(n), "image", n);
  }
  for (const n of ["factuur.pdf", "2026-001.PDF", "a/b/c/nota.pdf"]) {
    assert.equal(previewKind(n), "pdf", n);
  }
});

test("[DOC-GEEN-BLADZIJDE] a UBL e-invoice is not a page", () => {
  // The reported screen: an <iframe> over this file renders the raw XML source — namespace
  // declarations and all — under a panel of tidy amounts.
  assert.equal(previewKind("factuur.xml"), "structured");
  assert.equal(previewKind("peppol-invoice.ubl"), "structured");
});

test("[DOC-GEEN-BLADZIJDE] a bank statement is recognised before the bare .xml rule", () => {
  // A CAMT.053 statement IS an xml file. Calling it an e-invoice would be worse than saying
  // nothing, so the specific formats are tested first.
  assert.equal(structuredFormatLabel("statement.camt"), "een bankafschrift (CAMT.053)");
  assert.equal(structuredFormatLabel("afschrift.053"), "een bankafschrift (CAMT.053)");
  assert.equal(structuredFormatLabel("mei.mt940"), "een bankafschrift (MT940)");
  assert.equal(structuredFormatLabel("mei.sta"), "een bankafschrift (MT940)");
  assert.equal(structuredFormatLabel("peppol.ubl"), "een e-factuur (UBL)");
  // The bare .xml stays deliberately vague, because from the name alone it could be either.
  assert.match(structuredFormatLabel("iets.xml") ?? "", /e-factuur \(UBL\) of een bankafschrift/);
});

test("[DOC-GEEN-BLADZIJDE] anything unrecognised is still framed", () => {
  // A frame is the better guess for something we do not know: a .doc or an unnamed file may well
  // render, and claiming "this has no page" about a document that does would be a new lie.
  for (const n of ["contract.docx", "sheet.xlsx", "", null, undefined, "bestand"]) {
    assert.equal(previewKind(n as string), "other", String(n));
    assert.equal(structuredFormatLabel(n as string), null);
  }
});

test("[DOC-GEEN-BLADZIJDE] the notice says what it is, why there is no page, and where the reading is", () => {
  // All three are load-bearing. Without the last one the sentence is an apology rather than an
  // explanation — the owner has to be told that the numbers above ARE the file.
  const s = noPageNotice("factuur.ubl");
  assert.match(s, /e-factuur \(UBL\)/, "what it is");
  assert.match(s, /geen bladzijde/, "why there is nothing to look at");
  assert.match(s, /staat hierboven/, "…and that the reading is right there");
  assert.match(s, /nieuw tabblad/, "the source is one tap away, not hidden");
});

test("[DOC-GEEN-BLADZIJDE] an unnamed file still produces a sentence, never 'null'", () => {
  // This reaches a screen. A template hole is worse than a vague sentence.
  const s = noPageNotice(null);
  assert.doesNotMatch(s, /null|undefined/);
  assert.match(s, /geen bladzijde/);
});
