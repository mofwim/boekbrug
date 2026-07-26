// src/lib/retention-purge.ts
// [A1] Which deactivated accounts may have their FILES erased — pure, no I/O.
//
// Companion to retention.ts (which does the date maths). That module's
// isEligibleForDeletion had no caller anywhere in the app: an account could be
// deactivated, its 7-year timer set, the timer could expire — and nothing ever
// ran. GDPR Article 17 erasure was a stored timestamp and nothing more. This
// module is the decision half of the job that finally consumes it.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS DECIDES AN IRREVERSIBLE DELETION. It is the most dangerous logic in the
// application: everything else can be corrected afterwards, and this cannot.
//
// So the asymmetry that governs subscription.ts is INVERTED here. There, any
// ambiguity means "let them in", because a wrong lockout is worse than a wrong
// pass. Here, any ambiguity means "DO NOT DELETE", because keeping a file one
// quarter too long is a paperwork question, while deleting a company's
// bookkeeping one day too early is unrecoverable and legally serious — Dutch
// bewaarplicht requires those seven years.
//
// Every rule below therefore refuses on doubt: a missing timestamp, an
// unparseable date, an account that was never actually deactivated, a row that
// was already purged. A purge requires positive proof on every single count.
// ─────────────────────────────────────────────────────────────────────────────

import { isEligibleForDeletion } from "./retention";

/** A deletion_requests row, as far as this decision is concerned. */
export type DeletionRequestRow = {
  id: string;
  user_id: string | null;
  /**
   * [KLUIS] Het jaar t/m wanneer een gekochte Bewaarkluis loopt, of null.
   *
   * Dit is de reden dat RETENTION_PURGE_ENABLED tot nu toe uit moest blijven: zonder dit
   * getal kan de purge niet weten wie hij NIET mag aanraken. Iemand die vooruit heeft
   * betaald voor bewaring tot en met 2033 hoort niet gewist te worden omdat zijn eigen
   * zeven jaar toevallig eerder aflopen — dat zou het verwijderen van iets zijn waar
   * iemand voor betaald heeft.
   *
   * Wordt gevuld door de cron uit kluis_subscriptions (lopende rij, cancelled_at is null).
   */
  kluis_keep_through_year?: number | null;
  /** When the account was actually deactivated. NULL = never went through with it. */
  deleted_at: string | null;
  /** deleted_at + 7 years, stamped at deactivation time. */
  data_eligible_for_deletion_at: string | null;
  /** When the files were erased. Non-null = already done, never redo it. */
  purged_at?: string | null;
};

export type PurgeVerdict =
  | { purge: true }
  | { purge: false; reason: PurgeRefusal };

export type PurgeRefusal =
  | "no_user_id" // orphan row — nothing to purge, and no way to be sure whose
  | "not_deactivated" // the account is still live; this row is a leftover intent
  | "no_eligible_date" // the timer was never stamped → we cannot prove 7 years passed
  | "unparseable_date" // garbage in the column → refuse rather than guess
  | "retention_not_expired" // the seven years are not up
  | "bewaarkluis_actief" // [KLUIS] paid for, and paid-for storage is not ours to erase
  | "already_purged"; // done before; re-running must be a no-op

/**
 * May this row's FILES be erased?
 *
 * `now` is injected so tests are deterministic and so a single cron run judges
 * every row against one instant.
 */
export function decidePurge(row: DeletionRequestRow, now: Date): PurgeVerdict {
  if (!row.user_id) return { purge: false, reason: "no_user_id" };

  if (row.purged_at) return { purge: false, reason: "already_purged" };

  // The account must actually have been deactivated. A deletion_requests row is
  // created at EXPORT time, before the user confirms — so a row with no
  // deleted_at belongs to somebody who exported their data and then carried on
  // using BoekBrug. Erasing their files would be catastrophic and is exactly
  // the mistake this check exists to make impossible.
  if (!row.deleted_at) return { purge: false, reason: "not_deactivated" };

  if (!row.data_eligible_for_deletion_at) {
    return { purge: false, reason: "no_eligible_date" };
  }

  const eligibleMs = Date.parse(row.data_eligible_for_deletion_at);
  if (Number.isNaN(eligibleMs)) return { purge: false, reason: "unparseable_date" };

  // Belt and braces: trust the stored timestamp, but ALSO recompute the seven
  // years from deleted_at. If the two disagree, the later one wins — a corrupted
  // or hand-edited eligible-date can then only ever delay a purge, never bring
  // one forward.
  const deletedMs = Date.parse(row.deleted_at);
  if (Number.isNaN(deletedMs)) return { purge: false, reason: "unparseable_date" };

  const storedSaysReady = now.getTime() >= eligibleMs;
  const recomputedSaysReady = isEligibleForDeletion(row.deleted_at, now);

  if (!storedSaysReady || !recomputedSaysReady) {
    return { purge: false, reason: "retention_not_expired" };
  }

  // [KLUIS] Laatste hek, en het staat expres HELEMAAL onderaan: ook als alle andere
  // controles "weg ermee" zeggen, wint een betaalde Bewaarkluis. Wie vooruit heeft betaald
  // voor bewaring tot en met jaar X, houdt die bewaring tot en met jaar X — ook als zijn
  // wettelijke termijn eerder afloopt. Iets wissen waarvoor iemand heeft betaald is niet
  // een randgeval maar het ergste dat deze cron kan doen.
  const kluis = row.kluis_keep_through_year;
  if (typeof kluis === "number" && Number.isFinite(kluis) && now.getUTCFullYear() <= kluis) {
    return { purge: false, reason: "bewaarkluis_actief" };
  }

  return { purge: true };
}

/**
 * Split a page of rows into the ones to purge and the ones to skip (with the
 * reason, so a dry run can explain itself and an operator can audit it).
 */
export function partitionPurgeCandidates(
  rows: DeletionRequestRow[],
  now: Date
): {
  purge: DeletionRequestRow[];
  skip: Array<{ row: DeletionRequestRow; reason: PurgeRefusal }>;
} {
  const purge: DeletionRequestRow[] = [];
  const skip: Array<{ row: DeletionRequestRow; reason: PurgeRefusal }> = [];

  for (const row of rows) {
    const verdict = decidePurge(row, now);
    if (verdict.purge) purge.push(row);
    else skip.push({ row, reason: verdict.reason });
  }

  return { purge, skip };
}

/**
 * The Storage prefix that holds exactly one user's files.
 *
 * Keys are owner-prefixed (`${userId}/${year}/Q${q}/${file}` — see
 * documents.ts). Returning `${userId}/` and nothing else is what keeps a purge
 * inside one account.
 *
 * Refuses anything that is not a plain UUID. A user id is the ONLY thing that
 * bounds this deletion, so it is validated at the point of use rather than
 * trusted: a value carrying a slash or `..` could otherwise widen the prefix
 * and take another account's files with it.
 */
export function storagePrefixForUser(userId: string): string | null {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(userId)) return null;
  return `${userId}/`;
}
