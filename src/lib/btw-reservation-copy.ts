// src/lib/btw-reservation-copy.ts
// [BTW-RESERVERING] The words for the reservation figure. Pure, no I/O, no React.
// Run: npx tsx --test src/lib/btw-reservation-copy.test.ts
//
// The rule (btw-reservation.ts) decides WHAT is true and returns note CODES. This decides which
// sentence each code gets, in the owner's language. Keeping them apart is not tidiness: the rule
// is imported by an API route that renders nothing, and a Dutch sentence at that depth is a
// sentence no translation can ever reach.
//
// [TAAL] The panel that renders this holds no language of its own — it receives this object and
// prints it. One hard-coded string left in the component is how a translation stays permanently
// half-finished, because the screen still looks right in Dutch and nothing points at the gap.

import { formatEuroNL } from "./format-nl";
import { translator } from "./i18n/t";
import type { MessageKey } from "./i18n/messages";
import { localeDir, type Locale } from "./i18n/locale";
import { quarterLabelOf } from "./quarter";
import type { BtwReservation, ReservationNote } from "./btw-reservation";

/**
 * Which message key each note code renders as.
 *
 * Typed as MessageKey on both sides, which does two jobs at compile time: a note code with no
 * sentence fails to build (the Record must be complete), and a sentence key that is not in the
 * catalogue fails too. The gate in lifecycle-gates.test.ts covers the third case — a key that
 * exists here and is never rendered.
 */
const NOTE_KEY: Record<ReservationNote, MessageKey> = {
  "balance-unknown": "btwres.note.balanceUnknown",
  "balance-incomplete": "btwres.note.balanceIncomplete",
  "balance-stale": "btwres.note.balanceStale",
  "quarter-running": "btwres.note.quarterRunning",
  "purchases-unverified": "btwres.note.purchasesUnverified",
  "refund-separate": "btwres.note.refundSeparate",
  "return-overdue": "btwres.note.returnOverdue",
};

export interface BtwReservationPanel {
  heading: string;
  /** Label + amount for what is already the tax office's. */
  reserved: { label: string; amount: string };
  /**
   * What is left, or null when the balance is unknown.
   *
   * Null rather than a "€ 0,00" or a dash: the panel must be able to render the absence as an
   * absence. A euro figure in this slot is a claim, and the one thing this feature may not do is
   * make a claim it cannot support.
   */
  free: { label: string; amount: string; short: boolean } | null;
  /** The nearest deadline, phrased by how close it is. Null when nothing is owed. */
  deadline: string | null;
  /** Expected refunds, stated apart. Null when there are none. */
  refundExpected: string | null;
  /** Everything this figure does not know, one sentence per note. */
  caveats: string[];
  /** Label for the link to the aangifte screen. */
  action: string;
  /** Travels with the words so a component cannot render text and direction out of step. */
  dir: "ltr" | "rtl";
}

/** What the panel needs beyond the rule's own answer. */
export interface PanelExtras {
  /** bankBalanceOf's `asOf`, for the stale-balance sentence. */
  balanceAsOf?: string | null;
  /** Quarters whose figure could not be computed at all — named, never silently dropped. */
  uncomputed?: readonly string[];
  /** The oldest quarter the route looked at, so the panel can say what the figure covers. */
  oldestConsidered?: string | null;
}

/**
 * How the nearest deadline is phrased.
 *
 * Four cases rather than one "{n} days" template, because the interesting ones are the edges: 0
 * days is "today" (a countdown reading "nog 0 days" is a sentence nobody writes), and a negative
 * count must never be printed as "nog −3 days" on a screen about the tax office.
 */
function deadlineSentence(
  t: ReturnType<typeof translator>,
  quarter: string,
  date: string,
  days: number,
): string {
  const label = quarterLabelOf(quarter);
  if (days < 0) return t("btwres.deadlinePassed", { quarter: label });
  if (days === 0) return t("btwres.deadlineToday", { quarter: label });
  // Beyond a month away, a day count stops meaning anything — the date itself is more use.
  if (days > 31) return t("btwres.deadline", { quarter: label, date: dateNL(date) });
  return t("btwres.deadlineDays", { quarter: label, days });
}

/** "2026-04-30" → "30-04-2026". The app's own date shape; no locale month names to translate. */
function dateNL(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/**
 * The panel, or null when there is nothing to say.
 *
 * Null when nothing is owed AND nothing is expected back: an owner with no BTW position does not
 * need a tile explaining that they have none. A shortfall, a debt, a refund or an unknown balance
 * with a known debt all produce a panel.
 */
export function btwReservationPanel(
  r: BtwReservation,
  extras: PanelExtras = {},
  locale?: Locale | string | null,
): BtwReservationPanel | null {
  if (r.reserved <= 0 && r.refundExpected <= 0) return null;

  const t = translator(locale);

  const caveats = r.notes.map((code) =>
    code === "balance-stale"
      ? t(NOTE_KEY[code], { date: dateNL(extras.balanceAsOf ?? "") })
      : t(NOTE_KEY[code]),
  );

  // A quarter that could not be computed is NAMED. Leaving it out silently would present a total
  // that is knowingly missing a piece as if it were complete — the one failure this whole module
  // is written against.
  const missing = (extras.uncomputed ?? []).filter(Boolean);
  if (missing.length > 0) {
    caveats.push(
      t("btwres.note.uncomputed", { quarters: missing.map(quarterLabelOf).join(", ") }),
    );
  }
  if (extras.oldestConsidered) {
    caveats.push(t("btwres.period", { quarter: quarterLabelOf(extras.oldestConsidered) }));
  }

  const short = r.free != null && r.free < 0;

  return {
    heading: t("btwres.heading"),
    reserved: {
      label: t("btwres.reserved"),
      amount: formatEuroNL(r.reserved),
    },
    free:
      r.free == null
        ? null
        : {
            label: short ? t("btwres.short") : t("btwres.free"),
            // The magnitude: the label already says which of the two it is, and "−€ 600" beside
            // the word "short" states the same minus twice.
            amount: formatEuroNL(Math.abs(r.free)),
            short,
          },
    deadline: r.nextDue
      ? deadlineSentence(t, r.nextDue.key, r.nextDue.deadline, r.nextDue.days)
      : null,
    refundExpected:
      r.refundExpected > 0
        ? t("btwres.refundExpected", { amount: formatEuroNL(r.refundExpected).replace(/^€\s*/, "") })
        : null,
    caveats,
    action: t("btwres.toReturn"),
    dir: localeDir(locale),
  };
}
