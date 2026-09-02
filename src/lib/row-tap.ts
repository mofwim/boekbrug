// src/lib/row-tap.ts
// [TEKST-SELECTIE] Selecting text inside a row is not a tap on the row.
// Run: npx tsx --test src/lib/row-tap.test.ts
//
// Reported with a screenshot: on /dashboard/incoming/manage the owner tried to select an invoice
// number to copy it — 26704047 — and the card opened and closed under the cursor while they
// dragged. Every list of invoices in this app has the same shape: the whole row carries the
// onClick that expands it, so a drag that begins on the number ends in a click on the row.
//
// It matters more than it sounds. The invoice number is the thing an owner copies most: into a
// bank transfer's description, into an e-mail to the supplier, into a search. It is also the one
// field they cannot retype from memory. So the app made its most-copied value the hardest to copy.
//
// THE RULE: a gesture that selected text is not a tap. Two cases, and both are needed —
//
//   · a drag-select ends with a live, non-collapsed selection inside the row;
//   · a double-click to select a word fires TWO clicks, and the first one lands before any
//     selection exists — so the click COUNT has to be read as well, or the row still toggles once.
//
// What deliberately does NOT suppress the tap: movement alone. A finger that slides a few pixels
// on a phone is an ordinary tap, and a row that refuses to open is a worse bug than the one this
// fixes. A drag that selected nothing has taken nothing away, so it may toggle.

/** What a click has to tell us about itself. Pure: no DOM, no React. */
export interface RowGesture {
  /** A live, non-collapsed text selection anchored inside the row that was clicked. */
  selectionInsideRow: boolean;
  /** MouseEvent.detail — 1 for a single click, 2 for the second click of a double-click. */
  clickCount: number;
}

/** True when this click selected text and must therefore not toggle the row. */
export function tapSelectedText(g: RowGesture): boolean {
  return g.selectionInsideRow || g.clickCount > 1;
}

/**
 * Is there a live text selection anchored inside this element?
 *
 * The anchor and not merely "any selection": a selection left over somewhere else on the page
 * would otherwise swallow an honest tap on a row that had nothing to do with it.
 */
export function selectionAnchoredIn(row: Element | null | undefined): boolean {
  if (!row || typeof window === "undefined" || typeof window.getSelection !== "function") return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const anchor = sel.anchorNode;
  if (!anchor) return false;
  // 1 = ELEMENT_NODE. A text node's own parent is what the row can contain.
  const el = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
  return !!el && row.contains(el);
}

/**
 * Wrap a row's tap handler so a text selection never toggles it.
 *
 * Typed structurally rather than against React.MouseEvent so this module stays free of React —
 * a real click event satisfies it, and the tests can hand it a plain object.
 */
export function onRowTap(run: () => void) {
  return (e: { currentTarget: Element; detail: number }) => {
    if (tapSelectedText({ selectionInsideRow: selectionAnchoredIn(e.currentTarget), clickCount: e.detail })) return;
    run();
  };
}
