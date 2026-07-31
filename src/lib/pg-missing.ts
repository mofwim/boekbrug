// src/lib/pg-missing.ts
// [DEPLOY-SAFE] "Is this error the migration not having landed yet, or is it a read that failed?"
//
// The migrations in this project are applied BY HAND, so there is always a window in which the
// code is live and the table or column it wants is not. In that window a missing relation is not
// an unknown — it is a complete, correct answer ("there are no such rows yet"), and degrading to
// it is deliberate. Every OTHER error means the rows may well exist and we simply could not see
// them, and answering "none" there is how a read failure turns into a wrong number.
//
// The two are told apart by Postgres/PostgREST codes, so the distinction is mechanical rather
// than a guess:
//   · 42P01 / PGRST205 — undefined_table    → the relation is not there
//   · 42703 / PGRST204 — undefined_column   → the relation is, the column is not
//
// The message text is matched too because supabase-js surfaces the code inside the message for
// some paths (and fetchAllRows re-throws a plain Error carrying only the message).
//
// This lived as a private copy in bank-tx-links.ts, which is exactly one caller too few: the same
// question is asked wherever a read is made fail-closed, and two copies of a rule like this drift.

/** True when the TABLE/VIEW itself does not exist (its migration has not been applied). */
export function isMissingRelation(message: string): boolean {
  return /does not exist|schema cache|PGRST205|42P01/i.test(message);
}

/**
 * True when the table exists but a COLUMN in the select does not.
 *
 * Deliberately narrower than isMissingRelation: it is keyed on the two undefined-column codes and
 * on the exact PostgREST phrasing, so a timeout or a permission error can never pass as "that
 * column isn't there yet".
 */
export function isMissingColumn(message: string, code?: string | null): boolean {
  if (code === "42703" || code === "PGRST204") return true;
  return /42703|PGRST204|column .* does not exist|could not find the .* column/i.test(message);
}
