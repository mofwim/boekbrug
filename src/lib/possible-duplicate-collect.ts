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
): Promise<PossibleDuplicate | null> {
  if (typeof input.totalIncBtw !== "number" || !Number.isFinite(input.totalIncBtw)) return null;
  let rows: PossibleDupCandidate[];
  try {
    rows = await fetchByTotal(input.totalIncBtw);
  } catch {
    return null;
  }
  return assessPossibleDuplicate(input, rows ?? []);
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
  safecore.possible_duplicate_reason = possible.reason;
  fc._safecore = safecore;
  return fc;
}
