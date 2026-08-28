// [PROEFDOSSIER] Pure node test — run: npx tsx --test src/lib/voorbeeld-dossier.test.ts
//
// The reader of this screen is an accountant: exactly the person who recomputes a column. Every
// number is therefore recomputed here INDEPENDENTLY (own arithmetic, not the module's helpers
// where that matters), and the honesty rule — the questioned invoice counts nowhere — is pinned
// as arithmetic rather than as a sentence.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VOORBEELD_KLANT,
  VOORBEELD_VERKOOP,
  VOORBEELD_INKOOP,
  btwVan,
  inclVan,
  dossierTotalen,
} from "./voorbeeld-dossier";

test("[PROEFDOSSIER] every row's BTW and total multiply out — an accountant will check", () => {
  for (const r of VOORBEELD_VERKOOP) {
    assert.equal(btwVan(r.exBtw, r.btwTarief), Math.round(r.exBtw * r.btwTarief) / 100);
    assert.equal(inclVan(r.exBtw, r.btwTarief), r.exBtw + btwVan(r.exBtw, r.btwTarief));
  }
  for (const r of VOORBEELD_INKOOP) {
    assert.equal(inclVan(r.exBtw, r.btwTarief), r.exBtw + btwVan(r.exBtw, r.btwTarief));
  }
});

test("[PROEFDOSSIER] the tiles are the columns, recomputed independently", () => {
  const t = dossierTotalen();
  assert.equal(t.omzetEx, 1500 + 750);
  assert.equal(t.btwVerschuldigd, 135 + 67.5);
  // Only the two confirmed purchase rows — 400@9% and 180@21%.
  assert.equal(t.kostenEx, 400 + 180);
  assert.equal(t.voorbelasting, 36 + 37.8);
  assert.equal(t.saldo, 202.5 - 73.8);
});

test("[PROEFDOSSIER] the questioned invoice counts NOWHERE — the pitch is arithmetic, not a claim", () => {
  const t = dossierTotalen();
  const vraagRij = VOORBEELD_INKOOP.find((r) => r.status === "vraag");
  assert.ok(vraagRij, "the file must CONTAIN an open question — that is the differentiator");
  assert.ok(vraagRij.vraag && vraagRij.vraag.length > 10, "…and the question is a real sentence");
  // Its base is not in kosten, its BTW not in voorbelasting.
  assert.ok(Math.abs(t.kostenEx - (400 + 180 + vraagRij.exBtw)) > 0.01, "base excluded");
  assert.ok(Math.abs(t.voorbelasting - (73.8 + btwVan(vraagRij.exBtw, vraagRij.btwTarief))) > 0.01, "BTW excluded");
  assert.equal(t.openVragen, 1);
  assert.equal(t.verwerkteInkoop, 2);
});

test("[PROEFDOSSIER] the file cannot be mistaken for a real administration", () => {
  // The client name carries the word that says so, and stays fictional if anyone edits the data.
  assert.match(VOORBEELD_KLANT, /Voorbeeld/i, "the name itself must say it is an example");
  // Real invoice numbers of the pilot start at 20260001 and are LIVE — the fictional series must
  // not collide with a plausible real document… but any 2026xxxx could. What protects reality is
  // the module boundary (no DB write exists), held by the lifecycle gate; here we pin that at
  // least the numbers stay in the range the screen presents as belonging to the fictional bakery.
  for (const r of VOORBEELD_VERKOOP) assert.match(r.nummer, /^2026\d{4}$/);
});
