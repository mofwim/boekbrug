// src/lib/kasboek.ts
// [KASBOEK] The cash book as LIVE DATA, not a hand-kept spreadsheet. This is a PURE PROJECTION —
// it combines two sources the app already holds and computes the running drawer balance per day,
// exactly like the store's "Kiwi Kasboek" file (Beginsaldo · Uitgaven · Ontvangsten · Eindsaldo,
// per month). Crucially it PERSISTS NOTHING and books NOTHING into the P&L, so there is zero
// double-count risk with the turnover engine:
//
//   Ontvangsten (cash IN)  = the till's daily CASH takings (daily_turnover.cash_amount)  ← revenue
//                            + any manual cash-in entries (opname/withdrawal, correction)
//   Uitgaven   (cash OUT)  = cash-book entries with direction 'out' (a cash-paid invoice's
//                            'betaling' settlement, a cash expense, salaris, storting to bank …)
//   Eindsaldo              = running balance from the opening balance
//
// The daily cash takings live in daily_turnover (where computeResult already books the omzet
// ONCE). We NEVER copy them into cash_entries — that would double-count revenue. Instead the
// drawer view reads both and adds them only for the BALANCE, never for the P&L. Same discipline
// as readiness: a projection over the truth layer, not a new source of truth.
//
// Pure + node-testable (run: npx tsx src/lib/kasboek.test.ts).

import { round2 } from './invoice-totals'

export type Quarter = 1 | 2 | 3 | 4;

/** Minimal structural view of a daily_turnover row — only what the drawer needs. */
export interface KasTurnoverDay {
  turnover_date: string;      // ISO 'YYYY-MM-DD'
  cash_amount: number | null; // the CASH portion of that day's gross takings
}

/** Minimal structural view of a cash_entries row. */
export interface KasEntry {
  entry_date: string | null;  // ISO 'YYYY-MM-DD'
  direction: "in" | "out";
  amount: number | null;
  category: string | null;
  description: string | null;
}

export interface KasRow {
  date: string;               // ISO
  beginsaldo: number;
  ontvangsten: number;        // cash IN that day
  uitgaven: number;           // cash OUT that day
  descriptions: string[];     // human descriptions of the day's movements (Uitgaven first)
  eindsaldo: number;
}

export interface KasMonth {
  key: string;                // 'YYYY-MM'
  label: string;              // Dutch month label e.g. 'jan 2026'
  rows: KasRow[];
  totalIn: number;
  totalOut: number;
}

export interface Kasboek {
  year: number;
  quarter: Quarter;
  openingBalance: number;     // Beginsaldo of the first day (carried from prior periods)
  closingBalance: number;     // Eindsaldo of the last day
  months: KasMonth[];
  totalIn: number;
  totalOut: number;
}

const MONTHS_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const nlDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };
const pad = (n: number) => String(n).padStart(2, "0");
const r2 = round2;

/**
 * The quarter's first and last day, as ISO strings.
 *
 * Exported because a caller that needs to bound a query to the same quarter must not compute it a
 * second time. The obvious hand-rolled version — `${year}-${quarter * 3}-31` — is wrong for Q2 and
 * Q4 (June and September have 30 days), and a Postgres `date` column answers an invalid date with an
 * error rather than an empty result, so the second spelling does not fail quietly in testing either.
 * One definition, used by everything that means "this quarter".
 */
export function quarterRange(year: number, q: Quarter): { start: string; end: string } {
  const startMonth = (q - 1) * 3; // 0-based
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0)); // last day of the quarter
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;
  return { start, end };
}

const isoDay = (s: string | null | undefined): string | null =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;

/**
 * [KAS-DUBBELTELLING] The days the till's own Z-report already counted cash for.
 *
 * Only days with a NON-ZERO cash amount: a zero/empty turnover row means the till counted no
 * cash that day, so it must never suppress a real cash movement. An unparseable date cannot be
 * matched against anything and is left out — the safe side for a figure that gets SUBTRACTED.
 */
function tillCountedDays(turnover: KasTurnoverDay[]): Set<string> {
  const days = new Set<string>();
  for (const t of turnover) {
    const d = isoDay(t.turnover_date);
    if (!d) continue;
    if ((Number(t.cash_amount) || 0) === 0) continue;
    days.add(d);
  }
  return days;
}

/**
 * [KAS-DUBBELTELLING] Is this entry the SAME money the till already counted on that day?
 *
 * A till shop's cash revenue reaches the drawer twice by design of the data model, not by
 * mistake: once as daily_turnover.cash_amount (what the Z-report counted) and once as a
 * cash_entries row with direction 'in' and category 'omzet' — which is what the Kas page's
 * default category makes the natural way to write down the counted drawer.
 *
 * Only 'omzet' IN: a cash purchase, a bank deposit or a private withdrawal on that same day are
 * separate movements and still count. One predicate, used by BOTH the carry-in and the in-quarter
 * rows below, because those two disagreeing is the bug this exists to prevent — see the
 * [KAS-DUBBELTELLING] note in openingBalanceForQuarter.
 */
function isTillCountedOmzet(e: KasEntry, day: string, counted: ReadonlySet<string>): boolean {
  return e.direction === "in" && (e.category ?? "") === "omzet" && counted.has(day);
}

/**
 * The drawer's OPENING balance for a quarter = a configured starting balance PLUS every cash
 * movement dated BEFORE the quarter start. Pure — same combine rule as the in-quarter rows, so
 * the balance is continuous across quarter boundaries (Q2 opens where Q1 closed).
 *
 * ── [KAS-DUBBELTELLING] The carry-in obeys the same rule as the rows ──
 *
 * buildKasboek has skipped a till-covered cash 'omzet' entry since that bug was found, and
 * computeDrawerBalance (the headline "SALDO IN KASSA") skips it too. This function did not — it
 * summed BOTH sources for every day before the quarter — so the suppression only ever held for
 * the quarter you were LOOKING at, and every earlier quarter's double count came back in through
 * the carry-in. A shop taking €500 a day in cash opened Q2 roughly €45.000 above the money that
 * was ever in the drawer.
 *
 * That figure is not decorative, and it is the same list of consequences as the original bug, one
 * quarter later:
 *   · every eindsaldo in the quarter, in the Kasboek sheet the closing package hands the
 *     accountant — the cash administration the Belastingdienst reads;
 *   · the drawer witness that /api/btw/file and readiness.ts use to REFUSE a filing on a negative
 *     drawer (lowestDrawerPoint SEEDS its worst point with this number), so a Q2 drawer that
 *     really dipped to −200 read as +300 and the quarter filed with the strongest naheffing
 *     signal masked;
 *   · and the headline saldo on the Kas page, which uses the honest definition, then disagreed
 *     with the Kasboek panel directly beneath it on the same screen.
 */
export function openingBalanceForQuarter(args: {
  turnover: KasTurnoverDay[];
  entries: KasEntry[];
  year: number;
  quarter: Quarter;
  startingBalance?: number;
}): number {
  const { turnover, entries, year, quarter, startingBalance = 0 } = args;
  const { start } = quarterRange(year, quarter);
  const counted = tillCountedDays(turnover);
  let bal = startingBalance;
  for (const t of turnover) {
    const d = isoDay(t.turnover_date);
    if (d && d < start) bal += Number(t.cash_amount) || 0;
  }
  for (const e of entries) {
    const d = isoDay(e.entry_date);
    if (!d || d >= start) continue;
    if (isTillCountedOmzet(e, d, counted)) continue;
    bal += (e.direction === "in" ? 1 : -1) * (Number(e.amount) || 0);
  }
  return r2(bal);
}

/**
 * Build the running cash book for one quarter. A row is emitted for every day that has ANY cash
 * movement (in or out); the balance only changes on those days, so this is complete and exact.
 * Pure — no I/O, no persistence, no P&L effect.
 */
export function buildKasboek(args: {
  turnover: KasTurnoverDay[];
  entries: KasEntry[];
  year: number;
  quarter: Quarter;
  openingBalance?: number;
}): Kasboek {
  const { turnover, entries, year, quarter, openingBalance = 0 } = args;
  const { start, end } = quarterRange(year, quarter);

  // Aggregate per day, in-quarter only.
  type Day = { in: number; out: number; desc: string[] };
  const byDay = new Map<string, Day>();
  const get = (d: string): Day => {
    let x = byDay.get(d);
    if (!x) { x = { in: 0, out: 0, desc: [] }; byDay.set(d, x); }
    return x;
  };

  // Days the till already counted. The entry loop below needs it to avoid booking the same
  // takings a second time — see [KAS-DUBBELTELLING] there. Built by the SHARED helper, which
  // openingBalanceForQuarter uses as well: the carry-in and the rows applying different rules is
  // exactly how this bug came back once already.
  const tellByTill = tillCountedDays(turnover);
  for (const t of turnover) {
    const d = isoDay(t.turnover_date);
    if (!d || d < start || d > end) continue;
    const cash = Number(t.cash_amount) || 0;
    if (cash === 0) continue;
    // [KAS-NEGATIEVE-DAG] A day's cash takings CAN be negative, and the import means it: a day with
    // more cash refunded than rung up is written "(1.234,56)" or "-1.234,56" in the Z-report, and
    // turnover-import's num() captures that sign on purpose ([L1] there).
    //
    // Such a day belongs in Uitgaven, not in Ontvangsten as a negative. The running balance was
    // right either way — begin + (−50) − 0 is the same money — but the LINE was not, and this is a
    // ledger, read column by column:
    //   · on screen the row renders `ontvangsten > 0 &&` and `uitgaven > 0 &&`, so BOTH amounts
    //     were hidden: the eindsaldo dropped €50 with no figure anywhere on the row saying why;
    //   · in the .xlsx the accountant opens, "Ontvangsten" held −50 while "Uitgaven" was blank —
    //     a receipts column with money leaving in it.
    // A cash administration whose columns disagree with its own balance is the kind of thing an
    // inspector asks about, and the owner would have had no answer.
    if (cash > 0) get(d).in += cash;
    else get(d).out += -cash;
    // (daily takings need no per-line description — it's the day's kassa-omzet)
  }
  for (const e of entries) {
    const d = isoDay(e.entry_date);
    if (!d || d < start || d > end) continue;
    const amt = Number(e.amount) || 0;
    if (amt === 0) continue;

    // ── [KAS-DUBBELTELLING] The same takings, from two sources ──
    //
    // A till shop's cash revenue reaches this function twice, and by design of the data model
    // rather than by mistake: once as daily_turnover.cash_amount (what the Z-report counted) and
    // once as a cash_entries row with direction 'in' and category 'omzet', which is what the Kas
    // page's default category makes the natural way to write down the counted drawer.
    //
    // Adding both put a shop taking EUR 500 a day roughly EUR 45.000 above reality by the end of a
    // quarter — in THIS sheet, the Kasboek the closing package hands to the accountant, which is
    // the cash administration the Belastingdienst reads. The same inflated eindsaldo also feeds the
    // drawer witness that /api/btw/file and readiness.ts use to refuse a filing on a negative
    // drawer, so a drawer that really dipped to -300 showed as +700 and the quarter filed with the
    // strongest naheffing signal masked.
    //
    // financial-result.ts has always known this and skips the entry when computing REVENUE. Only
    // the drawer summed both. Same rule here, and only for 'omzet': a cash purchase, a bank deposit
    // or a private withdrawal on that same day are separate movements and still count.
    if (isTillCountedOmzet(e, d, tellByTill)) continue;

    const day = get(d);
    if (e.direction === "in") day.in += amt;
    else day.out += amt;
    if (e.description && e.description.trim()) day.desc.push(e.description.trim());
  }

  const days = [...byDay.keys()].sort();
  let running = r2(openingBalance);
  const rows: KasRow[] = [];
  for (const d of days) {
    const day = byDay.get(d)!;
    const begin = running;
    const inn = r2(day.in);
    const out = r2(day.out);
    running = r2(begin + inn - out);
    rows.push({ date: d, beginsaldo: begin, ontvangsten: inn, uitgaven: out, descriptions: day.desc, eindsaldo: running });
  }

  // Group into month blocks (like the real file's monthly Kasboek sections).
  const months: KasMonth[] = [];
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    let m = months.find((x) => x.key === key);
    if (!m) {
      const mi = Number(key.slice(5, 7)) - 1;
      m = { key, label: `${MONTHS_NL[mi]} ${key.slice(0, 4)}`, rows: [], totalIn: 0, totalOut: 0 };
      months.push(m);
    }
    m.rows.push(row);
    m.totalIn = r2(m.totalIn + row.ontvangsten);
    m.totalOut = r2(m.totalOut + row.uitgaven);
  }

  const totalIn = r2(months.reduce((s, m) => s + m.totalIn, 0));
  const totalOut = r2(months.reduce((s, m) => s + m.totalOut, 0));

  return {
    year,
    quarter,
    openingBalance: r2(openingBalance),
    closingBalance: rows.length ? rows[rows.length - 1].eindsaldo : r2(openingBalance),
    months,
    totalIn,
    totalOut,
  };
}

/**
 * [KAS-NEGATIEF] The lowest point the drawer reaches over the whole quarter, or null when it never
 * goes below zero. A negative kassaldo is physically impossible (you cannot pay out cash you never
 * had) and is the single strongest red flag the Belastingdienst uses to reject a cash administration
 * (it implies hidden/verzwegen omzet). This is the pure witness the readiness gate blocks on.
 *
 * It scans EVERY day's eindsaldo (not just closingBalance): a drawer can dip negative mid-quarter and
 * recover to a positive close, and that dip is still the violation. It also seeds the worst point with
 * the OPENING balance so a negative carry-in with no in-quarter movements is caught too. Pure.
 */
export function lowestDrawerPoint(kb: Kasboek): { date: string; balance: number } | null {
  // The shared range, not a third hand-rolled quarter start (see quarterRange).
  let worst = { date: quarterRange(kb.year, kb.quarter).start, balance: kb.openingBalance };
  for (const m of kb.months) {
    for (const row of m.rows) {
      if (row.eindsaldo < worst.balance) worst = { date: row.date, balance: row.eindsaldo };
    }
  }
  return worst.balance < 0 ? worst : null;
}

/**
 * [KAS-SPOOR] A cash movement that was REMOVED from a quarter's cash book.
 *
 * Reconstructed from the audit trail, because it cannot come from anywhere else: a cash_entries
 * delete is a hard delete, so the row is gone and the trail is the only place it still exists.
 *
 * `date` is the day the MOVEMENT was on — not the day it was deleted. That is the field the cash
 * book is organised by, and the question this answers is "what did this quarter hold that is no
 * longer in it", which is a question about the quarter, not about when someone pressed a button.
 * `removedOn` carries that second date separately, because it is the other half of the answer.
 */
export interface RemovedKasEntry {
  date: string;                // ISO — the movement's own entry_date
  direction: "in" | "out";
  amount: number;
  category: string | null;
  description: string | null;
  removedOn: string | null;    // ISO day the deletion was recorded, when the trail knows it
}

/** Only removals whose MOVEMENT fell inside this quarter, oldest first. Pure. */
export function removedInQuarter(
  removed: readonly RemovedKasEntry[],
  year: number,
  quarter: Quarter,
): RemovedKasEntry[] {
  const { start, end } = quarterRange(year, quarter);
  return removed
    .filter((r) => {
      const d = isoDay(r.date);
      return !!d && d >= start && d <= end;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.removedOn ?? "").localeCompare(b.removedOn ?? ""));
}

/**
 * Lay the Kasboek out as a cell matrix in the store's own format (monthly blocks: a title row,
 * a header row, one row per active day — Datum · Beginsaldo · Uitgaven · Omschrijving ·
 * Ontvangsten · Eindsaldo — then a month totals row). Pure: matrix in → matrix out; the SheetJS
 * writer (xlsx-adapter.matrixToXlsxBytes) turns it into the .xlsx the accountant receives.
 *
 * [KAS-SPOOR] `removed` appends the movements that were taken OUT of this quarter, BELOW the
 * eindsaldo and never inside it. That placement is the whole point: these rows are not part of the
 * balance — they were removed, so the eindsaldo above is correct without them — but an accountant
 * reconciling a till against this sheet is entitled to know that lines were deleted from the period,
 * on which days and for how much. Omitted → the sheet is byte-for-byte what it was before.
 */
export function kasboekToMatrix(kb: Kasboek, removed?: readonly RemovedKasEntry[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  rows.push([`Kasboek — Q${kb.quarter} ${kb.year}`]);
  rows.push([`Beginsaldo kwartaal`, kb.openingBalance]);
  rows.push([]);
  for (const m of kb.months) {
    rows.push([m.label]);
    rows.push(["Datum", "Beginsaldo", "Uitgaven", "Omschrijving", "Ontvangsten", "Eindsaldo"]);
    for (const r of m.rows) {
      rows.push([
        nlDate(r.date),
        r.beginsaldo,
        r.uitgaven || "",
        r.descriptions.join(" ; "),
        r.ontvangsten || "",
        r.eindsaldo,
      ]);
    }
    rows.push(["Totaal", "", m.totalOut, "", m.totalIn, ""]);
    rows.push([]);
  }
  rows.push(["Eindsaldo kwartaal", kb.closingBalance]);

  // [KAS-SPOOR] Below the eindsaldo, and outside every total above it.
  const gone = removed ? removedInQuarter(removed, kb.year, kb.quarter as Quarter) : [];
  if (gone.length > 0) {
    rows.push([]);
    rows.push(["Verwijderd uit dit kwartaal"]);
    // Stated in the sheet itself, because a reader who finds these rows will otherwise wonder
    // whether the eindsaldo includes them. It does not.
    rows.push(["Deze kasboekingen zijn verwijderd en zitten NIET in de saldi hierboven."]);
    rows.push(["Datum", "Bedrag", "Soort", "Omschrijving", "Verwijderd op"]);
    for (const r of gone) {
      rows.push([
        nlDate(r.date),
        (r.direction === "in" ? 1 : -1) * r2(Math.abs(Number(r.amount) || 0)),
        r.category ?? "",
        r.description ?? "",
        r.removedOn ? nlDate(r.removedOn) : "",
      ]);
    }
  }
  return rows;
}
