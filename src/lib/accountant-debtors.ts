// src/lib/accountant-debtors.ts
// [DEBITEUREN] The accountant's chase-list, across every client who mandated them. Pure, no I/O.
// Run: npx tsx --test src/lib/accountant-debtors.test.ts
//
// WHY THIS EXISTS NEXT TO sales-overview.ts
//
// sales-overview.ts answers questions about ONE administration: is this invoice late, how much is
// outstanding, may it get a reminder. All of that is reused here unchanged — the rules about money
// and about how often you may mail someone's customer must not have a second implementation.
//
// What is genuinely new is the shape of the accountant's day. They do not open one company and
// work through it; they open a list of eight and want to know where the money is. That is a
// grouping and an ordering, and both are decisions with consequences:
//
//   · WHICH invoices appear. Only what canRemind() would let through, plus what it would refuse —
//     because "you have three overdue invoices at this client but none can be reminded today" is a
//     different fact from "nothing is late", and a board that shows only actionable rows tells the
//     accountant the first thing when the truth is the second.
//   · IN WHAT ORDER. Oldest debt first, not largest. A €120 invoice from January is a worse sign
//     than a €4.000 one from last week, and the point of this screen is catching the first kind
//     before it becomes uncollectible.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the `reason` sentences come
// from sales-overview.ts and stay Dutch — they are rendered on a Dutch screen.

import { canRemind, outstandingAmount, stateOf, type SalesInvoice } from "./sales-overview";

/** One overdue invoice, with everything the row needs already decided. */
export interface DebtorRow {
  invoice: SalesInvoice;
  /** Days past the due date. Always ≥ 1 here — nothing else reaches this list. */
  daysLate: number;
  /** What is still open on it, in euro. */
  outstanding: number;
  /** May a reminder go out right now, and if not, the sentence that says why. */
  verdict: ReturnType<typeof canRemind>;
}

/** One client, with their overdue invoices. */
export interface DebtorGroup {
  clientId: string;
  clientName: string;
  rows: DebtorRow[];
  /** Everything still open at this client, added up. */
  totalOutstanding: number;
  /** How many of the rows can actually be reminded right now. */
  remindable: number;
  /** The worst one — how many days is the oldest debt here? Drives the ordering. */
  worstDaysLate: number;
}

/** One invoice as it arrives from the database, with the client it belongs to. */
export interface DebtorInput extends SalesInvoice {
  ownerId: string;
  /**
   * The owner's "not this one" flag — a disputed invoice, a customer they are handling by phone.
   * The reminder cron obeys it and so does canRemindInvoice(); this board has to obey it too, or
   * it shows a live button that answers 409 the moment it is pressed. A screen that offers an
   * action it knows will be refused is worse than one that explains the refusal up front.
   */
  reminders_paused?: boolean | null;
}

/** The refusal a paused invoice gets here — the same sentence canRemindInvoice() uses. */
const PAUSED_REASON =
  "De ondernemer heeft herinneringen voor deze factuur stilgezet. Overleg met hem.";

const DAY_MS = 86_400_000;

/**
 * How many days late is this invoice?
 *
 * Returns 0 when there is no readable due date. Deliberately not "very late": an unreadable date
 * must never sort itself to the top of a chase list and get someone's customer mailed first.
 */
export function daysLate(f: SalesInvoice, nowMs: number): number {
  if (!f.due_date) return 0;
  const ms = Date.parse(f.due_date);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((nowMs - ms) / DAY_MS));
}

/**
 * The whole board, from a flat list of invoices across every mandated client.
 *
 * `names` maps a client id to what they are called. A client id with no name still appears — as
 * "Klant". Dropping the group would hide real money because a profile row was missing.
 */
export function buildDebtorBoard(
  invoices: readonly DebtorInput[],
  names: Readonly<Record<string, string>>,
  nowMs: number,
): DebtorGroup[] {
  const byClient = new Map<string, DebtorRow[]>();

  for (const f of invoices) {
    // Only what is genuinely late. 'concept', 'betaald' and 'vervallen' are not debts, and an
    // invoice whose due date has not passed is not one either — chasing it early is the fastest
    // way for an accountant to damage a relationship they were hired to protect.
    if (stateOf(f, nowMs) !== "te-laat") continue;
    const open = outstandingAmount(f);
    // Fully settled while the status lags behind. sales-overview.ts calls a reminder here the most
    // painful mail this product can send; it should not even be on the list.
    if (open <= 0) continue;

    const row: DebtorRow = {
      invoice: f,
      daysLate: daysLate(f, nowMs),
      outstanding: open,
      // Paused wins over every timing rule: it is the owner's explicit "not this one", and no
      // amount of waiting makes it allowed. The invoice still SHOWS — it is real debt, and hiding
      // it would make the total lie — it simply cannot be mailed from here.
      verdict: f.reminders_paused ? { allowed: false, reason: PAUSED_REASON } : canRemind(f, nowMs),
    };
    const list = byClient.get(f.ownerId);
    if (list) list.push(row);
    else byClient.set(f.ownerId, [row]);
  }

  const groups: DebtorGroup[] = [];
  for (const [clientId, rows] of byClient) {
    // Oldest debt first — see the header for why this is not sorted by amount.
    rows.sort((a, b) => b.daysLate - a.daysLate);
    groups.push({
      clientId,
      clientName: names[clientId] || "Klant",
      rows,
      totalOutstanding: rows.reduce((sum, r) => sum + r.outstanding, 0),
      remindable: rows.filter((r) => r.verdict.allowed).length,
      worstDaysLate: rows.length > 0 ? rows[0].daysLate : 0,
    });
  }

  // The client with the oldest debt on top. A tie is broken by money, and then by name, so the
  // order is stable across reloads — a board that shuffles is a board nobody trusts.
  groups.sort(
    (a, b) =>
      b.worstDaysLate - a.worstDaysLate ||
      b.totalOutstanding - a.totalOutstanding ||
      a.clientName.localeCompare(b.clientName, "nl"),
  );
  return groups;
}

/** The one line at the top of the screen. */
export interface BoardTotals {
  /** Everything overdue across every client, in euro. */
  outstanding: number;
  /** How many invoices that is. */
  invoices: number;
  /** At how many different clients. */
  clients: number;
  /** How many could be reminded right now — the only actionable number here. */
  remindable: number;
}

export function boardTotals(groups: readonly DebtorGroup[]): BoardTotals {
  return {
    outstanding: groups.reduce((s, g) => s + g.totalOutstanding, 0),
    invoices: groups.reduce((s, g) => s + g.rows.length, 0),
    clients: groups.length,
    remindable: groups.reduce((s, g) => s + g.remindable, 0),
  };
}
