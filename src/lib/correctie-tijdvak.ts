// src/lib/correctie-tijdvak.ts
// [CORRECTIE-TIJDVAK] Correcting an invoice is one thing. Correcting a FILED aangifte is another.
//
// The machinery for the second already exists and is live: btw-filing.ts computes the divergence
// between what was filed and what the books now say, decides whether a suppletie is needed, and
// which route it takes (correctionRoute). What nothing did was ask the question that connects the
// two — BEFORE the correction, at the moment the owner or their accountant proposes it:
//
//     Does this correction land in a quarter that has already gone to the Belastingdienst?
//
// correction-proposal.ts and correction-scope.ts never looked. So a €121 creditnota against a
// July invoice was, to the app, the same act in September (Q3 still open, nothing owed to anyone)
// as in November (Q3 filed, the figures now disagree with a return that was submitted). The first
// is bookkeeping. The second is a tax event, and the owner was told nothing about it.
//
// ── WHAT THIS DOES AND, MORE IMPORTANTLY, WHAT IT DOES NOT ──
//
// It does not block. A correction to a filed quarter is legal, ordinary, and often required — an
// invoice that was wrong stays wrong until someone fixes it, and the Belastingdienst's own answer
// to the consequence is the suppletie. Refusing the correction would leave the books wrong to keep
// a return tidy, which is exactly backwards.
//
// It does not file anything either. It does not compute the suppletie, decide its route, or touch
// a figure. That is btw-filing.ts's work and it already does it.
//
// What it does is NAME the consequence at the moment of the decision, so the correction is made
// with open eyes. [WAAROM-WACHT]'s rule, applied one layer up: the owner is told what this will
// mean before they do it, not after a form no longer matches.
//
// Pure. Run: npx tsx --test src/lib/correctie-tijdvak.test.ts

import { quarterOf, quarterLabel } from "./filed-quarter";

/** A quarter the owner has already filed. */
export interface GediendTijdvak {
  year: number;
  quarter: number;
}

export type TijdvakGevolg =
  /** The quarter is still open: correcting changes the figures that have not been filed yet. */
  | { soort: "open"; tijdvak: string | null }
  /** The quarter went to the Belastingdienst. A suppletie may follow — btw-filing decides. */
  | { soort: "ingediend"; tijdvak: string; gediendOp: string | null }
  /** No usable invoice date, so the question cannot be answered. Never guessed. */
  | { soort: "onbekend" };

/**
 * Which quarter this correction lands in, and whether that quarter has been filed.
 *
 * `filings` is the owner's own filing record. An EMPTY list means "nothing filed", which is the
 * normal state of a young administration — it must never be read as "we could not look", and the
 * caller that could not read the filings must say so rather than passing an empty array.
 */
export function tijdvakGevolg(
  invoiceDate: string | null | undefined,
  filings: readonly (GediendTijdvak & { filed_at?: string | null })[],
): TijdvakGevolg {
  const q = quarterOf(invoiceDate ?? null);
  if (!q) return { soort: "onbekend" };
  const label = quarterLabel(q.year, q.quarter);
  const hit = filings.find((f) => f.year === q.year && f.quarter === q.quarter);
  if (!hit) return { soort: "open", tijdvak: label };
  return {
    soort: "ingediend",
    tijdvak: label,
    gediendOp: typeof hit.filed_at === "string" ? hit.filed_at.slice(0, 10) : null,
  };
}

/**
 * The Dutch sentence, or null when there is nothing worth saying.
 *
 * An open quarter says NOTHING. That is the [RUSTIG] rule and it is what keeps the filed-quarter
 * sentence meaningful: a notice that appears on every correction is read on none of them.
 */
export function tijdvakZin(g: TijdvakGevolg): string | null {
  if (g.soort === "open") return null;
  if (g.soort === "onbekend") {
    return "De datum van deze factuur is niet leesbaar, dus we konden niet nagaan in welk btw-tijdvak de correctie valt.";
  }
  return `Deze correctie valt in ${g.tijdvak}, dat je al hebt ingediend${g.gediendOp ? ` op ${g.gediendOp}` : ""}. ` +
    "De correctie mag gewoon — je btw-aangifte over dat tijdvak klopt daarna niet meer, en BoekBrug rekent voor je uit of er een suppletie nodig is.";
}

/** True when the owner should be shown the sentence before they confirm. */
export function vraagtEenBlik(g: TijdvakGevolg): boolean {
  return g.soort !== "open";
}
