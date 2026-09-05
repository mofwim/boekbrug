// src/modules/accountant/work-grouping.ts
// [KANTOOR-BESLUIT] The office's work, grouped by WHAT it is instead of by WHOSE it is.
// Pure — no I/O, no clock. Run: npx tsx --test src/modules/accountant/work-grouping.test.ts
//
// ── THE UNIT IS WRONG, AND THAT IS THE CEILING ───────────────────────────────────────────────
//
// AccountantWerkboard takes `clients` and fetches /api/readiness once per client. summarizeBoard
// then counts CLIENTS: ready, almost, attention. Every number the office sees is a number of
// clients, and every row is a client.
//
// That reads fine at ten clients and stops working at eighty, for a reason that is not about
// speed: an accountant does not work client by client. They do all the kassadagen, then all the
// unconfirmed invoices, then all the dateless payments — because each of those is one habit, one
// screen and one explanation, repeated. A board sorted by client asks them to switch task on every
// row, and to hold "which of these was the kassadagen one" in their head across eighty rows.
//
// So this file re-cuts the SAME data the board already has: one entry per KIND of work, naming the
// clients it applies to.
//
// ── IT INVENTS NOTHING ───────────────────────────────────────────────────────────────────────
//
// The titles are readiness' own sentences, carried verbatim. There is no rule here about what is
// wrong with an administration, no severity of its own, and no second vocabulary — buildReadiness
// owns all of that. This file only asks: are these two sentences about the same KIND of work?
//
// ── AND THE KIND IS DERIVED, NOT LISTED ──────────────────────────────────────────────────────
//
// The obvious implementation is a list of patterns: /kassadagen/ → "Kassadagen", /betaaldatum/ →
// "Betaaldata", and so on. That list is wrong the day someone adds a readiness gap and forgets it
// — and it fails SILENTLY, as one more row in an "overig" bucket that nobody reads.
//
// So the kind is the sentence with its numbers taken out. "€172.081,57 omzet zonder BTW-tarief"
// and "€81.358,01 omzet zonder BTW-tarief" are the same work; "12 van 90 kassadagen geïmporteerd"
// and "0 van 91 kassadagen geïmporteerd" are the same work. A gap added tomorrow groups itself.

/** One client's readiness result, in the shape the board already holds. */
export interface ClientWork {
  id: string;
  name: string;
  /** readiness' `missing[]` titles, verbatim. Empty for a client with nothing blocking. */
  missingTitles: readonly string[];
}

export interface WorkGroup {
  /** Stable identity of this kind of work. Never shown — see the header. */
  key: string;
  /** One of the real sentences, verbatim, as the label. */
  label: string;
  /** The clients this kind of work applies to, in the order they arrived. */
  clients: { id: string; name: string }[];
}

/**
 * The signature of a sentence: what it says once the amounts and counts are removed.
 *
 * Crude on purpose, and safe to be: this value is a grouping key, never a sentence anyone reads.
 * The worst a bad key can do is split one kind into two rows or merge two into one — a display
 * problem. It touches no money and decides nothing.
 *
 * The trailing -en/-s strip is what makes "1 betaalde factuur zonder betaaldatum" and "3 betaalde
 * facturen zonder betaaldatum" one kind. Without it every gap that names a count appears twice on
 * the board: once in the singular and once in the plural.
 */
export function workKey(title: string): string {
  return title
    .toLowerCase()
    // Amounts, counts, and the punctuation that holds them together.
    .replace(/[€$]/g, " ")
    .replace(/[0-9][0-9.,]*/g, " ")
    .replace(/[^a-zà-ÿ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    // A very crude Dutch stem: enough to make singular and plural meet, and nothing more.
    //
    // The `uu` collapse is the same rule nl-plural.ts derives its plural from — factuur becomes
    // facturen, not factuuren. Stripping the -en alone leaves "factur" beside "factuur", so the
    // one word this whole board is about would be the one that failed to group.
    .map((w) => w.replace(/uu/g, "u").replace(/(en|s)$/, ""))
    .sort()
    .join("-");
}

/**
 * All the office's open work, one entry per kind, biggest first.
 *
 * Biggest first and not "most severe first", deliberately: severity is readiness' word and this
 * file does not have it — `missing` is already only the blocking gaps, so every group here is
 * something that stops a filing. Between two of those, the one that covers more clients is the one
 * an hour of work clears the most of.
 *
 * Ties keep the order the kinds were first seen, so the board does not reshuffle itself between
 * two refreshes that found the same work.
 */
export function groupWork(clients: readonly ClientWork[]): WorkGroup[] {
  const groups = new Map<string, WorkGroup>();
  for (const c of clients) {
    // One client, one appearance per kind — a client with three dateless invoices has ONE
    // "betaaldatum" problem from the office's point of view, not three.
    const seen = new Set<string>();
    for (const title of c.missingTitles) {
      const key = workKey(title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const g = groups.get(key) ?? { key, label: title, clients: [] };
      g.clients.push({ id: c.id, name: c.name });
      groups.set(key, g);
    }
  }
  // Stable sort: Map preserves insertion order, and sort() in V8 is stable, so equal sizes keep
  // the order they were first seen in.
  return [...groups.values()].sort((a, b) => b.clients.length - a.clients.length);
}

/** How many separate pieces of work the office is looking at. */
export function workCount(groups: readonly WorkGroup[]): number {
  return groups.reduce((n, g) => n + g.clients.length, 0);
}
