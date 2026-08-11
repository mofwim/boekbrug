// src/lib/tools/upload-shrink.test.ts
// Run: npx tsx --test src/lib/tools/upload-shrink.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldOfferShrink } from "./upload-shrink";

const MAX = 10 * 1024 * 1024;
const file = (over: Parameters<typeof shouldOfferShrink>[0]) => shouldOfferShrink(over, MAX);

test("[SIZE-SHRINK] an oversized PDF is offered the shrink", () => {
  assert.equal(file({ type: "application/pdf", name: "scan.pdf", size: MAX + 1 }), true);
});

test("[SIZE-SHRINK] a PDF that fits is not — there is nothing to fix", () => {
  assert.equal(file({ type: "application/pdf", name: "scan.pdf", size: MAX - 1 }), false);
  assert.equal(file({ type: "application/pdf", name: "scan.pdf", size: MAX }), false);
});

test("[SIZE-SHRINK] an oversized image is not offered it", () => {
  // normalizeImageForUpload has already been past. A button that cannot help is
  // worse than no button: it costs a wait and ends where it started.
  assert.equal(file({ type: "image/jpeg", name: "bon.jpg", size: MAX * 3 }), false);
  assert.equal(file({ type: "image/heic", name: "IMG_0042.HEIC", size: MAX * 3 }), false);
});

test("[SIZE-SHRINK] a PDF is recognised by its name when the type is missing", () => {
  // Some browsers and some drag sources hand over an empty type. The name is
  // the fallback, and it is checked case-insensitively because Windows does not
  // agree with anyone about that.
  assert.equal(file({ type: "", name: "kwartaal.pdf", size: MAX + 1 }), true);
  assert.equal(file({ type: undefined, name: "KWARTAAL.PDF", size: MAX + 1 }), true);
  assert.equal(file({ type: "", name: "geen-extensie", size: MAX + 1 }), false);
});
