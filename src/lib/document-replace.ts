// src/lib/document-replace.ts
// [BETER-EXEMPLAAR] May this invoice's original document be replaced by a better copy? Pure.
// Run: npx tsx --test src/lib/document-replace.test.ts
//
// ── WHY THE OLD REFUSAL WAS RIGHT, AND WHY IT NO LONGER APPLIES ──
//
// /api/invoice/[id]/document only ever filled an EMPTY slot, and said why in its own words:
// "Replacing an existing document is a different act with a different risk (it discards evidence),
// so it is refused: this route only ever fills an empty slot."
//
// That reason is exact — and it is a reason against DISCARDING, not against replacing. So this
// flow discards nothing. The previous document row stays exactly where it is: still in Mijn
// bestanden, still untrashed, still kept for the seven years art. 52 AWR asks for. What changes is
// only which of the two the invoice POINTS AT, and the audit trail records both ids so the swap is
// reconstructable a year later.
//
// ── THE CASE IT IS FOR ──
//
// A photograph taken in a hurry, and later the supplier's real PDF of the SAME paper. One document,
// a better copy. Until now the owner could correct every number on the screen and was stuck with
// the blurry picture underneath it — which is the copy the accountant opens.
//
// ── THE CASE IT IS NOT FOR ──
//
// A supplier who REISSUES an invoice with different amounts under the same number. That is two
// documents, not one document twice, and the app has its own answer for it ([DEDUP-CORRECTED] at
// the import doors, "Deze vervangt factuur X" on the screens). Swapping the file there would leave
// one row whose numbers and paper quietly agree while the earlier version — which may already sit
// in a filed quarter — vanishes from view. Nothing here can tell those two cases apart, so the
// SCREEN has to ask the owner which they are doing, and this module only ever answers the narrow
// question it is given.
//
// ── WHY THE ACCOUNTANT'S LOCK BLOCKS THIS AND NOT THE EMPTY SLOT ──
//
// Filling an empty slot ADDS evidence to a booked figure; the accountant's check is unaffected and
// the route lets it through on exactly that argument. Replacing CHANGES which document backs a
// figure they already checked and signed off. The verdict may be identical, but it would no longer
// be the verdict they gave, and only they can say whether that matters.

export type DocumentSlotPlan =
  /** Nothing is attached yet — the original behaviour, unchanged. */
  | { ok: true; mode: "fill" }
  /** A better copy of the same paper. The previous row is KEPT and named for the audit trail. */
  | { ok: true; mode: "replace"; previousDocumentId: string }
  | { ok: false; code: string; error: string };

export interface DocumentSlotInput {
  /** What the invoice points at now, if anything. */
  currentDocumentId: string | null | undefined;
  /** Did the owner explicitly ask to replace? Never inferred — a swap must be deliberate. */
  replaceRequested: boolean;
  /** 'verwerkt' once the accountant has processed this invoice. */
  accountantStatus: string | null | undefined;
}

export function planDocumentSlot(input: DocumentSlotInput): DocumentSlotPlan {
  const current = (input.currentDocumentId ?? "").trim();

  // Empty slot: the original flow, and asking to "replace" nothing is simply that.
  if (!current) return { ok: true, mode: "fill" };

  // Something is attached and nobody asked to change it. The same 409 as before — a screen that
  // uploads into an occupied slot is a screen that has not asked its owner anything.
  if (!input.replaceRequested) {
    return {
      ok: false,
      code: "heeft_al_een_origineel",
      error: "Bij deze factuur zit al een origineel document.",
    };
  }

  if ((input.accountantStatus ?? "") === "verwerkt") {
    return {
      ok: false,
      code: "verwerkt",
      error:
        "Je boekhouder heeft deze factuur al verwerkt en daarbij dit document gecontroleerd. " +
        "Vraag hem het bestand te vervangen — dan weet hij dat zijn controle over een ander " +
        "exemplaar ging.",
    };
  }

  return { ok: true, mode: "replace", previousDocumentId: current };
}
