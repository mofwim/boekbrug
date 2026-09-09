// [MELDING-WEG] Pure node test — run: npx tsx --test src/lib/duplicate-sentence.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { duplicateWhere } from "./duplicate-sentence";

test("[MELDING-WEG] a byte-identical file names its place, through the catalogue", () => {
  const where = duplicateWhere({
    duplicate: true,
    error: "Dit bestand staat al in: 2026 / Q3 (jul–sep) / juli / Facturen",
    existing: { id: "d1", folder_id: "f1", folder_name: "Facturen", folder_path: ["2026", "Q3 (jul–sep)", "juli", "Facturen"] },
  });
  assert.deepEqual(where, { key: "up.staatAlIn", params: { path: "2026 / Q3 (jul–sep) / juli / Facturen" } });
});

test("[MELDING-WEG] a file with no folder path is 'already added', never a sentence with a hole in it", () => {
  assert.deepEqual(duplicateWhere({ duplicate: true, existing: { id: "d1", folder_id: null, folder_name: null } }),
    { key: "up.alToegevoegdZin" });
  assert.deepEqual(duplicateWhere({ duplicate: true, existing: { id: "d1", folder_path: [] } }),
    { key: "up.alToegevoegdZin" });
  // Only real names count: a null or an empty segment is not a folder.
  assert.deepEqual(duplicateWhere({ duplicate: true, existing: { id: "d1", folder_path: [null, "", "  ", "2026"] } }),
    { key: "up.staatAlIn", params: { path: "2026" } });
});

test("[MELDING-WEG] the archived and the semantic duplicate keep the server's sentence", () => {
  // Archived: the sentence names the invoice and the way back out of Genegeerd.
  assert.equal(duplicateWhere({
    duplicate: true, existing: { id: "d1", folder_path: ["2026"] },
    archived: { invoice_id: "i1", invoice_number: "F-1", client_name: "Sumer" },
  }), null);
  // Semantic: THIS file is not in the books — its look-alike is. `existing` here is the matched
  // invoice's document, and "staat al in" would point the owner at the wrong file.
  assert.equal(duplicateWhere({ duplicate: true, canForce: true, original_id: "i1", existing: { id: "d9", folder_path: ["2026"] } }), null);
  assert.equal(duplicateWhere({ duplicate: true, original_id: "i1" }), null);
});

test("[MELDING-WEG] anything else is the server's business", () => {
  assert.equal(duplicateWhere(null), null);
  assert.equal(duplicateWhere({}), null);
  assert.equal(duplicateWhere({ duplicate: true, existing: "d1" }), null);
  assert.equal(duplicateWhere({ ok: true, document_id: "d1" }), null);
});
