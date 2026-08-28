// [VERVANG-OVERAL] Pure node test — run: npx tsx --test src/lib/supersede-target.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { supersedeTargetOf } from "./supersede-target";

test("[VERVANG-OVERAL] a flagged twin gives the other invoice's number", () => {
  const t = supersedeTargetOf({
    _safecore: { possible_duplicate_id: "abc-123", possible_duplicate_of: "26702036" },
  });
  assert.deepEqual(t, { number: "26702036" });
});

test("[VERVANG-OVERAL] a flag without a readable number is still a flag", () => {
  // The sentences have a with/without-number variant precisely for this.
  for (const of of ["", "   ", undefined, 42]) {
    const t = supersedeTargetOf({ _safecore: { possible_duplicate_id: "abc-123", possible_duplicate_of: of } });
    assert.deepEqual(t, { number: null }, `possible_duplicate_of = ${JSON.stringify(of)}`);
  }
});

test("[VERVANG-OVERAL] no flag means do not offer, never 'it failed'", () => {
  const geen = [
    null, undefined, "not an object", 42, [],
    {},                                            // no _safecore at all
    { _safecore: null },
    { _safecore: "text" },
    { _safecore: {} },                             // safecore without the flag
    { _safecore: { possible_duplicate: true } },   // the soft warning, no twin id
    { _safecore: { possible_duplicate_id: "" } },  // present but empty
    { _safecore: { possible_duplicate_id: 42 } },  // wrong type
  ];
  for (const fc of geen) {
    assert.equal(supersedeTargetOf(fc), null, `${JSON.stringify(fc)} offered a replacement`);
  }
});

test("[VERVANG-OVERAL] the twin's id never leaves this module", () => {
  // The route reads it from the flag the server wrote, so no client can aim the archive. Handing
  // the id to a screen would invite exactly the request body that route refuses to accept.
  const t = supersedeTargetOf({ _safecore: { possible_duplicate_id: "abc-123", possible_duplicate_of: "26702036" } });
  assert.deepEqual(Object.keys(t!), ["number"]);
  assert.equal(JSON.stringify(t).includes("abc-123"), false, "the id reached the screen");
});
