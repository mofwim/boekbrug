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


/**
 * ── DOES THIS TRADE TAKE MONEY AT A COUNTER? ──
 *
 * The distinction the app has never been able to make, and the one that decides whether it looks
 * like it belongs to the person holding the phone.
 *
 * A kapper is paid EUR 25 by someone who then walks out; he sends no invoice, has no "client", and
 * will open the Kassa thirty times a day. A hovenier finishes a garden and sends a bill; he opens
 * Facturen. Both are zzp'ers, both are in VAKKEN, and until now the app showed them the same four
 * navigation destinations — Facturen and Inkomend among them, for a barber who sends neither.
 *
 * The split is NOT "shop versus service" and not "product versus labour". It is exactly one
 * question: does the money change hands at the moment the work is done? That is what makes a
 * counter the right home screen instead of an invoice list.
 *
 * ── WHY A LIST AND NOT A FLAG ON THE TRADE ──
 * VAKKEN is a Dutch-fielded data table about INVOICE LINES — descriptions, units, rates. This is a
 * statement about how the APP should behave, which is this module's subject and not that one's. It
 * also keeps the identifiers here English, per AGENTS.md, without an English field sitting oddly
 * among `regels` and `let_op`.
 *
 * ── THE FAIL DIRECTION ──
 * Unknown trade → false → the invoice-shaped navigation everyone has had until now. A wrong `true`
 * would take Facturen off the bar of someone who invoices for a living; a wrong `false` costs a
 * barber one extra tap through his home screen. The cheap mistake is the default.
 *
 * automonteur is deliberately IN. A garage does both — a fleet customer gets an invoice, and the
 * man who came for two tyres pays at the desk — and of the two, the one he does twenty times a week
 * is the counter. Facturen stays one tap away on the home tiles, which is what they are for.
 */
const COUNTER_TRADES: ReadonlySet<string> = new Set([
  "kapper",       // paid per visit, never invoiced
  "fietsenmaker", // repairs paid over the counter, parts sold outright
  "automonteur",  // both, and the counter is the frequent half
]);

/** Does this owner take his money at a counter? Unknown trade → false (the invoice-shaped app). */
export function sellsOverCounter(slug: string | null | undefined): boolean {
  const vak = parseVak(slug);
  return vak !== null && COUNTER_TRADES.has(vak);
}


/**
 * Does this trade work on vehicles?
 *
 * Kept separate from sellsOverCounter even though `automonteur` is in both, because they answer
 * different questions and will drift: a mobile monteur who invoices every job still thinks in
 * kentekens, and a kapper who takes money at a counter has no use for an APK list. Collapsing them
 * into one "shop" flag is how a home screen ends up offering a barber a vehicle register.
 *
 * fietsenmaker is deliberately OUT. A bicycle has no kenteken and no APK, so the whole surface —
 * plate, expiry, the reminder that justifies it — is empty for him. A screen that is structurally
 * blank is worse than an absent one: it reads as a broken feature rather than an inapplicable one.
 */
const VEHICLE_TRADES: ReadonlySet<string> = new Set(["automonteur"]);

/** Does this owner work on vehicles? Unknown trade → false. */
export function worksOnVehicles(slug: string | null | undefined): boolean {
  const vak = parseVak(slug);
  return vak !== null && VEHICLE_TRADES.has(vak);
}
