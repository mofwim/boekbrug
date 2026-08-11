// [GEGROND-NAAM] Pure node test — run: npx tsx --test src/lib/vendor-grounding.test.ts
//
// Two properties, and the second is the one that decides whether this feature is worth having.
// It must catch the read that named a DIFFERENT COMPANY, and it must stay silent on the ordinary
// invoice whose name lives only in a logo — because a warning on ordinary invoices is a warning
// nobody reads, and then the real one is not read either.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  groundVendorName, vendorGroundingText, distinctiveTokens,
  MIN_DISTINCTIVE_TOKEN, MIN_TEXT_LENGTH,
} from "./vendor-grounding";

/** The BALKIP invoice, as its text layer reads. Shortened, but every token is from the document. */
const BALKIP = `
BALKIP B.V.  Markweg 25  2153 PG NIEUW-VENNEP  The Netherlands
Mob 1: +316 42 09 35 00  E-mail: info@balkip.nl  Website: www.balkip.nl
K.v.K. 42004547  BTW nr: NL869242805B01  IBAN-code: NL48INGB0000810658
FACTUUR  Factuur Nr 263960  Klant Nr 0036  Datum 06/08/2026  Vervaldag 06/08/2026
KIWI FOOD MARKET  Verdiplein 13  5049MN TILBURG
Artikel Nr Omschrijving Aantal Prijs Bedrag Btw
VLEUGELS 30 2,57 77,10 9   KIP FILET 40 5,77 230,80 9
NETTOBEDRAG 669,57  B.T.W. BEDRAG 60,26  TOTAAL Incl.BTW 729,83 EUR
`;

test("[GEGROND-NAAM] the read that started this is caught", () => {
  // Measured: an invoice printed by BALKIP B.V. was imported as GROOTHANDEL M.H. BAL V.O.F. — a
  // different company — with correct amounts and nothing anywhere saying the name was odd.
  assert.equal(groundVendorName("GROOTHANDEL M.H. BAL V.O.F.", BALKIP), "absent");
  const said = vendorGroundingText("absent", "GROOTHANDEL M.H. BAL V.O.F.");
  assert.match(said ?? "", /GROOTHANDEL M\.H\. BAL V\.O\.F\./, "the owner must be told WHICH name");
  assert.match(said ?? "", /controleer/, "…and what to do about it");
});

test("[GEGROND-NAAM] …and the correct read on that same document passes", () => {
  // The other half. A check that flagged the right answer too would be worthless.
  assert.equal(groundVendorName("BALKIP B.V.", BALKIP), "found");
  assert.equal(groundVendorName("Balkip", BALKIP), "found");
  assert.equal(groundVendorName("balkip bv", BALKIP), "found", "casing and the legal suffix are noise");
});

test("[GEGROND-NAAM] a tidier or fuller name than the paper prints is still found", () => {
  // The reader routinely returns a fuller form than the letterhead carries. Demanding the whole
  // name would call every one of those wrong — one distinctive token is the bar.
  const text = `SLIGRO ${"x".repeat(MIN_TEXT_LENGTH)}`;
  assert.equal(groundVendorName("Sligro Food Group B.V.", text), "found");
});

test("[GEGROND-NAAM] a name printed only in a LOGO is not called wrong", () => {
  // The case that decides whether this can ship. A logo carries no characters, so a perfectly
  // correct read has nothing to find — and this must not speak about it.
  //
  // It cannot distinguish that from a genuine misread, which is exactly why 'absent' is reported
  // as "check this" and never as "this is wrong", and why it does not block anything.
  const noText = "";
  assert.equal(groundVendorName("Balkip B.V.", noText), "unreadable");
  assert.equal(groundVendorName("Balkip B.V.", "  "), "unreadable");
  // A few stray characters are not a document either.
  assert.equal(groundVendorName("Balkip B.V.", "Pagina 1"), "unreadable");
  assert.equal(vendorGroundingText("unreadable", "Balkip B.V."), null, "and it says nothing at all");
});

test("[GEGROND-NAAM] a placeholder name is never searched for", () => {
  // "Onbekende afzender" is what the reader writes when it could not tell. Reporting that as
  // absent-from-the-document would put a warning on every unread invoice, saying nothing new.
  for (const n of ["Onbekende afzender", "onbekend", "", null, undefined]) {
    assert.equal(groundVendorName(n, BALKIP), "unreadable", String(n));
  }
});

test("[GEGROND-NAAM] a name with no distinctive token cannot produce a verdict", () => {
  // "K&M BV" normalises to one two-letter token. A miss on that says more about the threshold
  // than about the invoice, so the honest answer is that the check could not run.
  assert.deepEqual(distinctiveTokens("K&M BV"), []);
  assert.equal(groundVendorName("K&M BV", BALKIP), "unreadable");
  // …and the threshold is where the header says it is.
  assert.deepEqual(distinctiveTokens("Ozer Food B.V."), ["ozer", "food"]);
  assert.ok("bal".length < MIN_DISTINCTIVE_TOKEN, "a 3-letter token is not evidence");
});

test("[GEGROND-NAAM] a token is matched WHOLE, never as a fragment", () => {
  // The false-corroboration trap. "bal" occurs inside "balans" and "totaal"; if fragments counted,
  // the very read this file exists to catch would have been confirmed by the word "TOTAAL".
  const text = `Totaalbedrag balans betaalbaar ${"y".repeat(MIN_TEXT_LENGTH)}`;
  assert.equal(groundVendorName("Bala B.V.", text), "absent", "'bala' inside 'balans' is not a hit");
  assert.equal(groundVendorName("Balans B.V.", text), "found", "…but the whole word is");
});

test("[GEGROND-NAAM] punctuation and accents in the document do not hide a name", () => {
  // A text layer separates tokens with all sorts of characters, and a supplier can carry an accent.
  const text = `Factuur van  Café-Zeeland,  B.V.  ${"z".repeat(MIN_TEXT_LENGTH)}`;
  assert.equal(groundVendorName("Cafe Zeeland BV", text), "found");
});

// ── The path from the reader to the owner's screen ────────────────────────────────────────────

import { classifyImportHealth } from "./import-health";

const CLEAN = {
  total_ex_btw: 669.57, btw_amount: 60.26, total_inc_btw: 729.83,
  invoice_date: "2026-08-06", invoice_number: "263960",
};

test("[GEGROND-NAAM] an unfound name reaches the owner as a review reason, on the VENDOR field", () => {
  // The whole chain, not just the verdict: a check nobody is shown is a check that did not happen.
  const h = classifyImportHealth({
    ...CLEAN,
    field_confidence: {
      _vendorGrounding: { verdict: "absent", name: "GROOTHANDEL M.H. BAL V.O.F." },
    } as never,
  });
  assert.notEqual(h.level, "clean", "it must not pass as a clean import");
  assert.ok(
    h.reasons.some((r) => r.includes("GROOTHANDEL M.H. BAL V.O.F.")),
    `the owner must be told which name: ${JSON.stringify(h.reasons)}`,
  );
  // The VENDOR field, not the amounts. On the measured invoice the three amounts were correct, and
  // pointing at them would send the owner to the only part that was right.
  assert.equal(h.flags.vendor, true, "the card must be able to highlight the supplier");
});

test("[GEGROND-NAAM] a found or unrunnable check adds nothing at all", () => {
  // The regression that matters: every invoice imported before this existed carries no
  // _vendorGrounding, and every ordinary one from now on will say 'found' or 'unreadable'.
  for (const v of [undefined, { verdict: "found", name: "Balkip B.V." }, { verdict: "unreadable", name: "X" }]) {
    const h = classifyImportHealth({
      ...CLEAN,
      field_confidence: (v ? { _vendorGrounding: v } : {}) as never,
    });
    assert.equal(h.flags.vendor, false, JSON.stringify(v));
    assert.equal(
      h.reasons.some((r) => r.includes("staat nergens in de tekst")), false, JSON.stringify(v),
    );
  }
});

test("[GEGROND-NAAM] a missing name still produces a sentence, never a template hole", () => {
  const h = classifyImportHealth({
    ...CLEAN,
    field_confidence: { _vendorGrounding: { verdict: "absent", name: null } } as never,
  });
  const said = h.reasons.find((r) => r.includes("staat nergens in de tekst")) ?? "";
  assert.ok(said.length > 0);
  assert.doesNotMatch(said, /null|undefined|""/, "a hole where the name should be");
});
