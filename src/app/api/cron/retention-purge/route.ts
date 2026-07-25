// src/app/api/cron/retention-purge/route.ts
// [A1] The job that finally executes GDPR erasure.
//
// `api/account/delete` bans the user and stamps a 7-year timer. Nothing ever
// read that timer: `isEligibleForDeletion` had no caller and no purge job
// existed, so a deleted account's files lived in Storage forever and Article 17
// erasure was a promise the app never kept. This is the consumer.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS ROUTE DELETES DATA THAT CANNOT BE RECOVERED. Read before touching it.
//
// Four independent things must ALL be true before one byte is removed:
//   1. CRON_SECRET matches (constant-time, fail-closed) — same guard as the
//      other crons; this is never publicly callable.
//   2. RETENTION_PURGE_ENABLED === "true". Unset ⇒ DRY RUN: it reports exactly
//      what it would erase and erases nothing. This is the default, forever,
//      until a human deliberately turns it on.
//   3. decidePurge() returns true for the row — deactivated, timer stamped,
//      seven years genuinely up, not already purged (see retention-purge.ts,
//      19 tests, every one of them a refusal case).
//   4. The user id is a plain UUID, so the Storage prefix cannot widen beyond
//      one account.
//
// Nothing in this app is due before 2033, so in normal operation this job finds
// ZERO candidates for years. If a dry run ever reports a candidate before then,
// something stamped a wrong date — investigate, do not enable.
//
// WHAT IT ERASES: the user's Storage objects and their `documents` rows — the
// bulk of the personal data and all of the file storage.
// WHAT IT DOES NOT: it never hard-deletes the auth user, the profile, or any
// financial row (invoices, bank_transactions, cash entries). Those cascade
// across the whole schema and their removal is a deliberate, audited, one-off
// human action — not something an unattended cron does at 3am.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import {
  partitionPurgeCandidates,
  storagePrefixForUser,
  type DeletionRequestRow,
} from "@/lib/retention-purge";
import { logAuditAction } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUCKET = "documents";
/** Storage list() is paged; this is the page size, not a cap on what is erased. */
const LIST_PAGE = 100;
/** Users handled per run. A purge is never urgent — spreading it is free safety. */
const MAX_USERS_PER_RUN = 25;

type PurgeReport = {
  dryRun: boolean;
  scanned: number;
  eligible: number;
  purged: number;
  skipped: Record<string, number>;
  failures: string[];
};

export async function GET(req: NextRequest) {
  // ── Guard 1: never publicly callable ───────────────────────────────
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    console.error("[CRON-RETENTION] CRON_SECRET is not configured — purge is DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Guard 2: the dark switch. Unset ⇒ dry run. ─────────────────────
  const dryRun = (process.env.RETENTION_PURGE_ENABLED || "").trim() !== "true";

  const pipeline = createPipelineClient();
  const now = new Date();

  const report: PurgeReport = {
    dryRun,
    scanned: 0,
    eligible: 0,
    purged: 0,
    skipped: {},
    failures: [],
  };

  // ── Find rows whose timer has run out ──────────────────────────────
  // Filtered in SQL to the plausible set, then judged by the pure decision —
  // the SQL is an optimisation, never the authority.
  //
  // purged_at is added by retention_purge.sql, applied by hand. Until then this
  // query errors; that is caught and returned as a clean no-op so a missing
  // migration can never 500 a cron (the same defence the reminders cron uses).
  let rows: DeletionRequestRow[];
  try {
    rows = await fetchAllRows<DeletionRequestRow>((from, to) =>
      // purged_at is not in the generated types (added by retention_purge.sql)
      // → relaxed client.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any)
        .from("deletion_requests")
        .select("id, user_id, deleted_at, data_eligible_for_deletion_at, purged_at")
        .is("purged_at", null)
        .not("deleted_at", "is", null)
        .lte("data_eligible_for_deletion_at", now.toISOString())
        // Oldest-due first, then id as the tiebreaker. fetchAllRows requires a
        // STABLE order: data_eligible_for_deletion_at is not unique, and two
        // rows sharing a timestamp can otherwise swap places between pages and
        // silently skip one — on this job, a skipped row is an erasure that
        // never happens and a GDPR request that stays unfulfilled.
        .order("data_eligible_for_deletion_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch (err) {
    console.error("[CRON-RETENTION] candidate query failed (migration applied?):", err);
    return NextResponse.json({ ok: true, ...report, note: "no_candidates_or_migration_pending" });
  }

  report.scanned = rows.length;

  const { purge, skip } = partitionPurgeCandidates(rows, now);
  report.eligible = purge.length;
  for (const s of skip) {
    report.skipped[s.reason] = (report.skipped[s.reason] ?? 0) + 1;
  }

  if (purge.length === 0) {
    return NextResponse.json({ ok: true, ...report });
  }

  // Loud: a real erasure becoming due is a compliance event, not routine noise.
  console.warn(
    `[CRON-RETENTION] ${purge.length} account(s) past their 7-year retention window` +
      (dryRun ? " — DRY RUN, nothing will be erased." : " — ERASING NOW.")
  );

  for (const row of purge.slice(0, MAX_USERS_PER_RUN)) {
    // Guard 4: the prefix is the only thing bounding the blast radius.
    const prefix = storagePrefixForUser(row.user_id!);
    if (!prefix) {
      report.failures.push(`${row.id}: refused — user_id is not a plain uuid`);
      continue;
    }

    if (dryRun) {
      report.purged++; // "would have purged"
      continue;
    }

    // Per-user isolation: one failure never stops the rest, and a user whose
    // erasure failed keeps purged_at NULL so the next run retries them.
    try {
      await purgeOneUser(pipeline, row.user_id!, prefix);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: markErr } = await (pipeline as any)
        .from("deletion_requests")
        .update({ purged_at: new Date().toISOString() })
        .eq("id", row.id);
      if (markErr) throw new Error(`could not stamp purged_at: ${markErr.message}`);

      // The ONLY lasting record that this erasure happened — the files and rows
      // it describes no longer exist to be inspected.
      await logAuditAction({
        userId: row.user_id!,
        action: "user.data_purged",
        entityType: "deletion_request",
        entityId: row.id,
        newValue: { bucket: BUCKET, prefix, purged_at: new Date().toISOString() },
      }).catch(() => { /* the purge already succeeded — never undo it over a log */ });

      report.purged++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`[CRON-RETENTION] purge failed for ${row.id}:`, msg);
      report.failures.push(`${row.id}: ${msg}`);
    }
  }

  return NextResponse.json({ ok: true, ...report });
}

/**
 * Erase one user's files: Storage objects first, then their `documents` rows.
 *
 * ORDER IS DELIBERATE. Rows are the only index of what a user's objects are —
 * delete them first and any Storage failure leaves objects nobody can ever find
 * again (exactly the orphaning described in the report's A2). Objects first
 * means the worst case is a retryable row-delete failure, with the row still
 * pointing at storage that is already gone.
 */
async function purgeOneUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  userId: string,
  prefix: string
): Promise<void> {
  // ── 1. Storage objects under this user's prefix, page by page ──────
  // Recursive: keys are `${userId}/${year}/Q${q}/${file}`, and list() only
  // returns one level at a time.
  const removed = await removePrefixRecursive(pipeline, prefix);
  console.warn(`[CRON-RETENTION] removed ${removed} object(s) under ${prefix}`);

  // ── 2. The rows ────────────────────────────────────────────────────
  const { error: docErr } = await pipeline.from("documents").delete().eq("user_id", userId);
  if (docErr) throw new Error(`documents delete failed: ${docErr.message}`);

  const { error: folderErr } = await pipeline.from("folders").delete().eq("user_id", userId);
  if (folderErr) throw new Error(`folders delete failed: ${folderErr.message}`);
}

/**
 * Depth-first removal of everything under a Storage prefix. Returns the count.
 *
 * LIST THE WHOLE LEVEL FIRST, THEN DELETE. Do not "simplify" this back into a
 * delete-as-you-page loop: `list()` pages by OFFSET, so deleting a page shifts
 * every later entry forward by exactly the number just removed, and the next
 * request at offset+100 then starts 100 entries past where the data now begins.
 * With 250 files you would erase 100, skip 100, erase 50, and report success.
 *
 * Silent partial erasure is the worst possible outcome here: the row gets
 * stamped purged_at, so nothing ever comes back for the survivors, and we would
 * have told a person their data was deleted when it was not.
 */
async function removePrefixRecursive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  prefix: string
): Promise<number> {
  const files: string[] = [];
  const folders: string[] = [];

  // ── Phase 1: read the entire level, deleting nothing ───────────────
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data: entries, error } = await pipeline.storage
      .from(BUCKET)
      .list(prefix.replace(/\/$/, ""), { limit: LIST_PAGE, offset });

    if (error) throw new Error(`storage list failed at ${prefix}: ${error.message}`);
    if (!entries || entries.length === 0) break;

    for (const entry of entries as Array<{ id: string | null; name: string }>) {
      // Supabase marks a synthetic "folder" with a null id; everything else is
      // a real object.
      if (entry.id === null) folders.push(entry.name);
      else files.push(`${prefix}${entry.name}`);
    }

    if (entries.length < LIST_PAGE) break;
    // Backstop against a pathological listing; a real account is nowhere near.
    if (offset > 1_000_000) {
      throw new Error(`storage listing at ${prefix} exceeded the safety bound`);
    }
  }

  // ── Phase 2: now it is safe to delete ──────────────────────────────
  let removed = 0;
  for (let i = 0; i < files.length; i += LIST_PAGE) {
    const batch = files.slice(i, i + LIST_PAGE);
    const { error: rmErr } = await pipeline.storage.from(BUCKET).remove(batch);
    if (rmErr) throw new Error(`storage remove failed at ${prefix}: ${rmErr.message}`);
    removed += batch.length;
  }

  for (const folder of folders) {
    removed += await removePrefixRecursive(pipeline, `${prefix}${folder}/`);
  }

  return removed;
}
