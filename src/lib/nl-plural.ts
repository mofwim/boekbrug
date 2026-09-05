// src/lib/nl-plural.ts
// [MEERVOUD] One derivation for "1 factuur" / "3 facturen", so no screen has to spell it.
//
// ── WHY THIS FILE EXISTS ──
// Eighteen places in this app wrote the count of invoices as `factu(u)r(en)`. That is not a
// shorthand a reader decodes — it is a mail-merge that failed, printed on a bookkeeping app
// that is asking a Dutch entrepreneur to trust it with his BTW. One of them reached production
// and stood in the owner's notification bell: "1 factu(u)r(en) automatisch afgeschreven".
//
// The count was in hand at every single one of those sites. Several of them even branched the
// VERB correctly on the same line — `${n} betaalde factu(u)r(en) ${n === 1 ? "heeft" : "hebben"}`
// — which is the tell: the author had the number, conjugated the verb from it, and then left the
// noun as a placeholder because the plural rule felt like more work than it is.
//
// ── THE PLURAL IS SPELLED, THE AGREEMENT IS DERIVED ──
// The first version of this file derived the plural too: Dutch nouns in -uur take -uren and the
// doubled u collapses, so factuur → facturen without a table. That rule is correct and it stays,
// as the default — every word this file was written for is a compound of factuur.
//
// It is NOT extended into a general Dutch pluraliser, and the reason is the same one that makes
// the placeholder unacceptable in the first place. Dutch plurals are only mostly regular:
// dag → dagen, rij → rijen and post → posten double or keep a consonant by syllable, regel → regels
// takes -s, and betaaldatum → betaaldata is a Latin stem that no rule about Dutch will ever reach.
// A pluraliser that is right nine times out of ten puts a wrong Dutch word on the screen of a
// Dutch entrepreneur — which is worse than the singular, and much worse than asking the caller for
// the one word it already knows.
//
// So: the caller spells the plural where the rule does not cover it, and this file guarantees the
// only thing that is genuinely mechanical — that the count and the word agree, every time, in one
// expression instead of an inline ternary per clause.
//
// Verb agreement works the same way and for the same reason. Dutch verb stems are irregular —
// heeft/hebben, staat/staan, telt/tellen, mist/missen — so there is nothing to derive there at all.

/**
 * The plural of a Dutch noun ending in -uur.
 *
 * Returns the word unchanged when the rule does not apply, because a wrong plural on screen is
 * worse than the singular: an owner reading "3 factuur" sees a typo, an owner reading "3 facturs"
 * sees a machine that does not speak his language.
 */
export function meervoudUur(woord: string): string {
  return /uur$/i.test(woord) ? `${woord.slice(0, -3)}uren` : woord;
}

/**
 * `n` and its noun, agreeing. `telWoord(1, "factuur")` → "1 factuur";
 * `telWoord(3, "inkoopfactuur")` → "3 inkoopfacturen"; `telWoord(3, "dag", "dagen")` → "3 dagen".
 *
 * Pass `meervoud` for every noun the -uur rule does not cover, which is all of them except
 * factuur and its compounds — see the header.
 *
 * n is used exactly as given — this never rounds, never takes an absolute value and never treats
 * 0 as 1. A count that arrives wrong must read wrong, not be quietly repaired into a sentence the
 * owner then believes.
 */
export function telWoord(n: number, enkelvoud: string, meervoud?: string): string {
  return `${n} ${woordBij(n, enkelvoud, meervoud)}`;
}

/**
 * The bare noun, agreeing with `n`, for a sentence that already printed the number.
 *
 * `meervoud` is optional: leave it out for factuur and its compounds, where the -uur rule is
 * right, and spell it for every other noun.
 */
export function woordBij(n: number, enkelvoud: string, meervoud?: string): string {
  return n === 1 ? enkelvoud : (meervoud ?? meervoudUur(enkelvoud));
}

/**
 * A verb pair, chosen by the count. Both forms are spelled by the caller — see the header.
 * Present only so a sentence reads as one expression instead of an inline ternary per clause.
 */
export function vervoeg(n: number, enkelvoud: string, meervoud: string): string {
  return n === 1 ? enkelvoud : meervoud;
}
