// src/lib/created-by.ts
// [ACTING-FOR] Writing and reading `created_by` on a database that may NOT have the column yet.
// Run: npx tsx --test src/lib/created-by.test.ts
//
// ═══ THE BUG THIS FILE REPAIRS ═══
//
// company_members_sales_role.sql adds `created_by` to invoices and clients. The code using that
// column was already on main — with an `as any` next to it, because the generated types do not
// know it yet.
//
// That `as any` silences the TYPE CHECKER, not the DATABASE. On an installation where the
// migration has not been applied, PostgREST answers with PGRST204 ("Could not find the
// 'created_by' column") and the whole request fails. With the migration still open, that means:
//
//   · /api/invoice/draft      → CREATING AN INVOICE FAILS. For everyone.
//   · /api/clients            → adding a client fails
//   · /api/invoice/[id]       → editing or deleting a draft fails
//   · /api/invoice/duplicate  → duplicating fails
//   · /api/invoice/creditnota → creating a credit note fails
//
// That is not an edge case but the core of the product, and it would only have surfaced on the
// first invoice AFTER the deploy. tsc was clean, the tests were green and the build succeeded —
// none of the three looks at a real database. Exactly the shape of bug this product cannot take.
//
// ═══ THE FIX ═══
//
// Do not cache and do not probe up front: a cached "the column does not exist" survives until
// the next deploy, so the migration would only take effect after a restart. Instead: TRY it with
// the trail, and fall back to without on exactly those two error codes. As soon as the migration
// has run, the first attempt succeeds and the fallback is never touched again.
//
// What is lost without the column is the TRAIL (who created this row), not the work. And that is
// the right way to fall: without the migration the sales member does not exist at all — there is
// one human per administration, and that human is the owner by definition.

/** The two ways PostgREST/Postgres says: I do not know that column. */
export const UNKNOWN_COLUMN_CODES = ["PGRST204", "42703"] as const;

/**
 * Is this error about a column that does not (yet) exist?
 *
 * The code decides. The message is only consulted when there is NO code — some clients return
 * only text on a schema-cache miss.
 */
export function isUnknownColumn(error: unknown, column = "created_by"): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  if ((UNKNOWN_COLUMN_CODES as readonly string[]).includes(code)) return true;
  if (code) return false;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes(column.toLowerCase()) && (msg.includes("column") || msg.includes("kolom"));
}

export interface AttemptResult<T> {
  data: T | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
}

export interface TrailResult<T> extends AttemptResult<T> {
  /** false ⇒ the row was written WITHOUT created_by, because the column does not exist yet. */
  trailWritten: boolean;
}

/**
 * Runs a write WITH the trail, and without it when the column does not exist yet.
 *
 * `run` receives the extra fields and must build AND execute the query. Two calls in the worst
 * case, one in the normal case — and always one after the migration.
 */
export async function writeWithTrail<T>(
  run: (extra: Record<string, unknown>) => PromiseLike<AttemptResult<T>>,
  trail: Record<string, unknown>,
): Promise<TrailResult<T>> {
  const first = await run(trail);
  if (!first.error || !isUnknownColumn(first.error)) {
    return { ...first, trailWritten: true };
  }
  // Loud, because this is meant to be temporary: it means the migration is still open.
  console.warn(
    "[ACTING-FOR] created_by does not exist yet — row written without a trail. " +
      "Apply supabase/migrations/company_members_sales_role.sql.",
    { fields: Object.keys(trail) },
  );
  const second = await run({});
  return { ...second, trailWritten: false };
}

/**
 * Same trick for a SELECT: try the column list WITH the trail, and without it when it is missing.
 *
 * `run` receives the column string it should select.
 */
export async function readWithTrail<T>(
  run: (columns: string) => PromiseLike<AttemptResult<T>>,
  columnsWithTrail: string,
  columnsWithoutTrail: string,
): Promise<TrailResult<T>> {
  const first = await run(columnsWithTrail);
  if (!first.error || !isUnknownColumn(first.error)) {
    return { ...first, trailWritten: true };
  }
  const second = await run(columnsWithoutTrail);
  return { ...second, trailWritten: false };
}
