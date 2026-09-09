// tests/render/intake-progress.test.tsx
// [INTAKE-VOORTGANG] The progress dialog, really rendered, in every phase a row can be in.
//
// The gate reads the source and can see that aria-valuenow is conditional. Only the markup shows
// what a screen reader is actually told for each phase — and that a closed dialog renders nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function render(props: Record<string, unknown>) {
  const { IntakeProgress } = await import("../../src/components/intake/IntakeProgress");
  return renderToStaticMarkup(React.createElement(IntakeProgress as never, props as never));
}

const ROWS = [
  { id: "a", name: "bon-1.jpg", phase: "fitting", percent: 0, phaseLabel: "Bestand wordt klaargemaakt…" },
  { id: "b", name: "factuur-2.pdf", phase: "uploading", percent: 42, phaseLabel: "Uploaden… 42%" },
  { id: "c", name: "bon-3.jpg", phase: "reading", percent: 100, phaseLabel: "Wordt gelezen — dit kan even duren" },
  { id: "d", name: "bon-4.jpg", phase: "done", percent: 100, phaseLabel: "Klaar", outcome: "Factuur — staat in Te controleren" },
  { id: "e", name: "bon-5.jpg", phase: "failed", percent: 30, phaseLabel: "Niet gelukt" },
];
const BASE = { open: true, title: "Bezig met toevoegen", rows: ROWS, closeLabel: "Sluiten — het toevoegen gaat door", footnote: "Je kunt dit sluiten.", onClose: () => {} };

/** The <div role="progressbar"> that belongs to a row, by the name it is labelled with. */
function bar(html: string, name: string): string {
  const at = html.indexOf(`aria-label="${name}"`);
  assert.ok(at > 0, `no bar for ${name}`);
  return html.slice(html.lastIndexOf("<div", at), html.indexOf(">", at) + 1);
}

test("[INTAKE-VOORTGANG] a number only where there is one", async () => {
  const html = await render(BASE);
  assert.ok(html.includes('role="dialog"'));
  // Uploading: the percentage, to the assistive tech and as the fill's width.
  const up = bar(html, "factuur-2.pdf");
  assert.match(up, /aria-valuenow="42"/);
  assert.ok(html.includes("width:42%"), "the fill does not show the percentage");
  // Fitting and reading: no number, a slide.
  for (const name of ["bon-1.jpg", "bon-3.jpg"]) {
    const b = bar(html, name);
    assert.doesNotMatch(b, /aria-valuenow/, `${name}: told a number it does not have`);
    assert.match(b, /progress-indeterminate/, `${name}: no slide — reads as a hang`);
  }
  // Done and failed: full, and only the colour differs.
  for (const name of ["bon-4.jpg", "bon-5.jpg"]) assert.match(bar(html, name), /aria-valuenow="100"/);
  assert.ok(html.includes("Factuur — staat in Te controleren"), "the outcome is not shown under its row");
  // Every word arrived through props.
  for (const s of ["Bezig met toevoegen", "Uploaden… 42%", "Niet gelukt", 'aria-label="Sluiten — het toevoegen gaat door"', "Je kunt dit sluiten."]) {
    assert.ok(html.includes(s), `missing: ${s}`);
  }
});

test("[INTAKE-VOORTGANG] closed, or nothing to show, renders nothing at all", async () => {
  assert.equal(await render({ ...BASE, open: false }), "");
  assert.equal(await render({ ...BASE, rows: [] }), "");
});
