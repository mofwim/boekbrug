// src/lib/ai-budget.ts
// [COST-GUARD] The fuse on Anthropic spend. One global daily ceiling.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A GLOBAL CEILING AND NOT A BETTER PER-USER QUOTA.
//
// Every limit in this app is per user, and per-user limits cannot bound this
// exposure, because the exposure is the SUM over users and paths:
//
//   · Six route buckets share RATE_LIMITS.AI_OCR at 240/hour — intake,
//     email/upload, email/reimport, eft/import,
//     bank/attach-invoice. Summed: 1,440 AI reads/hour from one account.
//   · /api/cron/email-sync selects EVERY row of email_connections with no plan
//     filter and classifies up to ~240 documents per user per run, twelve runs
//     a day.
//   · checkRateLimit() fails OPEN by design on any RPC error, so one Supabase
//     blip removes the fence entirely.
//   · /api/tools/scan-invoice is login-free and calls the paid API. Its durable
//     ceiling never worked at all (it bucketed by 'scan-ip:<ip>' against a uuid
//     column with a foreign key to profiles → cast error → fail open). Fixed in
//     ai_spend_guard.sql, but its existence is the reason a second, independent
//     ceiling is not paranoia.
//
// For a solo founder with a personal card on the Anthropic account, the control
// that matters is not a tidier quota — it is a euro number per day that cannot
// be exceeded no matter which path is being abused or which fence broke.
//
// This module is that number. Enforced at the three transports in ai.ts and at
// the public scanner, so there is no way to reach Anthropic that skips it.
// ─────────────────────────────────────────────────────────────────────────────

import { createPipelineClient } from "./supabase-pipeline";

/**
 * Daily ceiling in euros. Default 5.00 — enough for ~550 document reads a day,
 * which is far past any honest single-tenant use of a pre-revenue app, and far
 * below a number that would hurt to lose.
 *
 * Set AI_DAILY_BUDGET_EUR=0 to disable the ceiling but KEEP COUNTING, which is
 * the right setting for a few days after go-live: you learn the real shape of
 * your spend before choosing a number.
 */
function budgetMicros(): number {
  const raw = (process.env.AI_DAILY_BUDGET_EUR || "").trim();
  if (raw === "") return 5_000_000; // €5.00 default
  const eur = Number(raw);
  if (!Number.isFinite(eur) || eur < 0) return 5_000_000;
  return Math.round(eur * 1_000_000);
}

// ── Cost model ───────────────────────────────────────────────────────
//
// Haiku 4.5 (the app's default model): $1.00 / MTok input, $5.00 / MTok output;
// cache write 1.25× input, cache read 0.1× input. USD→EUR taken at 1.10.
//
// These are ESTIMATES and the fuse only needs them to be the right order of
// magnitude — it is a spend ceiling, not an invoice. Deliberately rounded UP so
// the fuse trips slightly early rather than slightly late.

/** Euros (in micros) per 1000 input tokens, assuming a cache WRITE (cold). */
const MICROS_PER_KTOK_IN = 1_375; // $1.00 × 1.25 × 1.10 = €1.375 / MTok
/** Euros (in micros) per 1000 output tokens. */
const MICROS_PER_KTOK_OUT = 5_500; // $5.00 × 1.10 = €5.50 / MTok

/**
 * What one call is expected to cost, in micro-euros.
 *
 * `inputTokens` should include the system prompt — the invoice prompt in ai.ts
 * alone is ~4,300 tokens before a single byte of the user's document, which is
 * the term every naive "$0.005 per scan" estimate forgets.
 */
export function estimateCostMicros(inputTokens: number, maxOutputTokens: number): number {
  const inTok = Math.max(0, inputTokens);
  const outTok = Math.max(0, maxOutputTokens);
  return Math.ceil((inTok / 1000) * MICROS_PER_KTOK_IN + (outTok / 1000) * MICROS_PER_KTOK_OUT);
}

/** Rough input-token size of a payload, by kind. Deliberately generous. */
export const TOKEN_ESTIMATE = {
  /** System prompt + a text-layer PDF's extracted text. */
  textDocument: 5_200,
  /** System prompt + a downscaled image (~1,600 image tokens after sharp). */
  imageDocument: 6_000,
  /** System prompt + a raw PDF document block (no text layer). */
  rawPdfDocument: 6_800,
  /** A short text-only call (translate, compose). */
  shortText: 1_200,
} as const;

export type BudgetVerdict = {
  /** May the call proceed? */
  allowed: boolean;
  /** Estimated euros spent today, after this reservation. */
  spentEur: number;
  /** The ceiling in euros; 0 means "counting only, no ceiling". */
  budgetEur: number;
  /** Why it was allowed — useful in logs. */
  reason: "within_budget" | "no_ceiling" | "exceeded" | "guard_unavailable";
};

/**
 * Reserve budget for ONE Claude call. Call this BEFORE the request.
 *
 * ── The fail direction, stated plainly ──
 * If the guard's own RPC fails (Supabase down, migration not applied), this
 * ALLOWS the call and says so loudly. That is the same fail-open choice the
 * existing rate limiter makes, and it is deliberate: a database blip must not
 * stop a customer reading their invoice.
 *
 * It is safe here in a way it was NOT safe for the public scanner's per-IP
 * bucket, and the difference is worth understanding. That bucket failed open on
 * EVERY request — permanently, by construction — so there was no ceiling at all.
 * This one fails open only while the database is unreachable, which an attacker
 * cannot cause and which is loudly visible. The public path additionally keeps
 * its own hard per-IP ceiling, so it never relies on this alone.
 */
export async function reserveAiBudget(params: {
  inputTokens: number;
  maxOutputTokens: number;
  /** For the log line — which call site is spending. */
  label: string;
}): Promise<BudgetVerdict> {
  const costMicros = estimateCostMicros(params.inputTokens, params.maxOutputTokens);
  const ceiling = budgetMicros();

  try {
    const pipeline = createPipelineClient();
    // ai_budget_consume is added by ai_spend_guard.sql and is not in the
    // generated types → relaxed client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (pipeline as any).rpc("ai_budget_consume", {
      p_cost_micros: costMicros,
      p_budget_micros: ceiling,
    });

    if (error || !data || data.length === 0) {
      console.warn(
        `[COST-GUARD] budget guard unavailable — allowing ${params.label}`,
        error?.message ?? "no rows"
      );
      return { allowed: true, spentEur: 0, budgetEur: ceiling / 1_000_000, reason: "guard_unavailable" };
    }

    const row = data[0] as { allowed: boolean; spent_micros: number; budget_micros: number };
    const spentEur = Number(row.spent_micros ?? 0) / 1_000_000;
    const budgetEur = Number(row.budget_micros ?? 0) / 1_000_000;

    if (!row.allowed) {
      // Loud: this is the fuse blowing, and somebody needs to look.
      console.error(
        `[COST-GUARD] DAILY AI BUDGET EXHAUSTED — refused ${params.label}. ` +
          `spent ≈ €${spentEur.toFixed(2)} of €${budgetEur.toFixed(2)}.`
      );
      return { allowed: false, spentEur, budgetEur, reason: "exceeded" };
    }

    return {
      allowed: true,
      spentEur,
      budgetEur,
      reason: budgetEur === 0 ? "no_ceiling" : "within_budget",
    };
  } catch (err) {
    console.warn(`[COST-GUARD] budget guard threw — allowing ${params.label}:`, err);
    return { allowed: true, spentEur: 0, budgetEur: ceiling / 1_000_000, reason: "guard_unavailable" };
  }
}

/** The Dutch message a user sees when the fuse has blown. Never blame them. */
export const BUDGET_EXHAUSTED_MESSAGE =
  "Automatisch inlezen is even niet beschikbaar. Je kunt het bestand gewoon opslaan en de gegevens zelf invullen — er gaat niets verloren.";
