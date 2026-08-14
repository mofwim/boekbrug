// src/lib/cash-transfer-match.ts
// [KAS-BRUG] The fourth reason a cash drawer goes below zero — the one the app could already see.
//
// ── WHY THIS EXISTS ──
//
// The reconciliation triangle (turnover.reconcileDay) compares a till day three ways: the Z-report's
// pin against the bank's card settlements, its contant against the cash book's omzet entries, and the
// Z-report against itself. It does not compare the drawer's TRANSFERS against the bank, and nothing
// else does either — even though both sides are already recorded and already labelled:
//
//   · the drawer calls them 'transfer' — direction 'in' is an opname (cash out of the bank into the
//     till), direction 'out' is a storting (cash out of the till into the bank);
//   · the bank line is classified 'transfer' by bank-identity, whose ATM_RE knows "geldautomaat",
//     "GEA", "geldopname", "contante opname" — the machine or the cash is always named.
//
// So when a drawer goes below zero, the app blocks the BTW-aangifte (readiness.ts, /api/btw/file) and
// names three possible causes on the Kas screen: the beginsaldo is too low, a receipt was not booked,
// an expense sits on the wrong date. There is a fourth, and in a shop it is the most ordinary of all:
// the owner took cash out of the bank and never wrote the opname in the cash book. The money is real,
// the withdrawal is on the bank statement the app has already imported and classified, and the drawer
// is short by exactly that amount.
//
// Leaving it out is the part that matters. A gate that refuses a filing over a number, while holding
// in its own database the most likely innocent explanation for that number, is accusing someone with
// the evidence in its pocket. Naming it costs nothing and turns a verdict into a question the owner
// can answer in ten seconds.
//
// ── WHY ONLY ONE DIRECTION ──
//
// This finds unrecorded WITHDRAWALS, not unrecorded deposits, and that is a deliberate asymmetry with
// two separate reasons:
//
//   1. Arithmetic. An unrecorded opname makes the cash book LOWER than the money in the till — it can
//      push the book below zero. An unrecorded storting makes the book HIGHER. Only the first one can
//      explain a negative drawer, and this runs to explain a negative drawer.
//   2. False positives. An unmatched drawer storting usually means the bank statement for those days
//      has not been imported yet, which is not a finding about anyone's cash. The reverse direction
//      cannot have that problem: it is driven FROM the bank lines, so no bank data means no finding.
//
// Pure + node-testable (run: npx tsx --test src/lib/cash-transfer-match.test.ts).

/** A bank line that moves cash, as this matcher needs it. */
export interface CashTransferBankLine {
  id: string;
  /** ISO day. A line without one cannot be placed against a drawer day and is skipped. */
  date: string | null;
  /** Positive = credit (cash arriving at the bank), negative = debit (cash leaving it). */
  amount: number | null;
  /** For the human sentence — the machine or branch, as the statement wrote it. */
  description: string | null;
  counterpartName?: string | null;
}

/** A drawer 'transfer' movement: direction 'in' = opname, 'out' = storting. */
export interface DrawerTransfer {
  date: string | null;
  direction: "in" | "out";
  amount: number | null;
}

export interface UnrecordedWithdrawal {
  /** bank_transactions.id — so a caller can link to the line itself. */
  bankLineId: string;
  /** ISO day the cash left the bank. */
  date: string;
  /** Magnitude, in euros, always positive. */
  amount: number;
  /** The statement's own words, trimmed — never invented. */
  description: string | null;
}

/** Cents. Below this two money figures are the same number — the app's shared epsilon. */
const EPSILON = 0.005;

/**
 * How many days a withdrawal and its drawer entry may be apart and still be the same event.
 *
 * Not zero: an owner who withdraws cash on Friday evening routinely books it on Monday, and a
 * statement date can differ from the day the machine dispensed. Not large either — a wide window
 * lets one drawer entry excuse a withdrawal it has nothing to do with, and the whole value of this
 * finding is that it points at a specific day.
 */
export const CASH_TRANSFER_DAY_WINDOW = 3;

const dayNumber = (iso: string): number => Math.floor(Date.UTC(
  Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)),
) / 86_400_000);

const isoDay = (v: string | null | undefined): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

/**
 * Bank cash withdrawals that no drawer 'opname' accounts for.
 *
 * Matching is one-to-one: a drawer entry can excuse exactly ONE withdrawal, because two withdrawals
 * of €500 in one week are two events and one €500 opname explains one of them. Without that, a shop
 * that withdraws the same round amount weekly would have every withdrawal excused by a single entry —
 * and the finding would vanish precisely where the pattern makes it most likely.
 *
 * Oldest first: the earliest unrecorded withdrawal is the one that starts the drift, and in a running
 * balance everything after it is wrong too.
 */
export function findUnrecordedCashWithdrawals(input: {
  /** Bank lines already narrowed to cash transfers (isCashTransferDescription) for the period. */
  bankLines: readonly CashTransferBankLine[];
  /** The drawer's 'transfer' movements for the same period. */
  drawerTransfers: readonly DrawerTransfer[];
  /** Days a pair may be apart. Defaults to CASH_TRANSFER_DAY_WINDOW. */
  dayWindow?: number;
}): UnrecordedWithdrawal[] {
  const window = input.dayWindow ?? CASH_TRANSFER_DAY_WINDOW;

  // Only the withdrawals: a debit is cash leaving the bank, and only that direction can leave a
  // drawer short (see the header). A €0 line is not a movement.
  const withdrawals = input.bankLines
    .flatMap((l) => {
      const date = isoDay(l.date);
      const amount = Number(l.amount) || 0;
      if (!date || amount >= -EPSILON) return [];
      return [{ id: l.id, date, amount: Math.abs(amount), description: (l.description ?? "").trim() || null }];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  // The drawer entries that could account for them: an opname is money INTO the till.
  const opnames = input.drawerTransfers
    .flatMap((e) => {
      const date = isoDay(e.date);
      const amount = Math.abs(Number(e.amount) || 0);
      if (!date || e.direction !== "in" || amount <= EPSILON) return [];
      return [{ date, amount, used: false }];
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const unrecorded: UnrecordedWithdrawal[] = [];
  for (const w of withdrawals) {
    const wDay = dayNumber(w.date);
    // The closest unused entry of the same amount inside the window. Closest, not first: with two
    // candidates the nearer one is the likelier pairing, and taking the first would consume an
    // entry that a later withdrawal needs more.
    let best: { entry: { used: boolean }; distance: number } | null = null;
    for (const o of opnames) {
      if (o.used) continue;
      if (Math.abs(o.amount - w.amount) > EPSILON) continue;
      const distance = Math.abs(dayNumber(o.date) - wDay);
      if (distance > window) continue;
      if (!best || distance < best.distance) best = { entry: o, distance };
    }
    if (best) { best.entry.used = true; continue; }
    unrecorded.push({ bankLineId: w.id, date: w.date, amount: w.amount, description: w.description });
  }
  return unrecorded;
}
