// src/lib/bank-balance.ts
// [BANK-SALDO] How much is actually in the bank. Pure, no I/O.
// Run: npx tsx --test src/lib/bank-balance.test.ts
//
// ── WHY THIS WAS MISSING, AND WHY THAT MATTERED ──
//
// The home screen is titled "Waar je staat". It showed what the owner OWES (€58.129 across 89
// purchase invoices), what he is OWED, and the cash in his till (€24.119) — and not one word about
// the bank. The single number a person actually needs in order to answer "can I pay this?" was the
// one number the screen left out, while showing the smaller pot right underneath it.
//
// That is worse than an omission. A screen that names two of the three pots reads as if it named
// them all: €58k owed against €24k visible is a panic that the bank balance might have resolved in
// one glance.
//
// And the number was never missing from the DATABASE. bank-ingest.ts already parses the statement's
// own declared closing balance (MT940 :62F:, CAMT.053 CLBD) — it needs it to prove the file is
// internally complete — and stores it in bank_statement_periods.closing_balance. It was read,
// verified, written, and then never shown to anyone.
//
// ── THE ONE THING THIS MUST NEVER DO ──
//
// Present a balance as if it were live. This figure is the closing balance of the last statement
// the owner UPLOADED. It is exact, and it is old — those are not in tension, they are both true,
// and dropping the second half is how an exact number becomes a lie. So `asOf` is not decoration
// here: a balance without its date is not a smaller version of this answer, it is a different and
// false one. Every caller renders them together.
//
// ── AND WHY A MISSING BALANCE IS NOT A ZERO ──
//
// A CSV export often carries no balance column at all. The honest answer is then "we do not know",
// which renders as nothing. Showing € 0,00 to someone with €58k of debt because his bank exports
// CSV would be the single most alarming wrong number this app could produce.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md).

/** One uploaded statement's period, as bank_statement_periods stores it. */
export interface StatementPeriod {
  /** The account it belongs to. Null when the file did not state one. */
  iban: string | null;
  /** ISO yyyy-mm-dd — the last day the statement covers. */
  periodEnd: string | null;
  /** The statement's own declared closing balance, or null when it declared none. */
  closingBalance: number | null;
}

export interface BankBalance {
  /** The total across accounts, or null when nothing usable was found. Never 0 for "unknown". */
  balance: number | null;
  /**
   * The date this total is true for.
   *
   * With several accounts this is the OLDEST of their end dates, not the newest. A sum is only as
   * current as its stalest part, and dating it by the freshest statement would make a total that
   * is a month out of date look like this morning's.
   */
  asOf: string | null;
  /** How many accounts contributed a balance. */
  accounts: number;
  /**
   * True when at least one account was left OUT — it has statements, but none declaring a balance.
   *
   * This exists so the screen can say the total is incomplete. A partial sum presented as the whole
   * is the same error as showing zero, only quieter: the owner reads a number that is smaller than
   * his real balance and has no way of knowing why.
   */
  partial: boolean;
}

const EMPTY: BankBalance = { balance: null, asOf: null, accounts: 0, partial: false };

/** A finite number, or null for anything that is not one. */
function amount(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A usable ISO date, or null. Only the shape is checked — the database supplies the value. */
function isoDate(v: string | null | undefined): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/**
 * The bank total, from the newest statement of every account.
 *
 * One account may have twelve statements; only its LAST closing balance is a balance — the earlier
 * ones are history, and summing them would produce a number with no meaning at all (it would grow
 * every month the owner uploads, regardless of his money).
 *
 * Accounts are keyed by IBAN. Statements without one are treated as a single unnamed account
 * rather than dropped: a bank that exports no IBAN is still a bank with money in it, and refusing
 * to count it would be the same silent under-report this whole file exists to prevent.
 */
export function bankBalanceOf(periods: readonly StatementPeriod[]): BankBalance {
  if (!Array.isArray(periods) || periods.length === 0) return EMPTY;

  /** Per account: the newest period that actually declared a balance. */
  const newestWithBalance = new Map<string, { end: string; balance: number }>();
  /** Every account seen at all — the difference is what `partial` reports. */
  const seen = new Set<string>();

  for (const p of periods) {
    const key = (p.iban ?? "").trim() || "(zonder iban)";
    seen.add(key);

    const end = isoDate(p.periodEnd);
    const bal = amount(p.closingBalance);
    // A balance without a date cannot be ranked against the others, so it cannot be known to be
    // the newest — and using it anyway would silently pick a random statement's balance.
    if (end === null || bal === null) continue;

    const current = newestWithBalance.get(key);
    if (!current || end > current.end) newestWithBalance.set(key, { end, balance: bal });
  }

  if (newestWithBalance.size === 0) return { ...EMPTY, partial: seen.size > 0 };

  let total = 0;
  let oldest: string | null = null;
  for (const { end, balance } of newestWithBalance.values()) {
    total += balance;
    if (oldest === null || end < oldest) oldest = end;
  }

  return {
    balance: Math.round(total * 100) / 100,
    asOf: oldest,
    accounts: newestWithBalance.size,
    partial: seen.size > newestWithBalance.size,
  };
}
