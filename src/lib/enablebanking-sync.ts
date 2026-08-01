// src/lib/enablebanking-sync.ts
// [ENABLEBANKING] Pulling a connected account's transactions into the existing bank pipeline.
//
// This module is deliberately THIN. It does not decide anything about money: it fetches, hands the
// JSON to enablebanking-map.ts, and then walks the SAME dedup → insert → auto-confirm →
// auto-categorize path that an uploaded MT940 walks in bank-ingest.ts. A second, parallel pipeline
// for bank-fed transactions is exactly how the two entry points in bank-ingest's own header
// drifted apart, and money-truth is the last place to repeat that.
//
// ── What it does NOT do, on purpose ────────────────────────────────────────────────────────────
//
//   · PENDING transactions are never imported. A pending line has no final amount and no final
//     date; when it books a day later it arrives again, with different values, and would import a
//     SECOND time — the content fingerprint cannot save us, because the fingerprint itself
//     changed. Only booked money is money. The mapper counts what it passed over so the number is
//     visible rather than silently absent.
//   · No passthrough document is stored. There is no original file to store — the bank fed us
//     JSON. The closing package already says this out loud for such a quarter, which is the honest
//     outcome; a generated file would LOOK like a bank statement without being one, and an
//     accountant cannot tell the difference by eye.
//   · No statement balance check. That check proves an uploaded FILE is internally complete
//     (opening + Σtx = closing). A feed has no statement boundaries, so there is nothing to
//     reconcile against and a fabricated pass would be worse than no check at all.

import type { PipelineClient } from "./supabase-pipeline";
import { createPipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import { dedupTransactions, mapToRows, dateRange, type ExistingTxKey } from "./bank-import";
import { runBankAutoConfirm } from "./bank-auto-confirm";
import { applyLearnedBankCategories } from "./bank-auto-categorize";
import { mapEnableBankingTransactions } from "./enablebanking-map";
import type { EnableBankingRawTransaction } from "./enablebanking-map";
import {
  createEnableBankingClient,
  dutchEnableBankingError,
  EnableBankingError,
  needsReconnect,
  shouldBackOffAfter,
  type EnableBankingClient,
  type EnableBankingErrorCode,
} from "./enablebanking-client";
import {
  recordAccountSync,
  recordConnectionSync,
  setConnectionStatus,
  type BankConnection,
  type BankConnectionAccount,
} from "./enablebanking-connection";

/**
 * How long we wait between two reads of the SAME account.
 *
 * A bank allows a handful of transaction reads per day per account. Twenty hours is under a full
 * day — so a daily cron never skips a day by drifting a few minutes — while still leaving the
 * owner's manual "ververs" button room to work at all.
 */
export const SYNC_MIN_INTERVAL_HOURS = 20;

/**
 * How far BEFORE the last synced date the next pull starts.
 *
 * A transaction can book days after it happened, and a window that starts exactly where the last
 * one ended would step straight over it. Overlap is free — the content dedup in bank-import.ts
 * drops what we already have — and a missed transaction is not.
 */
export const SYNC_OVERLAP_DAYS = 7;

/** History to request on a FIRST sync when the bank told us nothing better. */
export const DEFAULT_FIRST_SYNC_DAYS = 365;

/** Nothing is asked for beyond this, whatever a bank claims to offer. */
export const MAX_HISTORICAL_DAYS_CAP = 730;

export interface AccountSyncResult {
  accountId: string;
  iban: string | null;
  /** Transactions the feed handed over. */
  fetched: number;
  /** Rows actually written. */
  inserted: number;
  /** Duplicates the fingerprint recognised — almost always the intentional window overlap. */
  skipped: number;
  /** Entries the bank has not committed yet. Passed over on purpose, counted so it is visible. */
  pending: number;
  /** Lines we could NOT read. Dutch, owner-facing; never silently dropped. */
  warnings: string[];
  /** Dutch error when this account failed entirely, else null. */
  error: string | null;
  /**
   * The machine-readable cause behind `error`.
   *
   * Kept separate on purpose: the connection-level decision below ("is this a dead consent, or a
   * bank having a bad afternoon?") must never be made by comparing the DUTCH sentence to a
   * generated one. That works exactly until someone improves the wording, at which point every
   * expired connection silently starts being filed as a generic error and nobody is ever asked to
   * reconnect. A code cannot rot that way.
   */
  errorCode: EnableBankingErrorCode | null;
  /** True when the account was skipped because it was read recently (rate-limit guard). */
  skippedTooSoon: boolean;
}

export interface ConnectionSyncResult {
  connectionId: string;
  institutionName: string | null;
  accounts: AccountSyncResult[];
  inserted: number;
  /** Payments auto-booked against an invoice as a direct result of this sync. */
  autoBooked: number;
  /** Dutch error at the connection level (expired consent, dead credentials), else null. */
  error: string | null;
}

/** ISO date (YYYY-MM-DD) `days` before `from`. Pure — the date maths is tested, not the clock. */
export function isoDaysBefore(from: Date, days: number): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * May this account be read now? The rate-limit guard, as a pure decision.
 *
 * A never-synced account is always due. Otherwise it waits out SYNC_MIN_INTERVAL_HOURS. An
 * unparseable timestamp counts as due: refusing to sync on a corrupt column would stop the feed
 * forever and silently, which is worse than one extra read.
 */
export function isAccountDue(
  lastSyncedAt: string | null,
  now: Date,
  minIntervalHours = SYNC_MIN_INTERVAL_HOURS,
): boolean {
  if (!lastSyncedAt) return true;
  const last = Date.parse(lastSyncedAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= minIntervalHours * 3_600_000;
}

/**
 * The window to request for one account.
 *
 * First sync → as much history as the consent allows (capped). Later syncs → from
 * SYNC_OVERLAP_DAYS before the last synced date, so a late booking cannot slip through the seam.
 */
export function syncWindow(
  account: Pick<BankConnectionAccount, "lastSyncedThrough">,
  connection: Pick<BankConnection, "maxHistoricalDays">,
  now: Date,
): { dateFrom: string; dateTo: string } {
  const dateTo = now.toISOString().slice(0, 10);

  if (account.lastSyncedThrough) {
    return {
      dateFrom: isoDaysBefore(new Date(`${account.lastSyncedThrough}T00:00:00Z`), SYNC_OVERLAP_DAYS),
      dateTo,
    };
  }

  const requested = connection.maxHistoricalDays ?? DEFAULT_FIRST_SYNC_DAYS;
  const days = Math.min(Math.max(requested, 1), MAX_HISTORICAL_DAYS_CAP);
  return { dateFrom: isoDaysBefore(now, days), dateTo };
}

/**
 * Store a mapped batch through the SAME gate an uploaded statement passes.
 *
 * Extracted so the dedup discipline is one call, not a copy: fetch every existing row in the
 * window (paginated — PostgREST's silent ~1000-row first page truncated this exact SELECT once
 * before, and a truncated "existing" set means duplicates get inserted while the import honestly
 * reports "N skipped"), multiset-diff against it, insert the remainder.
 */
async function storeTransactions(args: {
  pipeline: PipelineClient;
  userId: string;
  transactions: ReturnType<typeof mapEnableBankingTransactions>["transactions"];
}): Promise<{ inserted: number; skipped: number }> {
  const { pipeline, userId, transactions } = args;
  if (transactions.length === 0) return { inserted: 0, skipped: 0 };

  const { min, max } = dateRange(transactions);
  let existing: ExistingTxKey[] = [];
  if (min && max) {
    const rows = await fetchAllRows((from, to) =>
      pipeline
        .from("bank_transactions")
        .select("date, amount, description, counterpart_name, reference")
        .eq("user_id", userId)
        .gte("date", min)
        .lte("date", max)
        .order("id", { ascending: true })
        .range(from, to),
    );
    existing = rows as ExistingTxKey[];
  }

  const dd = dedupTransactions(transactions, existing);
  if (dd.toInsert.length === 0) return { inserted: 0, skipped: dd.skipped };

  const rows = mapToRows(dd.toInsert, userId);
  let { error } = await pipeline.from("bank_transactions").insert(rows);
  // [BANK-IBAN] Resilient to a not-yet-applied migration, exactly as bank-ingest is: if
  // counterpart_iban does not exist yet (42703), retry without it rather than lose the import.
  if (error && (error as { code?: string }).code === "42703") {
    const stripped = rows.map(({ counterpart_iban: _omit, ...r }) => r);
    ({ error } = await pipeline.from("bank_transactions").insert(stripped));
  }
  if (error) {
    console.error("[ENABLEBANKING] inserting transactions failed", { userId, rows: rows.length, error });
    return { inserted: 0, skipped: dd.skipped };
  }
  return { inserted: rows.length, skipped: dd.skipped };
}

/** Sync ONE account. Never throws: the caller is a loop over accounts and one failure must not
 *  take the others down with it. */
async function syncOneAccount(args: {
  client: EnableBankingClient;
  pipeline: PipelineClient;
  connection: BankConnection;
  account: BankConnectionAccount;
  now: Date;
  force: boolean;
}): Promise<AccountSyncResult> {
  const { client, pipeline, connection, account, now, force } = args;
  const base: AccountSyncResult = {
    accountId: account.accountId,
    iban: account.iban,
    fetched: 0,
    inserted: 0,
    skipped: 0,
    pending: 0,
    warnings: [],
    error: null,
    errorCode: null,
    skippedTooSoon: false,
  };

  if (!force && !isAccountDue(account.lastSyncedAt, now)) {
    return { ...base, skippedTooSoon: true };
  }

  const { dateFrom, dateTo } = syncWindow(account, connection, now);

  let raw: EnableBankingRawTransaction[];
  try {
    // The client follows continuation keys to the end, so this is the WHOLE window, not a page.
    raw = (await client.getTransactions(account.accountId, { dateFrom, dateTo })) as EnableBankingRawTransaction[];
  } catch (err) {
    const code = err instanceof EnableBankingError ? err.code : null;
    const dutch = code ? dutchEnableBankingError(code) : "Ophalen bij de bank mislukt.";
    console.warn("[ENABLEBANKING] fetching transactions failed", {
      accountId: account.accountId,
      code: code ?? "UNKNOWN",
    });
    await recordAccountSync({
      accountRowId: account.id,
      syncedThrough: null,
      lastError: dutch,
      // A bank that is down, or our own network, must not spend the owner's daily read —
      // otherwise his first sync after connecting greys out the button until tomorrow for
      // something that fixes itself in minutes.
      backOff: shouldBackOffAfter(code),
    });
    return { ...base, error: dutch, errorCode: code };
  }

  const { transactions, warnings, skipped: pending } = mapEnableBankingTransactions(raw);
  const { inserted, skipped } = await storeTransactions({
    pipeline,
    userId: connection.userId,
    transactions,
  });

  await recordAccountSync({ accountRowId: account.id, syncedThrough: dateTo, lastError: null });

  return { ...base, fetched: raw.length, inserted, skipped, pending, warnings };
}

/**
 * Sync every account of one connection.
 *
 * `force` is the owner pressing "ververs" — it bypasses the 20-hour guard but NOT the bank's own
 * daily budget, which answers 429 and surfaces as a calm Dutch line rather than an error state.
 */
export async function syncBankConnection(args: {
  connection: BankConnection;
  pipeline?: PipelineClient;
  client?: EnableBankingClient;
  now?: Date;
  force?: boolean;
}): Promise<ConnectionSyncResult> {
  const connection = args.connection;
  const pipeline = args.pipeline ?? createPipelineClient();
  const now = args.now ?? new Date();
  const force = args.force ?? false;

  const result: ConnectionSyncResult = {
    connectionId: connection.id,
    institutionName: connection.institutionName ?? connection.aspspName,
    accounts: [],
    inserted: 0,
    autoBooked: 0,
    error: null,
  };

  if (connection.status === "revoked") {
    result.error = "Deze bankkoppeling is losgekoppeld.";
    return result;
  }

  let client: EnableBankingClient;
  try {
    client = args.client ?? createEnableBankingClient();
  } catch (err) {
    result.error =
      err instanceof EnableBankingError
        ? dutchEnableBankingError(err.code)
        : "De bankkoppeling is niet beschikbaar.";
    return result;
  }

  for (const account of connection.accounts) {
    const one = await syncOneAccount({ client, pipeline, connection, account, now, force });
    result.accounts.push(one);
    result.inserted += one.inserted;
  }

  // An expired consent shows up as a failure on EVERY account at once — the whole session died,
  // not one account. Promote it to the connection so the card asks the owner to reconnect instead
  // of showing four identical account errors he cannot act on.
  const errored = result.accounts.filter((a) => a.error);
  if (errored.length > 0 && errored.length === result.accounts.length) {
    result.error = errored[0].error;
    // 'expired' is the status that makes the panel offer "Opnieuw koppelen" instead of a "Ververs"
    // button that can only fail — so it must cover every cause that only a fresh consent can fix
    // (lapsed consent, an invalidated session, an account gone at the bank), not just the literal
    // expiry. Decided on the CODE, never on the Dutch sentence.
    const dead = errored[0].errorCode !== null && needsReconnect(errored[0].errorCode);
    await setConnectionStatus({
      connectionId: connection.id,
      status: dead ? "expired" : "error",
      lastError: errored[0].error,
    });
  } else if (result.accounts.some((a) => !a.error && !a.skippedTooSoon)) {
    // At least one account read cleanly — the connection is alive again whatever it said before.
    if (connection.status !== "linked") {
      await setConnectionStatus({ connectionId: connection.id, status: "linked", lastError: null });
    }
  }

  // [BANK-CIRCLE-SERVER] Close the circle the moment new transactions land, exactly as the upload
  // path does: book the near-certain payments (reference printed + amount to the cent) without
  // waiting for the owner to open /dashboard/bank. Best-effort — a reconcile hiccup must never
  // undo a successful import.
  if (result.inserted > 0) {
    try {
      const confirmed = await runBankAutoConfirm({ payClient: pipeline, pipeline, userId: connection.userId });
      result.autoBooked = confirmed.length;
    } catch (e) {
      console.error("[ENABLEBANKING] auto-confirm after sync failed (non-fatal)", e);
    }
    try {
      await applyLearnedBankCategories({ pipeline, userId: connection.userId });
    } catch (e) {
      console.error("[ENABLEBANKING] auto-categorize after sync failed (non-fatal)", e);
    }
  }

  const anyRead = result.accounts.some((a) => !a.skippedTooSoon);
  if (anyRead) await recordConnectionSync(connection.id, result.error);

  return result;
}
