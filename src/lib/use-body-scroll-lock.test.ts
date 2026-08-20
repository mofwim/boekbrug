// [BLAD-ACHTERGROND] Pure node test — run: npx tsx --test src/lib/use-body-scroll-lock.test.ts
//
// The page behind an open sheet does not move. Tested by driving the hook's effect directly: the
// interesting behaviour is the NESTING, and that is arithmetic on a module-level counter, not
// anything a render can show.

import { test } from "node:test";
import assert from "node:assert/strict";

// A document just real enough for the hook: one style object it writes one property on.
const fakeDocument = () => ({ body: { style: { overflow: "" } } });

/**
 * Run the hook's effect body without React.
 *
 * The hook is a useEffect around a lock/unlock pair, so this exercises the same code path a mount
 * and an unmount do — and unlike a render test it can interleave two overlays, which is the case
 * that goes wrong in the field.
 */
async function withDocument<T>(fn: () => Promise<T> | T): Promise<T> {
  const had = "document" in globalThis;
  const before = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = fakeDocument();
  try { return await fn(); }
  finally {
    if (had) (globalThis as { document?: unknown }).document = before;
    else delete (globalThis as { document?: unknown }).document;
  }
}

/** Take a lock, the way the hook's effect does on mount. */
async function mountLock(): Promise<() => void> {
  const { acquireBodyScrollLock } = await import("./use-body-scroll-lock");
  return acquireBodyScrollLock();
}

test("[BLAD-ACHTERGROND] an open sheet freezes the page behind it, and closing gives it back", async () => {
  await withDocument(async () => {
    const doc = (globalThis as unknown as { document: { body: { style: { overflow: string } } } }).document;
    doc.body.style.overflow = "auto";

    const release = await mountLock();
    assert.equal(doc.body.style.overflow, "hidden", "the list behind the sheet cannot scroll");

    release();
    assert.equal(doc.body.style.overflow, "auto", "…and gets exactly what it had back, not a blank");
  });
});

test("[BLAD-ACHTERGROND] two overlays unwind in any order without un-freezing too early", async () => {
  await withDocument(async () => {
    const doc = (globalThis as unknown as { document: { body: { style: { overflow: string } } } }).document;
    doc.body.style.overflow = "";

    // A confirm dialog opening over the document sheet. THE failure this counter exists for: with
    // save-and-restore per overlay, the inner one puts back '' while the outer sheet is still on
    // screen — and the page starts scrolling underneath an overlay that never went away.
    const releaseOuter = await mountLock();
    const releaseInner = await mountLock();
    assert.equal(doc.body.style.overflow, "hidden");

    releaseInner();
    assert.equal(doc.body.style.overflow, "hidden", "the sheet is still open, so the page stays frozen");

    releaseOuter();
    assert.equal(doc.body.style.overflow, "", "the last one out restores it");

    // …and the other unwind order, which is the one a naive implementation gets right by accident.
    const a = await mountLock();
    const b = await mountLock();
    a();
    assert.equal(doc.body.style.overflow, "hidden");
    b();
    assert.equal(doc.body.style.overflow, "");
  });
});

test("[BLAD-ACHTERGROND] a released overlay cannot release a second time", async () => {
  await withDocument(async () => {
    const { __lockDepthForTests } = await import("./use-body-scroll-lock");
    const doc = (globalThis as unknown as { document: { body: { style: { overflow: string } } } }).document;
    doc.body.style.overflow = "";

    // THE case. A sheet is open; a confirm dialog opens over it; the dialog's cleanup runs twice —
    // React does not do that, but a wrapper that also calls the release in an onClose handler
    // does, and so does StrictMode's double-invoked effect. The second release must be a no-op.
    //
    // Without the guard the count reaches zero on that second call and the page starts scrolling
    // UNDERNEATH a sheet that is still on screen — which is the very symptom this whole file
    // exists to remove, reintroduced by the fix for it.
    const releaseSheet = await mountLock();
    const releaseDialog = await mountLock();
    releaseDialog();
    releaseDialog();
    assert.equal(doc.body.style.overflow, "hidden", "the sheet is still open, so the page stays frozen");
    assert.equal(__lockDepthForTests(), 1, "one overlay is still holding the lock");

    releaseSheet();
    assert.equal(doc.body.style.overflow, "", "and it unfreezes when the last one really closes");
    assert.equal(__lockDepthForTests(), 0);

    // A stray release with nothing open cannot push the count below zero either — if it could, the
    // next sheet would take `restore` from an already-frozen body and leave the page locked for
    // good.
    releaseSheet();
    assert.equal(__lockDepthForTests(), 0);
    const again = await mountLock();
    assert.equal(doc.body.style.overflow, "hidden");
    again();
    assert.equal(doc.body.style.overflow, "", "…and the sheet after it still works");
  });
});
