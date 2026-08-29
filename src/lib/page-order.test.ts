// [PAGINA-VOLGORDE] Pure node test — run: npx tsx --test src/lib/page-order.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { naturalCompare, sortPagesByName, addPages, movePage, type PageLike } from "./page-order";

/** A page, without a DOM. `lastModified` differs per page so nothing is taken for a re-pick. */
const page = (name: string, size = 100_000, lastModified = 1): PageLike => ({ name, size, lastModified });
const names = (pages: readonly PageLike[]) => pages.map((p) => p.name);

test("[PAGINA-VOLGORDE] page 2 comes before page 10, which is where a plain sort is wrong", () => {
  // The whole reason this module exists. A supplier invoice of eleven pages, photographed with the
  // page number in the filename, is the ordinary case — and the ordinary string sort puts page 10
  // and page 11 in front of page 2, because '1' < '2'. The combined PDF is then a real document,
  // kept for seven years, with its pages shuffled.
  const given = [page("pagina-1.jpg"), page("pagina-10.jpg"), page("pagina-2.jpg"), page("pagina-11.jpg")];

  // The control, in the assertion itself: this is what the app did before, and it is wrong.
  const plain = [...given].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  assert.deepEqual(
    names(plain),
    ["pagina-1.jpg", "pagina-10.jpg", "pagina-11.jpg", "pagina-2.jpg"],
    "a plain string sort really does put page 10 before page 2 — that is the defect",
  );

  assert.deepEqual(
    names(sortPagesByName(given)),
    ["pagina-1.jpg", "pagina-2.jpg", "pagina-10.jpg", "pagina-11.jpg"],
  );
});

test("[PAGINA-VOLGORDE] a scanner's leading zeros are the same page number", () => {
  // Scanners write scan_007, phones write IMG_0007. Both mean seven.
  assert.equal(naturalCompare("scan_007.jpg", "scan_8.jpg") < 0, true, "007 is before 8");
  assert.equal(naturalCompare("scan_010.jpg", "scan_9.jpg") > 0, true, "010 is after 9");
  assert.deepEqual(
    names(sortPagesByName([page("s_010.jpg"), page("s_002.jpg"), page("s_1.jpg")])),
    ["s_1.jpg", "s_002.jpg", "s_010.jpg"],
  );
});

test("[PAGINA-VOLGORDE] the comparison is a total order, so the sort cannot scramble", () => {
  // An inconsistent comparator makes Array.prototype.sort produce an ARBITRARY permutation — which
  // on this module's inputs means arbitrary page order, the exact failure it is here to prevent.
  // Checked as the three laws rather than by eye.
  const sample = ["a1", "a01", "a2", "a10", "b1", "A1", "a", "a1b", "1", "01", "z"];
  for (const x of sample) assert.equal(naturalCompare(x, x), 0, `reflexive: ${x}`);
  for (const x of sample) {
    for (const y of sample) {
      // `===`, not assert.equal: Math.sign gives -0 for an equal pair and strict assert holds
      // -0 and 0 apart, which would fail on a comparator that is perfectly antisymmetric.
      assert.ok(
        Math.sign(naturalCompare(x, y)) === -Math.sign(naturalCompare(y, x)),
        `antisymmetric: ${x} vs ${y}`,
      );
    }
  }
  for (const x of sample) {
    for (const y of sample) {
      for (const z of sample) {
        if (naturalCompare(x, y) <= 0 && naturalCompare(y, z) <= 0) {
          assert.ok(naturalCompare(x, z) <= 0, `transitive: ${x} ≤ ${y} ≤ ${z}`);
        }
      }
    }
  }
});

test("[PAGINA-VOLGORDE] identical names keep the order they were picked in", () => {
  // A camera hands back "image.jpg" for every shot on some browsers. The sort may not reshuffle
  // those: the order they arrived IS the order they were photographed, and it is all there is.
  const shots = [page("image.jpg", 1, 10), page("image.jpg", 2, 20), page("image.jpg", 3, 30)];
  assert.deepEqual(sortPagesByName(shots).map((p) => p.size), [1, 2, 3]);
});

test("[PAGINA-VOLGORDE] only the NEW group is sorted — a hand-fixed order survives the next add", () => {
  // Rule 1, and the bug it prevents. The owner corrects the order by hand, then adds one more
  // page. Re-sorting the whole tray would silently undo the correction, and a control that undoes
  // the owner's own fix is worse than no control at all.
  const fixedByHand = [page("b.jpg"), page("a.jpg")]; // deliberately NOT alphabetical
  const after = addPages(fixedByHand, [page("d.jpg"), page("c.jpg")], 20);
  assert.deepEqual(names(after.pages), ["b.jpg", "a.jpg", "c.jpg", "d.jpg"]);
});

test("[PAGINA-VOLGORDE] a rearrangement is reported, so the owner is never rearranged behind their back", () => {
  // Rule 2. `sorted` is the difference between "the app put these in order" and "the app changed
  // something and said nothing" — which on screen is indistinguishable from a bug.
  const changed = addPages([], [page("p2.jpg"), page("p1.jpg")], 20);
  assert.equal(changed.sorted, true, "the order the browser gave was not the natural one");

  const untouched = addPages([], [page("p1.jpg"), page("p2.jpg")], 20);
  assert.equal(untouched.sorted, false, "nothing moved, so nothing is claimed");
});

test("[PAGINA-VOLGORDE] the same photo picked twice is one page, and it is counted", () => {
  // Rule 3. A duplicated page in a kept document is as wrong as a missing one — and dropping it
  // without a word is how the owner ends up unable to explain the page count later.
  const tray = [page("bon.jpg", 500, 77)];
  const again = addPages(tray, [page("bon.jpg", 500, 77), page("bon2.jpg", 900, 78)], 20);
  assert.deepEqual(names(again.pages), ["bon.jpg", "bon2.jpg"]);
  assert.equal(again.duplicates, 1);

  // A genuine second page that happens to share a name differs in size or time, and is kept.
  const sameName = addPages([page("scan.jpg", 500, 77)], [page("scan.jpg", 512, 78)], 20);
  assert.equal(sameName.pages.length, 2, "a different photo is a different page");
  assert.equal(sameName.duplicates, 0);
});

test("[PAGINA-VOLGORDE] what does not fit is reported, never trimmed away quietly", () => {
  // [GEEN-STILLE-KAP] on the page tray. Pages 4 and 5 vanishing without a sentence is a document
  // that is short two pages, discovered by whoever reads it a year later.
  const full = addPages([page("a.jpg"), page("b.jpg")], [page("c.jpg"), page("d.jpg"), page("e.jpg")], 3);
  assert.deepEqual(names(full.pages), ["a.jpg", "b.jpg", "c.jpg"]);
  assert.equal(full.overflow, 2, "the caller has a number to say out loud");

  const noRoom = addPages([page("a.jpg")], [page("b.jpg")], 1);
  assert.deepEqual(names(noRoom.pages), ["a.jpg"]);
  assert.equal(noRoom.overflow, 1);
});

test("[PAGINA-VOLGORDE] moving a page is a permutation — nothing is lost or duplicated", () => {
  const tray = [page("a.jpg"), page("b.jpg"), page("c.jpg")];
  assert.deepEqual(names(movePage(tray, 2, -1)), ["a.jpg", "c.jpg", "b.jpg"]);
  assert.deepEqual(names(movePage(tray, 0, 1)), ["b.jpg", "a.jpg", "c.jpg"]);

  // Every move keeps exactly the same pages. A splice pair that dropped one would still LOOK
  // right on a three-page tray read by eye.
  for (let i = 0; i < tray.length; i += 1) {
    for (const dir of [-1, 1] as const) {
      const moved = movePage(tray, i, dir);
      assert.deepEqual([...names(moved)].sort(), [...names(tray)].sort(), `move ${i} ${dir}`);
      assert.equal(moved.length, tray.length);
    }
  }
});

test("[PAGINA-VOLGORDE] a move that cannot happen changes nothing at all", () => {
  const tray = [page("a.jpg"), page("b.jpg")];
  assert.equal(movePage(tray, 0, -1), tray, "the first page has nowhere to go up");
  assert.equal(movePage(tray, 1, 1), tray, "…nor the last page down");
  assert.equal(movePage(tray, 5, 1), tray, "an index off the end is not a reorder");
});
