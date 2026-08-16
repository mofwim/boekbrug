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
 * Daily ceiling in euros. Default 5.00.
 *
 * ── WHAT €5 ACTUALLY BUYS, AND WHY THAT NUMBER MOVED ──
 * This comment used to claim "~550 document reads a day". It did not match this
 * module's own arithmetic: estimateCostMicros(6000, 2000) is €0.019, so the fuse
 * blew at ~260 reads — and it blew GLOBALLY, for every user at once. One owner
 * importing a quarter of backlog on a Tuesday afternoon turned off automatic
 * reading for everybody else until midnight UTC.
 *
 * The reservation was the problem, not the ceiling. It charges max_tokens (2000)
 * where a real extraction answers in ~400, and it charges every input token at
 * the cache-WRITE rate where a batch reads the system prompt at 0.1×. Both are
 * the right direction to GUESS in — you must reserve before you know — but they
 * are the wrong number to KEEP.
 *
 * settleAiBudget() below now corrects each reservation to the tokens Anthropic
 * actually reported, within milliseconds of the call returning. A real read
 * costs ~€0.007 cold and ~€0.004 inside a batch, so the same €5 is roughly 700
 * documents a day — and the over-reservation now only bounds how many calls can
 * be in flight at once, which is exactly what a fuse should bound.
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
//
// The four rates are separate because prompt caching makes them differ by more
// than an order of magnitude, and the settlement below needs each one. The
// RESERVATION deliberately keeps using the most expensive of them.

/** Euros (in micros) per 1000 tokens, by kind. Haiku 4.5, USD→EUR at 1.10. */
export const MICROS_PER_KTOK = {
  /** Ordinary input: $1.00 / MTok. */
  input: 1_100,
  /** A cache WRITE: 1.25× input — what the first call of a batch pays. */
  cacheWrite: 1_375,
  /** A cache READ: 0.1× input — the 90% discount every later call of a batch gets. */
  cacheRead: 110,
  /** Output: $5.00 / MTok. */
  output: 5_500,
} as const;

/** Euros (in micros) per 1000 input tokens, assuming a cache WRITE (cold). */
const MICROS_PER_KTOK_IN = MICROS_PER_KTOK.cacheWrite;
/** Euros (in micros) per 1000 output tokens. */
const MICROS_PER_KTOK_OUT = MICROS_PER_KTOK.output;

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
  /** What was actually put on the day's tab, in micro-euros. */
  reservedMicros: number;
  /**
   * Did the counter really record this reservation?
   *
   * False when the guard was unreachable (fail-open) or when the call was
   * refused — in both cases NOTHING was added, so settling afterwards would
   * subtract money that was never charged. settleAiBudget() checks this.
   */
  recorded: boolean;
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
      return {
        allowed: true,
        spentEur: 0,
        budgetEur: ceiling / 1_000_000,
        reason: "guard_unavailable",
        reservedMicros: costMicros,
        recorded: false,
      };
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
      return {
        allowed: false,
        spentEur,
        budgetEur,
        reason: "exceeded",
        reservedMicros: 0, // a refused call reserves nothing — see ai_budget_consume()
        recorded: false,
      };
    }

    return {
      allowed: true,
      spentEur,
      budgetEur,
      reason: budgetEur === 0 ? "no_ceiling" : "within_budget",
      reservedMicros: costMicros,
      recorded: true,
    };
  } catch (err) {
    console.warn(`[COST-GUARD] budget guard threw — allowing ${params.label}:`, err);
    return {
      allowed: true,
      spentEur: 0,
      budgetEur: ceiling / 1_000_000,
      reason: "guard_unavailable",
      reservedMicros: costMicros,
      recorded: false,
    };
  }
}

// ── The settlement ───────────────────────────────────────────────────
//
// WHY A RESERVATION IS NOT AN ANSWER.
//
// You have to reserve before the call, and before the call you do not know two
// things that swing the price by 3–4×:
//
//   · how long the answer will be. We reserve max_tokens (2000) and a real
//     extraction answers in ~400. Output is the dearest token there is (5×
//     input), so that one guess is most of the error.
//   · whether the system prompt was a cache write or a cache read. Cold it
//     costs 1.25× input, warm it costs 0.1× — a 12× spread on ~4,300 tokens,
//     and inside a batch almost every call is warm.
//
// Guessing high is right; KEEPING the high guess is not. It made a €5/day
// ceiling behave like €1.50 of real spend, and since the ceiling is global that
// error was paid by every other user in the app.
//
// So: reserve high, then correct within milliseconds using the usage block
// Anthropic returns on every response. What remains over-reserved is only the
// handful of calls in flight at that moment, which is precisely what a fuse
// should hold back.

/** The usage block of a Messages API response. Every field may be absent. */
export interface ClaudeUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** A token count, or 0 for anything that is not a usable number. */
function tokens(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * What a call really cost, from the tokens Anthropic reported.
 *
 * Returns null when the usage block is missing or empty — and null means "do
 * not settle", so the conservative reservation simply stands. Never invent a
 * cheaper number from a response we could not read: that is the one direction
 * in which a fuse must not err.
 *
 * `input_tokens` excludes the cached portions; the API reports those in their
 * own two fields, which is why they are added rather than subtracted.
 */
export function actualCostMicros(usage: ClaudeUsage | null | undefined): number | null {
  if (!usage || typeof usage !== "object") return null;

  const inTok = tokens(usage.input_tokens);
  const write = tokens(usage.cache_creation_input_tokens);
  const read = tokens(usage.cache_read_input_tokens);
  const outTok = tokens(usage.output_tokens);

  // All four at zero is not a €0 call, it is an unreadable usage block.
  if (inTok + write + read + outTok === 0) return null;

  return Math.ceil(
    (inTok / 1000) * MICROS_PER_KTOK.input +
      (write / 1000) * MICROS_PER_KTOK.cacheWrite +
      (read / 1000) * MICROS_PER_KTOK.cacheRead +
      (outTok / 1000) * MICROS_PER_KTOK.output
  );
}

/**
 * How much the day's tab must move, given what was reserved and what it cost.
 *
 * Almost always negative — a refund. Positive when a document turned out bigger
 * than the estimate, and then it must be charged: a settlement that only ever
 * refunds is not a correction, it is a discount.
 *
 * Zero when there is nothing to correct, when nothing was reserved, or when the
 * usage block was unreadable. Pure, so the arithmetic is testable without a
 * database.
 */
export function settlementMicros(
  reserved: Pick<BudgetVerdict, "reservedMicros" | "recorded">,
  usage: ClaudeUsage | null | undefined
): number {
  if (!reserved.recorded || reserved.reservedMicros <= 0) return 0;
  const actual = actualCostMicros(usage);
  if (actual === null) return 0;
  return actual - reserved.reservedMicros;
}

/**
 * Correct one reservation to what the call really cost. Call it AFTER the
 * response, with `data.usage` from the body.
 *
 * Never throws and never blocks: a settlement that fails leaves the day's tab
 * on the conservative estimate, which costs the app a little capacity and costs
 * the user nothing. That is the only acceptable failure here — this runs after
 * a document has already been read, and nothing about it may reach the owner.
 */
export async function settleAiBudget(params: {
  reserved: Pick<BudgetVerdict, "reservedMicros" | "recorded">;
  usage: ClaudeUsage | null | undefined;
  /** For the log line — which call site is settling. */
  label: string;
}): Promise<void> {
  const delta = settlementMicros(params.reserved, params.usage);
  if (delta === 0) return;

  try {
    const pipeline = createPipelineClient();
    // ai_budget_settle is added by ai_budget_settle.sql and is not in the
    // generated types → relaxed client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (pipeline as any).rpc("ai_budget_settle", {
      p_delta_micros: delta,
    });
    if (error) {
      console.warn(
        `[COST-GUARD] settlement failed for ${params.label} — the estimate stands`,
        error.message
      );
    }
  } catch (err) {
    console.warn(`[COST-GUARD] settlement threw for ${params.label} — the estimate stands:`, err);
  }
}

/** The Dutch message a user sees when the fuse has blown. Never blame them. */
export const BUDGET_EXHAUSTED_MESSAGE =
  "Automatisch inlezen is even niet beschikbaar. Je kunt het bestand gewoon opslaan en de gegevens zelf invullen — er gaat niets verloren.";

/**
 * [COST-GUARD] The exact text the three transports in ai.ts throw when this fuse refuses a call.
 *
 * One constant, thrown there and recognised by isAiBudgetError below, because the two halves must
 * be unable to drift. A predicate that matched a message someone later rewrote would keep
 * compiling, keep passing its tests, and quietly stop recognising the one error it exists for.
 */
export const AI_BUDGET_EXHAUSTED_ERROR = "[COST-GUARD] daily AI budget exhausted";

/**
 * Is this error THIS FUSE — the global daily spend ceiling — rather than anything about the file?
 *
 * ── WHY THIS PREDICATE HAD TO EXIST ──
 *
 * The reader (verifyInvoiceFromPdf) catches every throw and returns a confidence-0 FALLBACK with
 * is_invoice:false. For a genuine unreadable file that is the right answer. For an infra failure it
 * is a lie with consequences, which is why the reader already re-throws a Claude HTTP error and a
 * network error when the caller opted in — and this refusal was in neither category, because the
 * fuse never reaches Anthropic and therefore never produces an "API error" text.
 *
 * So a blown ceiling read as "this is not an invoice". On the e-mail sync that verdict is
 * PERMANENT: the attachment is registered could_not_read and the watermark passes it, so a real
 * incoming invoice — its cost, its voorbelasting — is retired without anyone being told. And the
 * fuse blows precisely during a backfill, when the most documents are in flight.
 *
 * It is app-wide, self-healing at midnight, and never the document's fault. That combination is why
 * the sync must HOLD rather than give up, and why every manual door must say "probeer het zo
 * meteen opnieuw" instead of pronouncing on the file.
 *
 * Substring, not equality: the error crosses an async boundary and a wrapper may prefix it.
 */
export function isAiBudgetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes(AI_BUDGET_EXHAUSTED_ERROR);
}
