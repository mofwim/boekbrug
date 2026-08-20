// src/lib/vak-profile.ts
// [VAK-BRUG] The owner's trade, carried from the front door into the app. Pure, no I/O.
// Run: npx tsx src/lib/vak-profile.test.ts
//
// ── THE GAP THIS CLOSES ──
// vak-sjablonen.ts already knows eleven trades and, for each, the invoice lines and the BTW rate
// that belongs to them. Its header argues — correctly — that this is a CORRECTNESS feature wearing
// the costume of a speed feature: a schilder on a thirty-year-old home may charge 9% and on new
// build 21%, a taxi is 9% where a courier is 21%, a cleaner inside a home is 9% and in an office
// 21%. Those are the mistakes that surface at the aangifte, when the invoice has long gone out.
//
// All of that lives ONLY in the public funnel: /factuur-maken, the /factuur-maken/[vak] landing
// pages, and the sitemap. Nothing behind the login has ever read it.
//
// So a barber arrives on /factuur-maken/kapper from Google, picks his trade, gets his lines and
// his rates — and the moment he registers, the app forgets he is a barber. His articles catalogue
// starts empty, and the Kassa built for exactly him opens on "je prijslijst is nog leeg". The one
// thing he already told us, at the only moment he volunteered it, is thrown away at the moment it
// becomes most useful.
//
// This module is the carrier. It is deliberately the same shape as account-purpose.ts, which
// solved the same problem for a different fact (why someone came), down to the querystring
// parameter and the fail direction — a reader who has to learn two patterns for one idea will
// eventually apply the wrong one.
//
// ── WHAT THIS IS NOT ──
// Not a permission, not a plan, not a filter. A vak changes what the app OFFERS TO PREFILL and
// nothing else. A kapper who starts doing bicycle repairs types a new line; nothing is locked, and
// there is nothing to "switch". Storing it as a filter would make a wrong guess expensive, and the
// guess is a dropdown on a signup form.

import { VAKKEN, vakBySlug, type BtwTarief, type Eenheid } from "./vak-sjablonen";

/** The querystring on /register that carries the trade: /register?vak=kapper */
export const VAK_PARAM = "vak";

/**
 * Read a trade from untrusted input (a querystring, user metadata, a database column).
 *
 * Anything that is not one of the eleven known slugs becomes null, and null means "we do not know
 * his trade" — which is exactly the state every existing account is in, and a perfectly workable
 * one. The fail direction is deliberately the opposite of account-purpose's: there, an unreadable
 * value costs at worst one wizard too many; here, a WRONG trade would prefill a price list with
 * another profession's lines and another profession's BTW rates. Not knowing is cheap; guessing
 * wrong is the thing this whole module exists to prevent.
 */
export function parseVak(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const slug = String(raw).trim().toLowerCase();
  return VAKKEN.some((v) => v.slug === slug) ? slug : null;
}

/** One catalogue line a trade offers to create, before the owner has priced it. */
export interface VakArticleSeed {
  description: string;
  unit: Eenheid;
  btw_rate: BtwTarief;
}

/**
 * The lines of a trade, ready to become articles.
 *
 * ── NO PRICES. EVER. ──
 * Rule 1 of vak-sjablonen.ts, and it is not softened by moving into the app: "an hourly rate of
 * € 65 is wrong for everyone except coincidentally one person, and a wrongly prefilled amount that
 * slips through is worse than an empty field."
 *
 * That has a consequence the caller must honour rather than work around. articles.unit_price is
 * NOT NULL DEFAULT 0, so seeding straight into the table would create a catalogue of €0,00 — and
 * the Kassa would then paint a grid of buttons that ring up nothing. So the seed is an OFFER, not
 * a write: the screen shows these lines with an empty price box, the owner types the prices he
 * actually charges, and only then do articles exist. That is roughly a minute of typing and it is
 * the difference between a price list that is his and one that is a template's.
 *
 * Unlike vakRegelsVoorFormulier (which folds the unit into the description because an invoice line
 * has no unit field), articles HAS a unit column — so the unit stays a unit, and units.ts keeps
 * its one vocabulary.
 */
export function vakArticleSeeds(slug: string | null | undefined): VakArticleSeed[] {
  const vak = vakBySlug(parseVak(slug));
  if (!vak) return [];
  return vak.regels.map((r) => ({
    description: r.description,
    unit: r.eenheid,
    btw_rate: r.btw_rate,
  }));
}

/**
 * The warning that belongs with a trade, when it has one.
 *
 * vak-sjablonen.ts calls `let_op` "the most valuable field in the whole file: it is there precisely
 * for the trades where the entrepreneur most often gets it wrong". It was shown on the public
 * generator and nowhere else — so the owner saw it once, before he had a business in the app, and
 * never again at the moment he is actually pricing his work.
 */
export function vakLetOp(slug: string | null | undefined): string | null {
  return vakBySlug(parseVak(slug))?.let_op ?? null;
}

/** The label of a trade, for a sentence that names it. Null when unknown. */
export function vakLabel(slug: string | null | undefined): string | null {
  return vakBySlug(parseVak(slug))?.label ?? null;
}
