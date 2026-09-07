// tests/render/bank-bijlage-strip.test.tsx
// [BIJLAGE-BIJ-REGEL] · [REGEL-WEG] The strip under a bank line renders its attachments, the add
// button, and the delete button only when the caller offers one — with rows that exercise both.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BijlageStrip from "../../src/components/bank/BijlageStrip";
import { translator } from "../../src/lib/i18n/t";

const t = translator("nl") as unknown as (k: string) => string;
const noop = () => undefined;
const two = [
  { id: "a1", documentId: "d1", fileName: "bon-albert-heijn.jpg", fileType: "image/jpeg", createdAt: "2026-09-01T10:00:00Z" },
  { id: "a2", documentId: "d2", fileName: "betaalbewijs.pdf", fileType: "application/pdf", createdAt: "2026-09-02T10:00:00Z" },
];

test("[BIJLAGE-BIJ-REGEL] two attachments, the add button, and a delete button on an unlinked line", () => {
  const html = renderToStaticMarkup(
    <BijlageStrip attachments={two} t={t} onDeleteLine={noop} onAddFile={noop} onOpen={noop} onRemove={noop} />,
  );
  assert.ok(html.length > 0);
  assert.match(html, /bon-albert-heijn\.jpg/);
  assert.match(html, /betaalbewijs\.pdf/);
  assert.match(html, /Bestand toevoegen/);
  assert.match(html, /Regel verwijderen/);
  assert.doesNotMatch(html, /definitief verwijderen\?/, "the question appears only after the first tap");
});

test("[REGEL-WEG] a linked line gets no delete button; an empty list still offers the add button", () => {
  const html = renderToStaticMarkup(
    <BijlageStrip attachments={[]} t={t} onAddFile={noop} onOpen={noop} onRemove={noop} />,
  );
  assert.match(html, /Bestand toevoegen/);
  assert.doesNotMatch(html, /Regel verwijderen/);
});

test("[TAAL] the strip holds no language of its own — Arabic renders Arabic", () => {
  const ar = translator("ar") as unknown as (k: string) => string;
  const html = renderToStaticMarkup(
    <BijlageStrip attachments={two} t={ar} onDeleteLine={noop} onAddFile={noop} onOpen={noop} onRemove={noop} />,
  );
  assert.match(html, /إضافة ملف/);
  assert.doesNotMatch(html, /Bestand toevoegen|Regel verwijderen/);
});
