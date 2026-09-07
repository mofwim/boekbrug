// src/lib/cashflow-forecast-copy.ts
// [VOORUIT] The words for the cash-flow forecast. Pure, no I/O, no React.
// Run: npx tsx --test src/lib/cashflow-forecast-copy.test.ts
//
// cashflow-forecast.ts decides WHAT is true and returns figures and note CODES. This decides which
// sentence each one gets, in the owner's language, and is the only place a number becomes a
// sentence. Kept apart for the same reason as btw-reservation-copy.ts: the engine is imported by
// an API route that renders nothing, and a Dutch sentence at that depth is a sentence no
// translation can ever reach.
//
// [TAAL] The panel that renders this holds no language of its own — it receives this object and
// prints it, and `dir` travels on the same object so the words and their direction cannot be
// rendered out of step.

import { formatDateNL, formatEuroNL } from "./format-nl";
import { translator } from "./i18n/t";
import type { MessageKey } from "./i18n/messages";
import { localeDir, type Locale } from "./i18n/locale";
import type { CashflowForecast, ForecastNote, HorizonForecast } from "./cashflow-forecast";

/**
 * Which message key each note code renders as. Typed on both sides: a code with no sentence and
 * a sentence key not in the catalogue both fail to build. The two counted notes have a singular
 * and a plural sentence each, because "1 inkoopfacturen" is not Dutch and a count inside a
 * sentence is not a parameter in Arabic either (AGENTS.md).
 */
const NOTE_KEY: Record<ForecastNote["code"], MessageKey> = {
  "bank-unknown": "vooruit.note.bankOnbekend",
  "bank-partial": "vooruit.note.bankDeels",
  "bank-stale": "vooruit.note.bankOud",
  "bank-accounts": "vooruit.note.bankRekeningen",
  "kas-unknown": "vooruit.note.kasOnbekend",
  "payables-undated": "vooruit.note.zonderDatum",
  "receivables-late": "vooruit.note.teLaat",
  "takings-unknown": "vooruit.note.kassaOnbekend",
  "takings-thin": "vooruit.note.kassaDun",
};

/** One labelled amount on the panel. */
export interface AmountLine {
  label: string;
  amount: string;
}

export interface HorizonCopy {
  days: number;
  /** The toggle label: "7 dagen". */
  label: string;
  /**
   * Bank + drawer now, or null when the bank balance is unknown. Null rather than "€ 0,00": the
   * panel must be able to render the absence as an absence. A euro figure here is a claim.
   */
  start: AmountLine | null;
  /** The balance on the last day of the horizon. Null with start. `short` when it is below zero. */
  end: (AmountLine & { short: boolean }) | null;
  /** The movements: what leaves, what comes in from invoices, what the till brings. */
  movements: AmountLine[];
  /** "waarvan € 300 via incasso", or null when nothing is collected by mandate. */
  incasso: string | null;
  /** The lowest point inside the horizon, when it is below the end balance. */
  lowest: string | null;
  /** Everything this figure does not know, one sentence per note. */
  caveats: string[];
}

export interface CashflowPanelCopy {
  heading: string;
  horizons: HorizonCopy[];
  /** Label for the link to the pay screen. */
  action: string;
  dir: "ltr" | "rtl";
}

/** "€ 1.234,56" without the euro sign, for sentences that already carry one. */
function bare(n: number): string {
  return formatEuroNL(n).replace(/^€\s*/, "");
}

function noteSentence(t: ReturnType<typeof translator>, n: ForecastNote): string {
  switch (n.code) {
    case "bank-stale":
      return t(NOTE_KEY[n.code], { date: formatDateNL(n.asOf) });
    case "bank-accounts":
      return t(NOTE_KEY[n.code], { count: n.count });
    case "payables-undated":
      return n.count === 1
        ? t("vooruit.note.zonderDatumEen", { amount: bare(n.amount) })
        : t(NOTE_KEY[n.code], { count: n.count, amount: bare(n.amount) });
    case "receivables-late":
      return n.count === 1
        ? t("vooruit.note.teLaatEen", { amount: bare(n.amount) })
        : t(NOTE_KEY[n.code], { count: n.count, amount: bare(n.amount) });
    case "takings-thin":
      return t(NOTE_KEY[n.code], { days: n.days });
    default:
      return t(NOTE_KEY[n.code]);
  }
}

/** Is there anything at all to say about this horizon? */
function hasContent(h: HorizonForecast): boolean {
  return h.start !== null || h.out !== 0 || h.inInvoices !== 0 || h.inTakings !== 0;
}

/**
 * The panel, or null when there is nothing to say.
 *
 * Null when no horizon has a balance, a payment, an expected receipt or takings: an owner with no
 * bank statement, no open invoices and no till does not need a tile explaining that.
 */
export function cashflowPanel(
  f: CashflowForecast,
  locale?: Locale | string | null,
): CashflowPanelCopy | null {
  if (!f.horizons.some(hasContent)) return null;
  const t = translator(locale);

  const horizons: HorizonCopy[] = f.horizons.map((h) => {
    const movements: AmountLine[] = [];
    if (h.outCount > 0) movements.push({ label: t("vooruit.uit", { count: h.outCount }), amount: formatEuroNL(-h.out) });
    if (h.inCount > 0) movements.push({ label: t("vooruit.inFacturen", { count: h.inCount }), amount: formatEuroNL(h.inInvoices) });
    if (h.inTakings > 0) movements.push({ label: t("vooruit.inKassa"), amount: formatEuroNL(h.inTakings) });

    const short = h.end !== null && h.end < 0;
    // The lowest point only earns a sentence when it is LOWER than where the horizon ends — when
    // the end is the lowest point, the end figure already says it.
    const lowest =
      h.lowest && h.end !== null && h.lowest.balance < h.end - 0.005
        ? t(h.lowest.balance < 0 ? "vooruit.laagsteTekort" : "vooruit.laagste", {
            amount: bare(Math.abs(h.lowest.balance)),
            date: formatDateNL(h.lowest.date),
          })
        : null;

    return {
      days: h.days,
      label: t("vooruit.dagen", { days: h.days }),
      start: h.start === null ? null : { label: t("vooruit.nu"), amount: formatEuroNL(h.start) },
      end:
        h.end === null
          ? null
          : {
              label: short ? t("vooruit.tekortOp", { date: formatDateNL(h.endDate) }) : t("vooruit.op", { date: formatDateNL(h.endDate) }),
              // The magnitude: the label already says "tekort", and "−€ 600" beside it states
              // the same minus twice.
              amount: formatEuroNL(Math.abs(h.end)),
              short,
            },
      movements,
      incasso: h.outIncasso > 0 ? t("vooruit.uitIncasso", { amount: bare(h.outIncasso) }) : null,
      lowest,
      caveats: h.notes.map((n) => noteSentence(t, n)),
    };
  });

  return {
    heading: t("vooruit.titel"),
    horizons,
    action: t("vooruit.naarBetalen"),
    dir: localeDir(locale),
  };
}
