// src/lib/client-extra-lines-write.ts
// [KLANT-EXTRA] Writing the two lines on a database that may not have them yet.
// Run: npx tsx --test src/lib/client-extra-lines-write.test.ts
//
// WHY THIS EXISTS
// The columns arrive with supabase/migrations/client_extra_lines.sql, and this app has more than
// one database behind it — the owner applies migrations themselves, and between a deploy and that
// moment the code is newer than the schema. PostgREST answers a write naming an unknown column
// with PGRST204 and rejects THE WHOLE ROW: not "the two lines were dropped", but "the invoice was
// not saved".
//
// That is the trade this file refuses. Two decorative address lines may never cost an owner the
// invoice they just typed. So the write is attempted with them, and if the schema does not know
// them yet it is repeated without — the invoice lands, the two lines do not, and the console says
// which migration is still open.
//
// The same shape as writeWithTrail() in created-by.ts, and deliberately a separate function rather
// than a parameter on that one: that one exists for an audit trail whose absence is a compliance
// question, this one for two lines whose absence is cosmetic. Reading either at a call site should
// say which of the two is being risked.

import { isUnknownColumn } from "./created-by";
import { cleanExtraLine, CLIENT_EXTRA_LINE_COLUMNS } from "./client-extra-lines";

/**
 * The columns, cleaned, ready to spread into an insert or an update.
 *
 * Driven by CLIENT_EXTRA_LINE_COLUMNS rather than by named arguments: a third line was added after
 * the first two shipped, and a signature of (line1, line2) is exactly the thing that has to be
 * hunted down at every call site when a fourth arrives.
 */
export function extraLineFields(...values: unknown[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  CLIENT_EXTRA_LINE_COLUMNS.forEach((column, i) => {
    // Empty becomes NULL rather than "". An empty string is a value the owner chose; null is the
    // absence of one, and every reader treats them the same — so store the one that matches what
    // the column means when nobody filled it in.
    out[column] = cleanExtraLine(values[i] as string) || null;
  });
  return out;
}

export interface ExtraLineWriteResult<T> {
  data: T | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
  /** False when the schema did not know the columns and the row was written without them. */
  linesWritten: boolean;
}

/**
 * Run a write with the two lines, and again without them when the columns do not exist yet.
 *
 * `run` receives the fields to merge into its payload — the whole pair on the first attempt and an
 * empty object on the second, so a call site never has to branch.
 */
export async function writeWithExtraLines<T>(
  run: (extra: Record<string, unknown>) => PromiseLike<{ data: T | null; error: unknown }>,
  fields: Record<string, unknown>,
): Promise<ExtraLineWriteResult<T>> {
  const first = await run(fields);
  // Only an unknown COLUMN is retried. Every other error — a constraint, a permission, a failed
  // connection — is the caller's to handle, and silently retrying it without two fields would turn
  // a real failure into a confusing partial success.
  if (
    !first.error ||
    !CLIENT_EXTRA_LINE_COLUMNS.some((c) => isUnknownColumn(first.error, c))
  ) {
    return { data: first.data, error: first.error, linesWritten: true };
  }
  // Loud, because it is meant to be temporary.
  console.warn(
    "[KLANT-EXTRA] client_extra_line1/2/3 do not exist yet — the invoice was saved WITHOUT the two " +
      "customer lines. Apply supabase/migrations/client_extra_lines.sql.",
  );
  const second = await run({});
  return { data: second.data, error: second.error, linesWritten: false };
}

/**
 * Copy the two lines onto a row that has just been created from another invoice.
 *
 * For the routes that REBUILD the customer snapshot field by field — creditnota, duplicate, the
 * recurring cron. A creditnota that loses "t.a.v. mevrouw Jansen" arrives at the wrong desk of the
 * same customer that could not process the invoice without it, so the correction goes missing for
 * the same reason the invoice would have.
 *
 * Deliberately a SEPARATE write, after the row exists, rather than two more fields in the insert.
 * Those inserts carry amounts, an owner and a document type; if an unknown column made one of them
 * fail, the price of two address lines would be a creditnota that was never created. Here the
 * worst case is a creditnota without them, and a warning saying which migration is still open.
 *
 * `update` is the caller's own query, so each route keeps its own client and its own row guard.
 * Returns whether the lines landed — never throws, and never reports success it did not have.
 */
export async function copyExtraLinesOnto(
  update: (fields: Record<string, unknown>) => PromiseLike<{ error: unknown }>,
  source: Record<string, unknown> | null | undefined,
  context: Record<string, unknown> = {},
): Promise<boolean> {
  const row = (source ?? {}) as Record<string, unknown>;
  const fields = extraLineFields(...CLIENT_EXTRA_LINE_COLUMNS.map((c) => row[c]));
  // Nothing to copy is not a failure — it is the normal state of almost every invoice.
  if (CLIENT_EXTRA_LINE_COLUMNS.every((c) => !fields[c])) return true;
  try {
    const { error } = await update(fields);
    if (!error) return true;
    console.warn(
      "[KLANT-EXTRA] the two customer lines were not copied onto the new document. Apply " +
        "supabase/migrations/client_extra_lines.sql.",
      { ...context, error: (error as { message?: string })?.message },
    );
    return false;
  } catch (e) {
    console.warn("[KLANT-EXTRA] copying the two customer lines threw", { ...context, error: String(e) });
    return false;
  }
}
