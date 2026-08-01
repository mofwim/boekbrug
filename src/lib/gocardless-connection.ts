// src/lib/gocardless-connection.ts
// [GOCARDLESS] Storage of the bank link — server only.
//
// These helpers are the ONLY place that writes bank_connections / bank_connection_accounts.
// Both tables are readable by their owner but writable only through service_role (see
// supabase/migrations/bank_connections.sql): a client that could set status='linked' or invent
// an account_id would be attaching an account id of its choosing to its own row, and every
// subsequent sync would read THAT account's transactions through our credentials.
//
// Nothing here is a secret. The requisition and account ids are opaque identifiers that mean
// nothing without GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY, which live in the server
// environment and never in the database — hence no Vault dance, unlike snelstart-connection.ts.

import { randomBytes } from "crypto";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import type { Database } from "@/types/database.types";

type ConnectionUpdate = Database["public"]["Tables"]["bank_connections"]["Update"];
type AccountUpdate = Database["public"]["Tables"]["bank_connection_accounts"]["Update"];

export type BankConnectionStatus = "pending" | "linked" | "expired" | "error" | "revoked";

export interface BankConnectionAccount {
  id: string;
  connectionId: string;
  accountId: string;
  iban: string | null;
  ownerName: string | null;
  currency: string | null;
  status: string | null;
  lastSyncedAt: string | null;
  lastSyncedThrough: string | null;
  lastError: string | null;
}

export interface BankConnection {
  id: string;
  userId: string;
  requisitionId: string;
  agreementId: string | null;
  institutionId: string;
  institutionName: string | null;
  institutionBic: string | null;
  reference: string;
  status: BankConnectionStatus;
  accessValidUntil: string | null;
  maxHistoricalDays: number | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  accounts: BankConnectionAccount[];
}

const CONNECTION_SELECT =
  "id, user_id, requisition_id, agreement_id, institution_id, institution_name, institution_bic, reference, status, access_valid_until, max_historical_days, connected_at, last_synced_at, last_error" as const;

const ACCOUNT_SELECT =
  "id, connection_id, account_id, iban, owner_name, currency, status, last_synced_at, last_synced_through, last_error" as const;

interface ConnectionRow {
  id: string;
  user_id: string;
  requisition_id: string;
  agreement_id: string | null;
  institution_id: string;
  institution_name: string | null;
  institution_bic: string | null;
  reference: string;
  status: string;
  access_valid_until: string | null;
  max_historical_days: number | null;
  connected_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

interface AccountRow {
  id: string;
  connection_id: string;
  account_id: string;
  iban: string | null;
  owner_name: string | null;
  currency: string | null;
  status: string | null;
  last_synced_at: string | null;
  last_synced_through: string | null;
  last_error: string | null;
}

const KNOWN_STATUSES: BankConnectionStatus[] = ["pending", "linked", "expired", "error", "revoked"];

function toStatus(raw: string): BankConnectionStatus {
  return (KNOWN_STATUSES as string[]).includes(raw) ? (raw as BankConnectionStatus) : "error";
}

function toAccount(row: AccountRow): BankConnectionAccount {
  return {
    id: row.id,
    connectionId: row.connection_id,
    accountId: row.account_id,
    iban: row.iban,
    ownerName: row.owner_name,
    currency: row.currency,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    lastSyncedThrough: row.last_synced_through,
    lastError: row.last_error,
  };
}

function toConnection(row: ConnectionRow, accounts: AccountRow[]): BankConnection {
  return {
    id: row.id,
    userId: row.user_id,
    requisitionId: row.requisition_id,
    agreementId: row.agreement_id,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    institutionBic: row.institution_bic,
    reference: row.reference,
    status: toStatus(row.status),
    accessValidUntil: row.access_valid_until,
    maxHistoricalDays: row.max_historical_days,
    connectedAt: row.connected_at,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    accounts: accounts.filter((a) => a.connection_id === row.id).map(toAccount),
  };
}

/**
 * A fresh, unguessable nonce for one connect attempt.
 *
 * This is what the callback matches on. GoCardless echoes it back in the redirect, which lands
 * in the OWNER'S BROWSER — so anything in that URL is attacker-supplied until proven otherwise.
 * Trusting a user id from the query string there would let anyone finish a connection into
 * someone else's account; trusting a 256-bit random value that only we ever stored cannot.
 */
export function newConnectionReference(): string {
  return randomBytes(32).toString("base64url");
}

/** Every connection of one owner, with its accounts. What the UI card reads. */
export async function listBankConnections(userId: string): Promise<BankConnection[]> {
  const supabase = createPipelineClient();

  const { data: conns, error } = await supabase
    .from("bank_connections")
    .select(CONNECTION_SELECT)
    .eq("user_id", userId)
    // A revoked connection is history, not a link the owner still has — it would only confuse
    // the card. The row stays for the audit trail.
    .neq("status", "revoked")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GOCARDLESS] reading connections failed", { userId, error });
    return [];
  }
  const rows = (conns ?? []) as ConnectionRow[];
  if (rows.length === 0) return [];

  const { data: accts } = await supabase
    .from("bank_connection_accounts")
    .select(ACCOUNT_SELECT)
    .eq("user_id", userId)
    .in("connection_id", rows.map((r) => r.id));

  const accountRows = (accts ?? []) as AccountRow[];
  return rows.map((r) => toConnection(r, accountRows));
}

/** One connection by id, scoped to its owner. */
export async function getBankConnection(
  userId: string,
  connectionId: string,
): Promise<BankConnection | null> {
  const supabase = createPipelineClient();
  const { data, error } = await supabase
    .from("bank_connections")
    .select(CONNECTION_SELECT)
    .eq("user_id", userId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !data) return null;

  const { data: accts } = await supabase
    .from("bank_connection_accounts")
    .select(ACCOUNT_SELECT)
    .eq("user_id", userId)
    .eq("connection_id", connectionId);

  return toConnection(data as ConnectionRow, (accts ?? []) as AccountRow[]);
}

/**
 * The callback's lookup: find the pending connection this redirect belongs to.
 *
 * Deliberately takes ONLY the reference — no user id — because the caller has no trustworthy
 * user id at that point (the redirect may arrive in a browser with no session, e.g. the owner
 * finished consenting on his phone). The row itself carries the owner, and that row was written
 * by us.
 */
export async function findBankConnectionByReference(
  reference: string,
): Promise<BankConnection | null> {
  const supabase = createPipelineClient();
  const { data, error } = await supabase
    .from("bank_connections")
    .select(CONNECTION_SELECT)
    .eq("reference", reference)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as ConnectionRow;
  const { data: accts } = await supabase
    .from("bank_connection_accounts")
    .select(ACCOUNT_SELECT)
    .eq("connection_id", row.id);

  return toConnection(row, (accts ?? []) as AccountRow[]);
}

/** Record a connect attempt: the requisition exists at GoCardless, the owner has yet to consent. */
export async function createBankConnection(params: {
  userId: string;
  requisitionId: string;
  agreementId: string | null;
  institutionId: string;
  institutionName: string | null;
  institutionBic: string | null;
  reference: string;
  accessValidUntil: string | null;
  maxHistoricalDays: number | null;
}): Promise<BankConnection | null> {
  const supabase = createPipelineClient();
  const { data, error } = await supabase
    .from("bank_connections")
    .insert({
      user_id: params.userId,
      requisition_id: params.requisitionId,
      agreement_id: params.agreementId,
      institution_id: params.institutionId,
      institution_name: params.institutionName,
      institution_bic: params.institutionBic,
      reference: params.reference,
      status: "pending",
      access_valid_until: params.accessValidUntil,
      max_historical_days: params.maxHistoricalDays,
    })
    .select(CONNECTION_SELECT)
    .single();

  if (error || !data) {
    console.error("[GOCARDLESS] storing the connection failed", { userId: params.userId, error });
    return null;
  }
  return toConnection(data as ConnectionRow, []);
}

/**
 * The consent came back linked: store the accounts it unlocked.
 *
 * Upsert on (user_id, account_id), so RECONNECTING after the 90-day expiry re-points the
 * existing account row at the new connection instead of creating a second one. That matters
 * more than it looks: two rows for one bank account would mean two sync watermarks, both
 * pulling the same window, with only the content dedup standing between that and doubled money.
 * Re-pointing also PRESERVES last_synced_through, so a reconnect resumes where the feed stopped
 * instead of re-reading months the owner already has.
 */
export async function saveConnectionAccounts(params: {
  userId: string;
  connectionId: string;
  accounts: Array<{
    accountId: string;
    iban: string | null;
    ownerName: string | null;
    currency: string | null;
    status: string | null;
  }>;
}): Promise<number> {
  if (params.accounts.length === 0) return 0;
  const supabase = createPipelineClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("bank_connection_accounts")
    .upsert(
      params.accounts.map((a) => ({
        connection_id: params.connectionId,
        user_id: params.userId,
        account_id: a.accountId,
        iban: a.iban,
        owner_name: a.ownerName,
        currency: a.currency,
        status: a.status,
        last_error: null,
        updated_at: now,
      })),
      { onConflict: "user_id,account_id" },
    )
    .select("id");

  if (error) {
    console.error("[GOCARDLESS] storing the accounts failed", {
      userId: params.userId,
      connectionId: params.connectionId,
      error,
    });
    return 0;
  }
  return (data ?? []).length;
}

/** Move a connection to a new status, with the reason when there is one. */
export async function setConnectionStatus(params: {
  connectionId: string;
  status: BankConnectionStatus;
  lastError?: string | null;
  accessValidUntil?: string | null;
  connectedAt?: string | null;
}): Promise<void> {
  const supabase = createPipelineClient();
  const patch: ConnectionUpdate = {
    status: params.status,
    updated_at: new Date().toISOString(),
  };
  if (params.lastError !== undefined) patch.last_error = params.lastError?.slice(0, 500) ?? null;
  if (params.accessValidUntil !== undefined) patch.access_valid_until = params.accessValidUntil;
  if (params.connectedAt !== undefined) patch.connected_at = params.connectedAt;

  const { error } = await supabase
    .from("bank_connections")
    .update(patch)
    .eq("id", params.connectionId);
  if (error) {
    console.error("[GOCARDLESS] setting the connection status failed", {
      connectionId: params.connectionId,
      status: params.status,
      error,
    });
  }
}

/** Stamp the outcome of a sync onto one account — the rate-limit watermark. */
export async function recordAccountSync(params: {
  accountRowId: string;
  syncedThrough: string | null;
  lastError: string | null;
}): Promise<void> {
  const supabase = createPipelineClient();
  const now = new Date().toISOString();
  const patch: AccountUpdate = {
    last_error: params.lastError?.slice(0, 500) ?? null,
    updated_at: now,
  };
  // A FAILED read must still move last_synced_at. GoCardless counts successful reads against
  // the daily budget, but a run that retried a failing account every hour would burn the
  // general limit and hammer a bank that is already unhappy. Only last_synced_through — the
  // proof of what we actually hold — stays put on failure.
  patch.last_synced_at = now;
  if (!params.lastError && params.syncedThrough) patch.last_synced_through = params.syncedThrough;

  const { error } = await supabase
    .from("bank_connection_accounts")
    .update(patch)
    .eq("id", params.accountRowId);
  if (error) {
    console.error("[GOCARDLESS] recording the sync failed", { accountRowId: params.accountRowId, error });
  }
}

/** Stamp the connection-level sync moment (what the card shows as "laatst opgehaald"). */
export async function recordConnectionSync(connectionId: string, lastError: string | null): Promise<void> {
  const supabase = createPipelineClient();
  await supabase
    .from("bank_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: lastError ? lastError.slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
}

/**
 * Disconnect: mark revoked and drop the accounts.
 *
 * The imported TRANSACTIONS stay — they are the owner's bookkeeping, not a cache of the bank's,
 * and the retention obligation is ours regardless of whether the link still exists. Only the
 * feed stops.
 */
export async function revokeBankConnection(userId: string, connectionId: string): Promise<boolean> {
  const supabase = createPipelineClient();

  const { error: acctErr } = await supabase
    .from("bank_connection_accounts")
    .delete()
    .eq("user_id", userId)
    .eq("connection_id", connectionId);
  if (acctErr) {
    console.error("[GOCARDLESS] deleting the accounts failed", { userId, connectionId, acctErr });
    return false;
  }

  const { error } = await supabase
    .from("bank_connections")
    .update({
      status: "revoked",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", connectionId);

  if (error) {
    console.error("[GOCARDLESS] revoking the connection failed", { userId, connectionId, error });
    return false;
  }
  return true;
}
