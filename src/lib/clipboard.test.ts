// src/lib/clipboard.test.ts
// [KOPIE-EERLIJK] The honesty of every copy in this app is proven here, once.
//
// Five screens used to decide for themselves whether a clipboard write had worked, and five of them
// decided "yes" unconditionally. Now they all ask this function, so this is the only place the
// question is answered — and the only place it has to be tested.

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyToClipboard } from "./clipboard";

/** Install a clipboard for one test and put back whatever was there. */
function withClipboard<T>(clipboard: unknown, run: () => T): T {
  const g = globalThis as { navigator?: unknown };
  const had = Object.prototype.hasOwnProperty.call(g, "navigator");
  const before = g.navigator;
  Object.defineProperty(g, "navigator", { value: { clipboard }, configurable: true, writable: true });
  try {
    return run();
  } finally {
    if (had) Object.defineProperty(g, "navigator", { value: before, configurable: true, writable: true });
    else delete g.navigator;
  }
}

test("[KOPIE-EERLIJK] a write that resolves is a success, and the exact text is what lands", async () => {
  const written: string[] = [];
  const ok = await withClipboard({ writeText: async (s: string) => { written.push(s); } },
    () => copyToClipboard("  NL91ABNA0417164300  "));
  assert.equal(ok, true);
  // Trimmed: a pasted IBAN with a leading space is rejected by some banking apps, and the space is
  // an artefact of how the value was rendered, never part of the number.
  assert.deepEqual(written, ["NL91ABNA0417164300"]);
});

test("[KOPIE-EERLIJK] a REFUSED write is false — the caller must not claim a success", async () => {
  const ok = await withClipboard({ writeText: async () => { throw new Error("NotAllowedError"); } },
    () => copyToClipboard("NL91ABNA0417164300"));
  // This is the whole module. A `true` here is a screen saying "IBAN gekopieerd" over a clipboard
  // that still holds the PREVIOUS supplier's IBAN, and an owner paying the wrong account.
  assert.equal(ok, false);
});

test("[KOPIE-EERLIJK] no clipboard API at all is false, not a throw", async () => {
  // An old Android WebView, or any non-secure origin. The app ships as a TWA, so this is a real
  // device, not a hypothetical one. It must degrade to an honest "no", never to an unhandled
  // rejection that leaves the button spinning.
  assert.equal(await withClipboard(undefined, () => copyToClipboard("x")), false);
  assert.equal(await withClipboard({}, () => copyToClipboard("x")), false);
});

test("[KOPIE-EERLIJK] nothing to copy is not a success", async () => {
  let called = 0;
  const clipboard = { writeText: async () => { called++; } };
  for (const empty of ["", "   ", null, undefined]) {
    assert.equal(await withClipboard(clipboard, () => copyToClipboard(empty)), false, `${JSON.stringify(empty)} reported as copied`);
  }
  // And it never reached the clipboard: writing "" would REPLACE a good value with nothing, which
  // is worse than leaving the previous one — the owner would paste an empty payment reference.
  assert.equal(called, 0);
});
