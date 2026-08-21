// [VERANTWOORDING] Run: npx tsx --test src/lib/verantwoording.test.ts
//
// This page is the one document in the quarter package meant to be shown to a THIRD party — the
// client, a reviewer, the Belastingdienst at a boekencontrole. So it is tested the way the invoice
// PDF is: rendered for real and read back out of the text layer, because the only thing that says
// what a document states is the document.
//
// Two failure modes are expensive here and they are opposites. Claiming too much — looking like an
// accountantsverklaring, or printing a BTW figure as if it were a filed aangifte — puts a statement
// in somebody's file that nobody made. Claiming too little — a cover sheet with only good news —
// makes it the page that gets quoted while what it omitted is the part he is asked about.

import { test, before } from "node:test";
import assert from "node:assert/strict";

import { handoverSentence, type Verantwoording } from "./verantwoording";
import { renderVerantwoordingPdf } from "./verantwoording-pdf";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getDocument: any;
before(async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  getDocument = pdfjs.getDocument;
});

async function pdfText(buf: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out += content.items.map((it: any) => it.str + (it.hasEOL ? "\n" : "")).join("") + "\n";
  }
  return out;
}

const V = (over: Partial<Verantwoording> = {}): Verantwoording => ({
  quarterLabel: "Q1 2026",
  clientName: "Kiwi Food Market",
  kvkNumber: "94386676",
  btwNumber: "NL005079680B23",
  generatedAt: "2026-04-08T09:15:00.000Z",
  outgoingCount: 12,
  incomingCount: 30,
  filesIncluded: 44,
  eInvoiceCount: 7,
  bankStatementIncluded: true,
  salesByRate: [{ rate: 21, totalExcl: 1000, totalBtw: 210 }, { rate: 9, totalExcl: 400, totalBtw: 36 }],
  totalSalesIncl: 1646,
  totalPurchaseIncl: 820,
  btwOnSales: 246,
  btwOnPurchases: 142.3,
  handover: { lines: 40, matched: 34, unmatched: 6, matchedAmount: 4210, unmatchedAmount: 380, withDifference: 2 },
  warnings: [],
  ...over,
});

const textOf = async (over: Partial<Verantwoording> = {}) => pdfText(await renderVerantwoordingPdf(V(over)));

// ─── The line it may not cross ───────────────────────────────────────────────────────

test("[VERANTWOORDING] it says what it is NOT, on the same page as the numbers", async () => {
  // THE ONE THAT MATTERS. A samenstellingsverklaring and an accountantsverklaring are regulated
  // statements made by a person who answers for them. A page that merely LOOKS like one puts a
  // claim in an accountant's file that he never made, about work he has not yet done.
  const text = await textOf();
  assert.ok(text.includes("geen accountantsverklaring"), "the page must disclaim what it is not");
  assert.ok(text.includes("samenstellingsverklaring"));
  assert.ok(text.includes("geen aangifte ingediend"), "a BTW figure on a cover sheet reads as a filing unless it says otherwise");
  assert.ok(text.includes("er is niet geboekt"));
  assert.ok(/beoordeling[\s\S]*boekhouder/.test(text), "and whose work the assessment remains");
});

test("[VERANTWOORDING] the BTW figures are labelled raw, never as a return", async () => {
  const text = await textOf();
  assert.ok(text.includes("ruwe cijfers"), "the heading must say these are raw amounts");
  assert.ok(!/te betalen BTW|terug te vragen/i.test(text), "computing a vat_due here would be filing by implication");
});

// ─── What it must always carry ───────────────────────────────────────────────────────

test("[VERANTWOORDING] the counts and the identity are on the page", async () => {
  const text = await textOf();
  assert.ok(text.includes("Kiwi Food Market"));
  assert.ok(text.includes("Q1 2026"));
  assert.ok(text.includes("94386676"), "the KvK number — the page is filed against a legal entity");
  assert.ok(text.includes("NL005079680B23"));
  assert.ok(text.includes("08-04-2026"), "when it was handed over is half of what this page proves");
  assert.ok(text.includes("12") && text.includes("30") && text.includes("44"));
});

test("[VERANTWOORDING] every warning is printed in full, in the same type as the good news", async () => {
  // A cover sheet with only successes on it is the page somebody quotes later, and what it left
  // out is what he is asked about.
  const text = await textOf({
    warnings: [
      { code: "bank_missing", message: "Geen banktransacties gevonden voor dit kwartaal." },
      { code: "efactuur_missing", message: "Van 2 facturen kon geen e-factuur worden gemaakt: 001, 002." },
    ],
  });
  assert.ok(text.includes("niet hebben kunnen vaststellen"));
  assert.ok(text.includes("Geen banktransacties gevonden"));
  assert.ok(text.includes("Van 2 facturen kon geen e-factuur"));

  const clean = await textOf({ warnings: [] });
  assert.ok(clean.includes("geen onvolkomenheden"), "a clean quarter says so, rather than leaving an empty heading");
  assert.ok(!clean.includes("niet hebben kunnen vaststellen"));
});

test("[VERANTWOORDING] the reconciliation is stated, with what is still open", async () => {
  const text = await textOf();
  assert.ok(text.includes("34 van de 40 bankregels"));
  assert.ok(text.includes("6 regels staan nog open"));
  assert.ok(text.includes("bankafletering.csv"), "…and where to find them");
});

test("[VERANTWOORDING] no reconciliation is silence, never a finished job", async () => {
  // A bank read that failed produces handover: null. "0 van 0 gekoppeld" on that page would be a
  // claim about a quarter nobody looked at.
  const text = await textOf({ handover: null });
  assert.ok(text.includes("geen afletering vastgelegd"));
  assert.ok(!/van de 0 bankregels/.test(text));
});

test("[VERANTWOORDING] it is one page with a real text layer", async () => {
  // Everything above reads the text layer, so this is the control: a renderer that produced an
  // image would make every assertion above vacuous, and a second page means the disclaimer at the
  // bottom is no longer under the numbers it qualifies.
  const buf = await renderVerantwoordingPdf(V({
    warnings: Array.from({ length: 6 }, (_, i) => ({ code: `w${i}`, message: `Waarschuwing nummer ${i} over iets dat we niet konden vaststellen.` })),
  }));
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  assert.equal(doc.numPages, 1, "with six warnings it must still be one page");
  const content = await (await doc.getPage(1)).getTextContent();
  assert.ok(content.items.length > 40, `only ${content.items.length} text items — this reads as an image`);
});

// ─── The sentence, as a value ────────────────────────────────────────────────────────

test("[VERANTWOORDING] the reconciliation sentence reads like Dutch in every shape", () => {
  const h = (over: Partial<import("./bank-handover").HandoverTotals> = {}) => ({
    lines: 40, matched: 34, unmatched: 6, matchedAmount: 0, unmatchedAmount: 0, withDifference: 0, ...over,
  });
  assert.match(handoverSentence(h())!, /34 van de 40 bankregels zijn aan een factuur gekoppeld; 6 regels staan nog open\./);
  assert.match(handoverSentence(h({ lines: 1, matched: 1, unmatched: 0 }))!, /1 van de 1 bankregels is aan een factuur gekoppeld; er staat geen regel meer open\./);
  assert.match(handoverSentence(h({ matched: 39, unmatched: 1 }))!, /één regel staat nog open/);
  assert.equal(handoverSentence(null), null);
  assert.equal(handoverSentence(h({ lines: 0, matched: 0, unmatched: 0 })), null, "a quarter with no bank lines makes no claim");
});

// ─── [DEKKING] The qualification that must be read in the same breath ─────────────────

test("[VERANTWOORDING] an incomplete quarter is qualified where the numbers are, not only below", () => {
  // This is the page somebody quotes. A reader who quotes "34 van de 40 gekoppeld" must have read
  // the qualification in the same breath — not four lines lower under a different heading, and
  // certainly not in another file.
  return (async () => {
    const text = await textOf({
      coverage: "Van dit kwartaal ontbreken 28 dagen aan bankafschrift: 1-2-2026 t/m 28-2-2026.",
      warnings: [{ code: "bank_coverage_incomplete", message: "Van dit kwartaal ontbreken 28 dagen aan bankafschrift." }],
    });
    const qualifyAt = text.indexOf("niet volledig ingelezen");
    const claimAt = text.indexOf("34 van de 40");
    assert.notEqual(qualifyAt, -1, "the page states a reconciliation over a quarter it never says was incomplete");
    assert.ok(qualifyAt < claimAt, "the qualification must come before the claim it qualifies");
    assert.ok(text.includes("28 dagen"));

    // And still among the warnings, deliberately twice: the sections are read by different people
    // for different reasons.
    assert.ok(text.includes("niet hebben kunnen vaststellen"));
  })();
});

test("[VERANTWOORDING] a complete quarter is not qualified at all", () => {
  return (async () => {
    const text = await textOf({ coverage: null });
    assert.ok(!text.includes("niet volledig ingelezen"), "a caveat on every page is a caveat nobody reads");
  })();
});
