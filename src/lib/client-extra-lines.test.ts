// [KLANT-EXTRA] Pure node test — run: npx tsx --test src/lib/client-extra-lines.test.ts
//
// Two properties carry this file. An owner who fills one field must not get a HOLE where the other
// would have been, and an invoice with neither filled must render exactly the document it rendered
// before this field existed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanExtraLine, clientExtraLines, MAX_EXTRA_LINE_LENGTH } from "./client-extra-lines";

test("[KLANT-EXTRA] both lines, in the order they were typed", () => {
  assert.deepEqual(
    clientExtraLines({ client_extra_line1: "t.a.v. mevrouw Jansen", client_extra_line2: "PO-2026-114" }),
    ["t.a.v. mevrouw Jansen", "PO-2026-114"],
  );
});

test("[KLANT-EXTRA] only the second filled leaves no gap above it", () => {
  // The reason this is a function and not two fields read straight onto the page: a blank Text row
  // between the customer's name and their street is a visible defect on a document that goes out.
  assert.deepEqual(clientExtraLines({ client_extra_line2: "Afdeling Inkoop" }), ["Afdeling Inkoop"]);
  assert.deepEqual(clientExtraLines({ client_extra_line1: "   ", client_extra_line2: "Inkoop" }), ["Inkoop"]);
});

test("[KLANT-EXTRA] nothing filled is nothing rendered — the document that existed before", () => {
  // Every invoice ever created has these two columns null. They must all keep rendering unchanged.
  for (const src of [null, undefined, {}, { client_extra_line1: null, client_extra_line2: null },
                     { client_extra_line1: "", client_extra_line2: "  \n " }]) {
    assert.deepEqual(clientExtraLines(src), [], JSON.stringify(src));
  }
});

test("[KLANT-EXTRA] a pasted multi-line signature becomes ONE line", () => {
  // This is a single Text row on the PDF. A newline through it breaks the address block.
  assert.equal(cleanExtraLine("t.a.v.\nmevrouw   Jansen\r\n"), "t.a.v. mevrouw Jansen");
  assert.equal(clientExtraLines({ client_extra_line1: "a\nb" }).length, 1);
});

test("[KLANT-EXTRA] a pasted paragraph is bounded, and cut on a clean edge", () => {
  const long = cleanExtraLine("x".repeat(500));
  assert.equal(long.length, MAX_EXTRA_LINE_LENGTH, "an essay cannot push the address block down");
  // No trailing space left behind by the cut — it would render as a line that looks unfinished.
  assert.equal(cleanExtraLine(`${"a".repeat(MAX_EXTRA_LINE_LENGTH - 1)} tail`).endsWith(" "), false);
});

test("[KLANT-EXTRA] a line exactly at the limit is kept whole", () => {
  // Off-by-one here silently eats the last character of a purchase-order reference, which is the
  // one thing on the line that has to be exact for the customer's system to match it.
  const exact = "P".repeat(MAX_EXTRA_LINE_LENGTH);
  assert.equal(cleanExtraLine(exact), exact);
  assert.equal(cleanExtraLine(exact).length, MAX_EXTRA_LINE_LENGTH);
});

test("[KLANT-EXTRA] non-string input cannot reach a document as 'null' or '[object Object]'", () => {
  // These arrive from an API body and from a database column, so neither is guaranteed to be text.
  for (const v of [null, undefined, 0, false, {}, []]) {
    const out = cleanExtraLine(v as unknown as string);
    assert.doesNotMatch(out, /null|undefined|object Object/, JSON.stringify(v));
  }
  // A number the owner somehow sent is still their content — it is kept, not dropped.
  assert.equal(cleanExtraLine(2026 as unknown as string), "2026");
});
