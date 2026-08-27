// [BETER-EXEMPLAAR] Pure node test — run: npx tsx --test src/lib/document-replace.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { planDocumentSlot } from "./document-replace";

test("[BETER-EXEMPLAAR] an empty slot is filled, exactly as before", () => {
  for (const current of [null, undefined, "", "   "]) {
    for (const replaceRequested of [false, true]) {
      const p = planDocumentSlot({ currentDocumentId: current, replaceRequested, accountantStatus: null });
      assert.deepEqual(p, { ok: true, mode: "fill" }, `${JSON.stringify(current)} / replace=${replaceRequested}`);
    }
  }
});

test("[BETER-EXEMPLAAR] an occupied slot is untouched unless replacing was ASKED for", () => {
  // Unchanged behaviour: a screen that uploads into an occupied slot has asked its owner nothing.
  const p = planDocumentSlot({ currentDocumentId: "doc-1", replaceRequested: false, accountantStatus: null });
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.code, "heeft_al_een_origineel");
});

test("[BETER-EXEMPLAAR] a deliberate replacement names the document it replaces", () => {
  // The previous id travels to the audit trail. It is NOT a delete — the old row stays in the
  // owner's files, kept for the seven years the retention asks for.
  const p = planDocumentSlot({ currentDocumentId: "doc-1", replaceRequested: true, accountantStatus: "open" });
  assert.deepEqual(p, { ok: true, mode: "replace", previousDocumentId: "doc-1" });
});

test("[BETER-EXEMPLAAR] the accountant's lock blocks a swap, and says who can undo it", () => {
  // Filling an empty slot ADDS evidence to a booked figure and is allowed. Replacing CHANGES which
  // document backs a figure they already checked — the verdict may be the same, but it would no
  // longer be the verdict they gave.
  const p = planDocumentSlot({ currentDocumentId: "doc-1", replaceRequested: true, accountantStatus: "verwerkt" });
  assert.equal(p.ok, false);
  if (p.ok) return;
  assert.equal(p.code, "verwerkt");
  assert.match(p.error, /boekhouder/, "the refusal must name who can move it forward");

  // …and the lock does NOT block filling an empty slot, which is the case the route exists for.
  assert.deepEqual(
    planDocumentSlot({ currentDocumentId: null, replaceRequested: true, accountantStatus: "verwerkt" }),
    { ok: true, mode: "fill" },
  );
});
