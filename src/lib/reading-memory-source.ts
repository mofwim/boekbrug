// src/lib/reading-memory-source.ts
// [READING-MEMORY] The one read that turns the audit trail into a per-supplier memory.
//
// Server-side, so it is NOT in reading-memory.ts — that file is pure and stays pure. This is the
// thin layer between it and the database, and it exists so the two screens that show the memory
// (the verify queue and the pay screen) cannot disagree about what the trail says. Two copies of a
// query with two slightly different bounds would eventually tell the owner that a supplier is fine
// on one screen and a repeat offender on the other.
//
// No new table. Both correction doors already write a `reading_correction` block into
// audit_logs.new_value, and audit_logs has a "Users see own logs" SELECT policy (database.sql:619).
// So the memory IS the trail and cannot drift from it.

import {
  buildReadingMemory,
  parseCorrectionRecords,
  type VendorMemory,
} from "./reading-memory";

/**
 * How far back the memory looks.
 *
 * The question it answers is "what keeps happening at this supplier", and a correction from two
 * years ago is not that. The bound also keeps this off the critical path of screens the owner opens
 * all day. It counts AUDIT ROWS, not invoices — the filter below is applied server-side, so these
 * are 400 status changes and updates, of which only the corrections survive parsing.
 */
const AUDIT_WINDOW = 400;

/**
 * Just enough of the client to run this query.
 *
 * Deliberately loose. Spelling the builder chain out structurally made tsc walk the whole generated
 * Database type through five nested calls and give up with "Type instantiation is excessively deep"
 * on the calling page — a compile error caused entirely by describing a client we already have.
 * The row shape is what actually matters here, and parseCorrectionRecords validates every field of
 * it at runtime precisely because audit_logs.new_value is untyped jsonb written by several routes.
 */
type MemoryClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/**
 * Build the memory for one owner.
 *
 * [NO-SILENT-EMPTY] with a deliberate exception, worth naming because it goes the other way from
 * the rest of this line: on a failed read this returns an EMPTY memory rather than null, and the
 * screens simply show no hint. That is safe here and only here — this surface adds a "look at this
 * field too" sentence and never withholds one. Losing it costs a hint; inventing one would send the
 * reviewer to the wrong field with the app's authority behind it. Every other read in this line
 * refuses instead, because every other read makes a claim about money.
 */
export async function loadReadingMemory(
  supabase: MemoryClient,
  userId: string,
): Promise<Map<string, VendorMemory>> {
  try {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("new_value, created_at")
      .eq("user_id", userId)
      // The two doors: the queue's confirm route, and the pay screen's amount correction.
      .in("action", ["invoice.status_changed", "invoice.updated"])
      .order("created_at", { ascending: false })
      .limit(AUDIT_WINDOW);
    if (error) throw new Error(error.message);
    return buildReadingMemory(parseCorrectionRecords(data ?? []));
  } catch (e) {
    console.error("[READING-MEMORY] audit read failed — the screens simply show no supplier hints", {
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    return new Map();
  }
}
