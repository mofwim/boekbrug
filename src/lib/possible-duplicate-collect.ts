// src/lib/possible-duplicate-collect.ts
// [DEDUP-SOFT] I/O glue for the pure assessPossibleDuplicate detector, shared by every
// ingestion path (manual upload, intake camera, email sync). Kept out of safecore (which
// stays dependency-free) — the caller injects a scoped "fetch same-total invoices" query,
// and this runs the pure assessment. Best-effort: a query error degrades to "no flag"
// (a soft signal must never block or fail an import).

import {
  assessPossibleDuplicate,
  type SemanticDedupInput,
  type PossibleDuplicate,
  type PossibleDupCandidate,
} from "./safecore";

export async function collectPossibleDuplicate(
  input: SemanticDedupInput,
  fetchByTotal: (total: number) => Promise<PossibleDupCandidate[]>,
  // [DEDUP-CORRECTED] Optional second lookup: invoices already held under THIS invoice number,
  // whatever their amount. Without it the corrected-re-issue tier can never fire — the by-total
  // query returns only rows whose amount already matches, and a correction is by definition the
  // one case where it does not. Optional so a call site that cannot form the query (no real
  // number) simply keeps the old behaviour instead of failing.
  fetchByNumber?: (invoiceNumber: string) => Promise<PossibleDupCandidate[]>,
): Promise<PossibleDuplicate | null> {
  if (typeof input.totalIncBtw !== "number" || !Number.isFinite(input.totalIncBtw)) return null;
  let rows: PossibleDupCandidate[];
  try {
    rows = await fetchByTotal(input.totalIncBtw);
  } catch {
    return null;
  }
  let extra: PossibleDupCandidate[] = [];
  const number = (input.invoiceNumber ?? "").trim();
  if (fetchByNumber && number.length > 0) {
    try {
      extra = (await fetchByNumber(number)) ?? [];
    } catch {
      // Best-effort, exactly like the by-total read: a failed second query degrades to the
      // amount-anchored tiers, never to a failed import.
      extra = [];
    }
  }
  // De-duplicate by id — a same-number invoice that ALSO has the same total is returned by both
  // queries, and a doubled candidate would make looksLikeRecurringSeries see a phantom moment.
  const seen = new Set((rows ?? []).map((r) => r.id));
  const merged = [...(rows ?? []), ...extra.filter((r) => !seen.has(r.id))];
  return assessPossibleDuplicate(input, merged);
}

/**
 * Merge a possible-duplicate signal into an invoice's field_confidence._safecore, immutably.
 * classifyImportHealth reads these keys → the invoice shows "mogelijk dubbel met X" in the
 * verify queue and is held out of auto-confirm (needs-review). Returns the input unchanged
 * when there's nothing to flag.
 */
export function mergePossibleDuplicate(
  fieldConfidence: unknown,
  possible: PossibleDuplicate | null,
): unknown {
  if (!possible) return fieldConfidence ?? null;
  const fc =
    fieldConfidence && typeof fieldConfidence === "object"
      ? { ...(fieldConfidence as Record<string, unknown>) }
      : {};
  const safecore =
    fc._safecore && typeof fc._safecore === "object"
      ? { ...(fc._safecore as Record<string, unknown>) }
      : {};
  safecore.possible_duplicate = true;
  // Prefer a human-readable invoice number for the "met factuur X" text; fall back to the
  // vendor name, then the id — never leave it blank when we have a match.
  safecore.possible_duplicate_of =
    possible.match.invoice_number || possible.match.client_name || possible.match.id;
  // [SUPERSEDE] The id of the invoice we matched against, so "Deze vervangt factuur X" can ACT on
  // it. `_of` above is a display string that falls back to a vendor name — it can never identify
  // a row, and an invoice number is not unique across suppliers, so resolving the target by name
  // or number at click time would risk archiving the wrong invoice. The id is the only anchor
  // that cannot mean two things.
  safecore.possible_duplicate_id = possible.match.id;
  safecore.possible_duplicate_reason = possible.reason;
  fc._safecore = safecore;
  return fc;
}

/** The keys that together ARE the duplicate signal. One list, so writing and clearing agree. */
const DUPLICATE_KEYS = [
  "possible_duplicate",
  "possible_duplicate_of",
  "possible_duplicate_id",
  "possible_duplicate_reason",
] as const;

/**
 * The inverse of mergePossibleDuplicate: remove the duplicate signal and NOTHING else. Lives here
 * next to the writer on purpose — this file is the one place that knows which keys carry that
 * signal, and a second hand-written list would be a bug waiting for the next key (which is exactly
 * how possible_duplicate_id went missing from the e-mail path).
 *
 * Everything else in `_safecore` survives: the arithmetic verdict, an IBAN change, a reminder
 * marker. None of those is answered by an answer about duplication, and silently dropping one
 * would take a real warning off an invoice the owner never looked at again.
 *
 * Returns null when there was nothing to work on, so a caller can tell "cleared" from "nothing
 * there" instead of reporting an imaginary success.
 */
export function clearPossibleDuplicate(fieldConfidence: unknown): Record<string, unknown> | null {
  if (!fieldConfidence || typeof fieldConfidence !== "object" || Array.isArray(fieldConfidence)) {
    return null;
  }
  const next = { ...(fieldConfidence as Record<string, unknown>) };
  const prior = next._safecore;
  const safecore =
    prior && typeof prior === "object" && !Array.isArray(prior)
      ? { ...(prior as Record<string, unknown>) }
      : {};
  for (const k of DUPLICATE_KEYS) delete safecore[k];
  next._safecore = safecore;
  return next;
}

/**
 * Mark an invoice as "we could not run the duplicate check".
 *
 * ── WHY THIS EXISTS ──
 * Every ingestion path probed for duplicates with `const { data } = await …` and used `data ?? []`.
 * supabase-js does not throw — it answers a failed read with `{ data: null, error }` — so a database
 * problem produced an EMPTY candidate list, which reads as "there is no duplicate", which is the
 * one answer that lets a second copy of a bill into the books. The cost is counted twice and the
 * voorbelasting is reclaimed twice, silently, discoverable only by reading the books line by line.
 *
 * The bank-attach path refuses outright: it books straight to 'paid', so there is no later moment
 * where anyone looks. These paths are different — they land in the verify queue — so refusing a
 * whole upload batch over one failed read would cost more than it buys. Instead the invoice arrives
 * carrying the SAME soft flag a real look-alike gets: needs-review, with a reason in plain Dutch,
 * and held out of "Selecteer klaar" so it cannot be bulk-confirmed as a second cost without a human
 * actually looking at it.
 *
 * No match id and no `_of`, because there is no match — only the absence of an answer. That is the
 * honest shape: import-health prints "mogelijk dubbel (…) — controleer of dit geen dubbele boeking
 * is" without naming an invoice we never found.
 */
export function markDuplicateCheckUnavailable(fieldConfidence: unknown): unknown {
  const fc =
    fieldConfidence && typeof fieldConfidence === "object" && !Array.isArray(fieldConfidence)
      ? { ...(fieldConfidence as Record<string, unknown>) }
      : {};
  const prior = fc._safecore;
  const safecore =
    prior && typeof prior === "object" && !Array.isArray(prior)
      ? { ...(prior as Record<string, unknown>) }
      : {};
  // Never overwrite a REAL find. A run that located a look-alike and then failed its second probe
  // must keep naming the invoice it did find — that reason is strictly more useful than this one.
  if (safecore.possible_duplicate === true) return fc;
  safecore.possible_duplicate = true;
  // Dutch: this string is printed on the card. See the language rule in AGENTS.md.
  safecore.possible_duplicate_reason = "we konden de dubbelcheck niet uitvoeren";
  fc._safecore = safecore;
  return fc;
}
