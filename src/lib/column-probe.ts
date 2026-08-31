// src/lib/column-probe.ts
// [KAS-PROBE][DEPLOY-SAFE] "Does this database have that column yet?" — asked once, in one place.
//
// ── WHY THIS FILE EXISTS ──
//
// Code ships before a migration is applied. That is normal, and SELECTing a column that does not
// exist fails the whole read, so several modules learned to ask first and run a reduced version of
// themselves when the answer is no. Each of them wrote the same eight lines:
//
//     const { error } = await supabase.from(t).select(c).limit(1)
//     if (error) return false
//
// And each of them was therefore wrong in the same way. `error` is not "the column is missing". It
// is also a statement timeout, a pooler at its ceiling, a dropped connection, an expired JWT and an
// RLS refusal. Those mean the database is unwell, which says nothing whatsoever about the schema —
// and answering NO to them puts a module into its reduced mode at exactly the moment it should be
// doing less, not more.
//
// What "reduced mode" cost, per caller, measured rather than imagined:
//
//   · cash-settle       reads `existing` WITHOUT settlement_id, so every drawer entry of one
//                       invoice keys to the same aggregate: the first is healed to the total on the
//                       last cash date and the rest are HARD-DELETED as duplicates. Three till
//                       handovers become one, re-dated — across a quarter end, a BTW period.
//   · cash-live         stops filtering removed rows, so every soft-deleted cash movement returns
//                       to omzet, kosten, the drawer and the aangifte — and the DELETE door starts
//                       removing rows for real.
//   · incasso-settle    the payment-due ladder finds no auto-incasso suppliers, which is the same
//                       answer as "nobody collects", so it duns invoices the bank is already
//                       collecting. The owner pays a second time. The route's own [NO-SILENT-EMPTY]
//                       comment forbids exactly this outcome — and defended the read one line below
//                       the probe that gates it.
//   · supplier-alias    aliases are not written, so the same supplier keeps splitting in two.
//
// Every one of those windows is CLOSED. Checked against production: cash_entries.settlement_id,
// cash_entries.deleted_at, cash_entries.invoice_id, suppliers.auto_incasso (NOT NULL) and
// supplier_aliases all exist. So every `false` these probes can still return today is a false one.
//
// ── THE RULE ──
//
// Only a recognisable absent column is a NO. Everything else is a failed read, and a failed read is
// answered YES — because YES makes the caller's next read ask for the column, fail, and bail
// loudly, while NO makes it quietly do something destructive. Bailing costs an hour. Guessing costs
// the books.
//
// Cached only when TRUE, which every caller already did: a NO must stay re-checkable, or an
// instance that started before the migration keeps the reduced behaviour until it happens to
// restart.

import { reportHandledFailure } from "@/lib/report-handled";

/** What PostgREST says when the column really is not there. */
export function columnIsAbsent(
  error: { code?: string | null; message?: string | null } | null | undefined,
  column?: string,
): boolean {
  if (!error) return false;
  // 42703 is Postgres' undefined_column; PGRST204 is the schema-cache form of the same fact.
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const message = error.message ?? "";
  if (!message) return false;
  // The belt to that brace: a PostgREST version that reports it under another code must not read as
  // "present". Anchored on the column name when we have it, so an unrelated error mentioning some
  // OTHER missing column cannot switch this caller into its reduced mode.
  const col = column ? column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "[a-z_]+";
  return new RegExp(
    `column .*\\b${col}\\b.* does not exist|could not find the .*\\b${col}\\b.* column`,
    "i",
  ).test(message);
}

const known = new Set<string>();

/**
 * Does `table` have `column`? See the header for why the answer to a failed read is YES.
 *
 * `what` names the reduced behaviour a NO would switch on, so the report a spurious failure
 * produces says what was at stake rather than "a probe failed".
 */
export async function columnExists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
  table: string,
  column: string,
  what: string,
): Promise<boolean> {
  const key = `${table}.${column}`;
  if (known.has(key)) return true;
  try {
    const { error } = await supabase.from(table).select(column).limit(1);
    if (!error) {
      known.add(key);
      return true;
    }
    if (columnIsAbsent(error, column)) return false;
    reportHandledFailure({
      tag: "DEPLOY-SAFE",
      message: `the ${key} probe failed for a reason other than an absent column — assuming the column is there, so the caller bails instead of falling back (${what})`,
      severity: "gate-unavailable",
      context: { table, column, error: error.message, code: (error as { code?: string }).code ?? null },
    });
    return true;
  } catch {
    // A thrown read (network, abort) is the same class, and never evidence about the schema.
    return true;
  }
}

/** Test seam: the cache is process-wide and a YES is permanent by design. */
export function resetColumnProbeCacheForTests(): void {
  known.clear();
}
