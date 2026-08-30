// src/lib/package-fingerprint.test.ts
// Run: npx tsx --test src/lib/package-fingerprint.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  contentOf, fingerprint, driftBetween, driftSentence, driftMeaning,
  type PackageContent,
} from "./package-fingerprint";

const c = (over: Partial<PackageContent> = {}): PackageContent => ({
  outgoingCount: 20, incomingCount: 27, filesIncluded: 47, invoicesWithPdf: 44,
  missingEvidence: ["F-2026-014", "F-2026-021"], bankStatementIncluded: true,
  warningCodes: ["missing_pdf"], ...over,
});

test("[PAKKET-AFDRUK] the print is about CONTENT — the same package twice prints the same", () => {
  const summary = {
    outgoingCount: 20, incomingCount: 27, filesIncluded: 47, invoicesWithPdf: 44,
    missingEvidence: ["F-2026-021", "F-2026-014"], bankStatementIncluded: true,
    warnings: [{ code: "missing_pdf" }, { code: "missing_pdf" }],
  };
  // generatedAt is deliberately absent: it differs on every download, and folding it in would mark
  // every package as changed — which is the same as saying nothing.
  assert.equal(fingerprint(contentOf({ ...summary })), fingerprint(contentOf({ ...summary })));
  // Order came back differently, contents identical → the same print. Two reads that returned in a
  // different order are not two different packages.
  assert.equal(
    fingerprint(contentOf({ ...summary, missingEvidence: ["F-2026-014", "F-2026-021"] })),
    fingerprint(contentOf(summary)),
    "the order a list came back in is not part of what was delivered",
  );
  // A duplicated warning code is one warning.
  assert.equal(contentOf(summary).warningCodes.length, 1);
  // And a real change moves it.
  assert.notEqual(fingerprint(c()), fingerprint(c({ incomingCount: 28 })));
});

test("[PAKKET-AFDRUK] the same numbers, two meanings — this is the whole point", () => {
  // ONE: a late purchase invoice. The FIGURES moved, so what the accountant is reading is stale.
  const cijfers = driftBetween(c(), c({ incomingCount: 28, filesIncluded: 48, invoicesWithPdf: 45 }));
  assert.equal(cijfers.kind, "figures_moved");
  assert.equal(cijfers.needsAction, true);

  // TWO: a receipt arrived for an invoice that was ALREADY counted. Every amount is what it was;
  // the package is simply better proved. Same direction of movement in filesIncluded, opposite
  // meaning — and nobody has to do anything.
  const bewijs = driftBetween(
    c(),
    c({ filesIncluded: 48, invoicesWithPdf: 45, missingEvidence: ["F-2026-021"], warningCodes: [] }),
  );
  assert.equal(bewijs.kind, "evidence_improved");
  assert.equal(bewijs.needsAction, false, "waking the owner for good news teaches him to ignore the next alarm");
  assert.match(driftSentence("Q3 2026", "2026-04-12T09:00:00Z", bewijs)!, /hoeft niets te gebeuren/);

  // THREE: evidence went AWAY. No amount says so, and nobody re-checks a package.
  const kwijt = driftBetween(c(), c({ invoicesWithPdf: 43, missingEvidence: ["F-2026-014", "F-2026-021", "F-2026-030"] }));
  assert.equal(kwijt.kind, "evidence_lost");
  assert.equal(kwijt.needsAction, true);
  assert.match(driftSentence("Q3 2026", "2026-04-12T09:00:00Z", kwijt)!, /MINDER goed onderbouwd/);
});

test("[PAKKET-AFDRUK] a count that stays equal can still hide two events", () => {
  // One receipt arrived and another fell away: invoicesWithPdf is unchanged, the NAMES are not.
  const d = driftBetween(c(), c({ missingEvidence: ["F-2026-014", "F-2026-099"] }));
  assert.equal(d.changed, true, "the totals agree, so only the names could show this");
  assert.equal(d.evidenceDelta, 0);
  assert.match(d.reasons.join(" "), /F-2026-099/);
  assert.match(d.reasons.join(" "), /F-2026-021/);
  assert.equal(d.kind, "evidence_lost", "a bon that fell away is the half that needs someone");
  // The bank statement disappearing is its own sentence — no count moves with it.
  const zonderBank = driftBetween(c(), c({ bankStatementIncluded: false }));
  assert.match(zonderBank.reasons.join(" "), /bankafschrift zit er niet meer bij/);
  assert.equal(zonderBank.kind, "evidence_lost");
});

test("[PAKKET-AFDRUK] an unchanged package says nothing at all", () => {
  const d = driftBetween(c(), c());
  assert.equal(d.changed, false);
  assert.equal(d.kind, null);
  assert.equal(driftSentence("Q3 2026", "2026-04-12T09:00:00Z", d), null);
  assert.equal(driftMeaning("Q3 2026", "2026-04-12T09:00:00Z", d, { filed: true, route: "suppletie", outstandingEur: 5000 }), null,
    "no drift is no message, whatever the quarter's standing");
});

test("[PAKKET-AFDRUK] what it MEANS depends on whether the quarter was filed", () => {
  const cijfers = driftBetween(c(), c({ incomingCount: 28 }));
  const at = "2026-04-12T09:00:00Z";

  // Open quarter: this is bookkeeping. Dressing it as a legal matter is its own kind of wrong.
  const open = driftMeaning("Q3 2026", at, cijfers, { filed: false, route: null, outstandingEur: null })!;
  assert.doesNotMatch(open, /ingediend|suppletie/i);

  // Filed, over €1.000 → a suppletie, and the sentence must say it cannot ride along.
  const supp = driftMeaning("Q3 2026", at, cijfers, { filed: true, route: "suppletie", outstandingEur: 1240.5 })!;
  assert.match(supp, /INGEDIEND/);
  assert.match(supp, /suppletie/);
  assert.match(supp, /€ 1\.240,50/);

  // Filed, under €1.000 → may be carried into the next return.
  const carry = driftMeaning("Q3 2026", at, cijfers, { filed: true, route: "carry", outstandingEur: 183.42 })!;
  assert.match(carry, /volgende gewone aangifte/);
  assert.doesNotMatch(carry, /suppletie/);

  // Filed, but the BTW lands on the same figure → nothing to correct.
  const geen = driftMeaning("Q3 2026", at, cijfers, { filed: true, route: "none", outstandingEur: 0 })!;
  assert.match(geen, /hoeft niets te worden gecorrigeerd/);

  // [NO-SILENT-EMPTY] route null on a FILED quarter is "we could not work it out", never "nothing
  // to do". Treating those as the same is how an obligation goes quiet: the owner reads that
  // nothing is needed, while nobody looked.
  const onbekend = driftMeaning("Q3 2026", at, cijfers, { filed: true, route: null, outstandingEur: null })!;
  assert.match(onbekend, /konden niet vaststellen/);
  assert.doesNotMatch(onbekend, /hoeft niets/);

  // Evidence-only movement on a filed quarter: the aangifte's amounts do not change by it.
  const bewijs = driftBetween(c(), c({ invoicesWithPdf: 45, missingEvidence: ["F-2026-021"] }));
  const filedBewijs = driftMeaning("Q3 2026", at, bewijs, { filed: true, route: "none", outstandingEur: 0 })!;
  assert.match(filedBewijs, /bedragen in die aangifte veranderen hier niet door/);
  assert.doesNotMatch(filedBewijs, /suppletie/);
});
