// src/lib/turnover-book.ts
// [SHEET-BOOK] Shared DB writers for turnover + ledger, used by BOTH the live upload path
// (/api/intake) and the reprocess-stored-files path (/api/documents/reprocess). Extracting them
// here means "upload now" and "book my already-stored files" produce byte-identical rows — one
// source of truth for how a kassa Z-report / daily-sales PDF becomes daily_turnover, and how a
// PIN/kas grootboek becomes a ledger_daily witness.
//
// Both upserts are idempotent on (user, day[, kind]) → re-running over the same file corrects,
// never doubles. That idempotency is what makes a bulk reprocess safe to run repeatedly.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyTurnover } from "./turnover";
import type { LedgerKind } from "./ledger-import";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

export interface TurnoverBookResult {
  ok: boolean;
  days: number;
  span: string;
  total_incl: number;
}

/**
 * Upsert DailyTurnover rows into daily_turnover (source distinguishes provenance). Idempotent on
 * (user, turnover_date). When opts.preserveSplit is set (the daily-sales PDF, which carries no
 * payment split), the pin/cash/other columns are OMITTED from the payload so an ON CONFLICT upsert
 * leaves a richer Excel-sourced split untouched instead of nulling it.
 */
export async function bookTurnoverRows(
  supabase: AnySupabase,
  userId: string,
  rows: DailyTurnover[],
  source: string,
  opts?: { preserveSplit?: boolean },
): Promise<TurnoverBookResult> {
  const records = rows.map((r) => {
    const base = {
      user_id: userId,
      turnover_date: r.turnover_date,
      base_0: r.base_0 ?? 0, base_9: r.base_9 ?? 0, base_21: r.base_21 ?? 0,
      btw_9: r.btw_9 ?? 0, btw_21: r.btw_21 ?? 0,
      total_incl: r.total_incl ?? null,
      source,
    };
    if (opts?.preserveSplit) return base;
    return { ...base, pin_amount: r.pin_amount ?? null, cash_amount: r.cash_amount ?? null, other_amount: r.other_amount ?? null };
  });
  const { error } = await supabase.from("daily_turnover").upsert(records, { onConflict: "user_id,turnover_date" });
  const dates = rows.map((r) => r.turnover_date).sort();
  const span = dates.length ? `${dates[0]} t/m ${dates[dates.length - 1]}` : "";
  const total_incl = Math.round(records.reduce((s, r) => s + (r.total_incl ?? 0), 0) * 100) / 100;
  return { ok: !error, days: records.length, span, total_incl };
}

export interface LedgerBookResult {
  ok: boolean;
  days: number;
  span: string;
}

/**
 * Upsert per-day ledger totals into ledger_daily (a reconciliation WITNESS — never the P&L).
 * Idempotent on (user, ledger_date, kind). Gross day-totals are ≥ 0 (a refund lives in 'spent').
 */
export async function bookLedgerRows(
  supabase: AnySupabase,
  userId: string,
  kind: LedgerKind,
  accountNr: string | null,
  rows: { ledger_date: string; received: number; spent: number }[],
): Promise<LedgerBookResult> {
  const records = rows.slice(0, 1000).map((r) => ({
    user_id: userId,
    ledger_date: r.ledger_date,
    kind,
    received: r.received > 0 ? r.received : 0,
    spent: r.spent > 0 ? r.spent : 0,
    account_nr: accountNr,
    source: "ledger_xlsx",
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("ledger_daily").upsert(records, { onConflict: "user_id,ledger_date,kind" });
  const dates = records.map((r) => r.ledger_date).sort();
  const span = dates.length ? `${dates[0]} t/m ${dates[dates.length - 1]}` : "";
  return { ok: !error, days: records.length, span };
}
