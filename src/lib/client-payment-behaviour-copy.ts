// src/lib/client-payment-behaviour-copy.ts
// [BETAALGEDRAG] The words for the payment-pace figure. Pure, no I/O, no React.
// Run: npx tsx --test src/lib/client-payment-behaviour-copy.test.ts
//
// client-payment-behaviour.ts decides WHAT is true and returns codes. This decides which sentence
// each code gets, in the owner's language. Same split, same reason, as btw-reservation-copy.ts.
//
// [TAAL] The panel that renders this holds no language of its own — it receives this object and
// prints it. Note that `dir` travels with the words on the same object: a sentence about a debtor
// is one of the places a stray physical `right` would go wrong in exactly one language.
//
// ── ONE COPY RULE THAT IS NOT COSMETIC ───────────────────────────────────────────────────
//
// Early and late get DIFFERENT sentences, never one template with a signed number. "Betaalt
// gemiddeld −23 dagen na de vervaldatum" is arithmetic printed at a human, and the reader has to
// work out that a minus sign is good news about their own customer. The rule module keeps the
// sign because the sign is the fact; this module is where it becomes a sentence.

import { formatEuroNL } from "./format-nl";
import { translator } from "./i18n/t";
import type { MessageKey } from "./i18n/messages";
import { localeDir, type Locale } from "./i18n/locale";
import type { BehaviourAbsence, PaymentBehaviour } from "./client-payment-behaviour";

/**
 * Which message key each absence code renders as.
 *
 * Typed as MessageKey on both sides: an absence code with no sentence fails to build, and so does
 * a sentence key that is not in the catalogue.
 */
const ABSENCE_KEY: Record<BehaviourAbsence, MessageKey> = {
  no_invoices: "betaalgedrag.absent.geenFacturen",
  none_paid: "betaalgedrag.absent.nogNietsBetaald",
  no_payment_dates: "betaalgedrag.absent.geenBetaaldata",
  too_few: "betaalgedrag.absent.teWeinig",
};

export interface PaymentBehaviourPanel {
  heading: string;
  /**
   * The headline sentence: how this customer pays, or why that cannot be said.
   *
   * Always present. There is no state in which this panel renders an empty line — an absence is
   * itself a sentence here, because "we do not know yet" is genuinely useful next to a customer
   * the owner is about to invoice again.
   */
  pace: string;
  /** How many invoices the pace rests on. Null when there is no pace. */
  basis: string | null;
  /** Money standing open past its due date right now, or null when none is. */
  overdue: string | null;
  /**
   * Paid invoices that could not be measured. Empty when every paid invoice counted.
   *
   * Never folded into `basis`. A verdict resting on 4 of 30 invoices must not be able to look like
   * one resting on 30, and the only way to guarantee that is to print the gap separately.
   */
  caveats: string[];
  dir: "ltr" | "rtl";
}

export function paymentBehaviourPanel(
  b: PaymentBehaviour,
  locale?: Locale | string | null,
): PaymentBehaviourPanel {
  const t = translator(locale);
  const dir = localeDir(locale);

  let pace: string;
  let basis: string | null = null;

  if (b.pace) {
    const { medianDaysAfterInvoice, medianDaysBeyondTerm, sample, late, slowestDaysBeyondTerm } = b.pace;
    // Three sentences, not one signed template — see the header.
    pace =
      medianDaysBeyondTerm > 0
        ? t("betaalgedrag.traag", { dagen: medianDaysAfterInvoice, over: medianDaysBeyondTerm })
        : medianDaysBeyondTerm < 0
          ? t("betaalgedrag.vroeg", { dagen: medianDaysAfterInvoice, voor: -medianDaysBeyondTerm })
          : t("betaalgedrag.opTijd", { dagen: medianDaysAfterInvoice });
    basis =
      late === 0
        ? t("betaalgedrag.basisAllemaal", { aantal: sample })
        : t("betaalgedrag.basis", { aantal: sample, telaat: late, traagste: slowestDaysBeyondTerm });
  } else {
    pace = t(ABSENCE_KEY[b.absence as BehaviourAbsence]);
  }

  // One is one, everything else is a plural. This app has no plural engine by design (t.ts), and
  // "1 facturen" is wrong in Dutch before it is wrong in Arabic — so the singular gets its own
  // sentence. Arabic's dual and its 3–10 form are not modelled; that is a known, stated limit,
  // and it is still strictly better than a count glued onto a plural noun.
  const overdue = b.overdue
    ? t(b.overdue.count === 1 ? "betaalgedrag.openstaandEen" : "betaalgedrag.openstaand", {
        aantal: b.overdue.count,
        bedrag: formatEuroNL(b.overdue.amount),
        dagen: b.overdue.oldestDaysLate,
      })
    : null;

  const { missingDate, impossible } = b.unmeasured;
  const caveats: string[] = [];
  if (missingDate === 1) caveats.push(t("betaalgedrag.caveat.zonderDatumEen"));
  else if (missingDate > 1) caveats.push(t("betaalgedrag.caveat.zonderDatum", { zonder: missingDate }));
  if (impossible === 1) caveats.push(t("betaalgedrag.caveat.onmogelijkEen"));
  else if (impossible > 1) caveats.push(t("betaalgedrag.caveat.onmogelijk", { onmogelijk: impossible }));

  return { heading: t("betaalgedrag.kop"), pace, basis, overdue, caveats, dir };
}
