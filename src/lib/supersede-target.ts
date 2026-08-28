// src/lib/supersede-target.ts
// [VERVANG-OVERAL] Does this invoice carry the flag that "Deze vervangt factuur X" acts on? Pure.
// Run: npx tsx --test src/lib/supersede-target.test.ts
//
// ── WHY THIS IS A MODULE AND NOT AN INLINE CHECK ──
//
// The supersede shortcut lived in the verify queue only, as a closure that read
// field_confidence._safecore.possible_duplicate_id. The pay screen needs the same answer for the
// same rows (see duplicate-payable.ts: that is the SECOND moment, both copies confirmed and side
// by side), and a second reading of the same jsonb path is how two screens start disagreeing about
// which invoices can be replaced.
//
// It answers one question and nothing more. Whether the shortcut should be OFFERED is the screen's
// business — the queue hides it on the Genegeerd tab, the pay screen has no tabs — and whether the
// replacement may actually happen is the server's (refuseSupersede: money settled, an accountant
// lock, a pair that is not a pair). This is only "is there a flagged twin at all".
//
// The id itself is deliberately NOT returned. The route reads it from the flag the server wrote at
// import time, precisely so no client can aim the archive at an invoice of its choosing; handing
// the id to a screen would invite exactly the body that route refuses to accept.

/** What the screen needs to write the sentence. The twin's id stays server-side, on purpose. */
export interface SupersedeTarget {
  /** The other invoice's number, when we know it — the sentences have a with/without variant. */
  number: string | null;
}

/**
 * Read the import-time twin flag off an invoice's field_confidence.
 *
 * Returns null when there is nothing to replace: no flag, an empty id, or a shape that is not the
 * object this expects. Null means "do not offer the shortcut", never "it failed".
 */
export function supersedeTargetOf(fieldConfidence: unknown): SupersedeTarget | null {
  if (!fieldConfidence || typeof fieldConfidence !== "object") return null;
  const safecore = (fieldConfidence as { _safecore?: unknown })._safecore;
  if (!safecore || typeof safecore !== "object") return null;
  const s = safecore as Record<string, unknown>;
  const id = s.possible_duplicate_id;
  if (typeof id !== "string" || id.length === 0) return null;
  const of = typeof s.possible_duplicate_of === "string" ? s.possible_duplicate_of.trim() : "";
  return { number: of || null };
}
