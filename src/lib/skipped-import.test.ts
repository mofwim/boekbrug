// [OBSERVABILITY] Pure node test — run: npx tsx --test src/lib/skipped-import.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DOC_TYPE_COULD_NOT_READ,
  DOC_TYPE_UNSUPPORTED,
  SKIPPED_DOC_TYPES,
  docTypeForStoredFile,
  isSkippedDocType,
} from "./skipped-import";

test("een onleesbaar bestand krijgt de reden, niet de gok van de AI", () => {
  // DE BUG: /api/intake schreef `v.document_kind ?? "other"` óók als couldNotRead waar was.
  // Een gefotografeerde bon die niet te lezen was, kwam als "other" in bestanden en werd door
  // niets geteld — waarna het paneel meldde "Niets overgeslagen".
  assert.equal(docTypeForStoredFile(true, "invoice"), DOC_TYPE_COULD_NOT_READ);
  assert.equal(docTypeForStoredFile(true, "receipt"), DOC_TYPE_COULD_NOT_READ);
  assert.equal(docTypeForStoredFile(true, null), DOC_TYPE_COULD_NOT_READ);
  assert.equal(docTypeForStoredFile(true, "other"), DOC_TYPE_COULD_NOT_READ);
});

test("een wél gelezen bestand houdt zijn classificatie", () => {
  assert.equal(docTypeForStoredFile(false, "invoice"), "invoice");
  assert.equal(docTypeForStoredFile(false, "receipt"), "receipt");
  // Niets bruikbaars → 'other', zoals voorheen.
  assert.equal(docTypeForStoredFile(false, null), "other");
  assert.equal(docTypeForStoredFile(false, undefined), "other");
  assert.equal(docTypeForStoredFile(false, "   "), "other");
});

test("de lezer telt precies wat de schrijvers wegschrijven", () => {
  // Dit is het invariant dat de bug veroorzaakte: schrijver en lezer liepen uit elkaar.
  assert.equal(isSkippedDocType(DOC_TYPE_COULD_NOT_READ), true);
  assert.equal(isSkippedDocType(DOC_TYPE_UNSUPPORTED), true);
  assert.equal(isSkippedDocType(docTypeForStoredFile(true, "invoice")), true,
    "wat de schrijver bij een leesfout produceert, MOET de lezer tellen");
});

test("een normaal document telt niet als overgeslagen", () => {
  for (const t of ["invoice", "receipt", "other", "ubl_invoice", "", null, undefined]) {
    assert.equal(isSkippedDocType(t), false, `${String(t)} is niet overgeslagen`);
  }
});

test("de lijst is de enige bron — en hij is niet leeg", () => {
  // Zou iemand hem legen, dan meldt het paneel weer altijd "niets overgeslagen".
  assert.ok(SKIPPED_DOC_TYPES.length >= 2);
  assert.ok(SKIPPED_DOC_TYPES.includes(DOC_TYPE_COULD_NOT_READ));
  assert.ok(SKIPPED_DOC_TYPES.includes(DOC_TYPE_UNSUPPORTED));
});
