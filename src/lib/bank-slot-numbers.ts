// src/lib/bank-slot-numbers.ts
// [SLOT-WAAR] Which invoice numbers does this ONE payment put on the screen? Pure.
// Run: npx tsx src/lib/bank-slot-numbers.test.ts
//
// ── THE BUG THIS EXISTS FOR ──
//
// Reported from the bank screen: ipekci slachterij, € 3.624,25, reference "202604231",
// description "Deel twee factuur 202604231". The card announced "2 facturen" and a button reading
// "Facturen koppelen (2)" — for a payment that names ONE invoice, twice.
//
// The slot list was assembled from three sources, in the screen, inline:
//
//   resolvedNumbers   — numbers this payment names that we HOLD
//   missingNamed      — numbers it names that we do not hold
//   leftoverRefParts  — the raw parts of the bank's reference field
//
// and only the third was filtered — against the FIRST. So the moment nothing resolved (the ordinary
// state for an invoice that was never imported) that filter had an empty list to compare against,
// every reference part survived, and each one duplicated a number `missingNamed` had already
// contributed. Two rows, same number, same React key.
//
// It is the same shape as the two panels of one card that contradicted each other about invoice
// 26700644 last week: several lists describing one thing, and no place where they are held against
// each other. So they are held against each other here, once, and the screen asks this module.
//
// ── THE RULE ──
//
// One row per INVOICE NUMBER — identity, not spelling. Priority decides which spelling survives,
// because the three sources do not know the same amount about a number:
//
//   1. resolved  — we hold this invoice, so we know how it is really written. It wins.
//   2. missing   — the payment introduced it as an invoice ("factuur 202604231"), so it is a real
//                  number we simply do not have yet.
//   3. reference — a raw fragment of the bank's reference field. Last, and never a duplicate: the
//                  extractor splits a number at every separator, so "2026-045" arrives as "045"
//                  and would otherwise stand beside its own parent as a permanently unlinkable row.
//
// A fragment is dropped against EVERY number already listed, not only against the resolved ones.
// That widening is the fix; the rest of this file is the reason it is a module and not a line.

/** Comparison form for an invoice number: case and separators are printing, not identity. */
function normalize(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface SlotNumberSources {
  /** Numbers this payment names that are in the administration, as WE store them. */
  resolved: readonly string[];
  /** Numbers it names that are not in the administration. */
  missing: readonly string[];
  /** The parts of the bank's own reference field, already filtered to plausible tokens. */
  referenceParts: readonly string[];
}

/**
 * The numbers the card shows, once each, in reading order.
 *
 * Deliberately returns the SPELLINGS, not the keys: the owner compares these against paper, and a
 * normalised "fac2601629" is not a number anybody printed.
 */
export function slotNumbers(src: SlotNumberSources): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (raw: string, allowFragment: boolean) => {
    const n = (raw ?? "").trim();
    if (!n) return;
    const key = normalize(n);
    if (!key || seen.has(key)) return;
    // A reference part that is a PIECE of a number we already list is that number, cut up by the
    // extractor. Adding it makes one invoice look like two, and the second one can never be filled.
    if (!allowFragment && [...seen].some((k) => k.includes(key))) return;
    seen.add(key);
    out.push(n);
  };

  for (const n of src.resolved) add(n, true);
  for (const n of src.missing) add(n, true);
  for (const n of src.referenceParts) add(n, false);
  return out;
}
