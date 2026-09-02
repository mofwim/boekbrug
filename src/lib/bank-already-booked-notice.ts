// src/lib/bank-already-booked-notice.ts
// [DUBBEL-GEDEKT] What the categorisatie screen says about a line it will not fill in. Pure, no I/O.
// Run: npx tsx --test src/lib/bank-already-booked-notice.test.ts
//
// The guard in bank-double-booking.ts stops three machine writers from coding a bank line whose
// money a paid invoice already carries. That closes the automatic double booking and opens a
// quieter one: the line then sits on the categorisatie screen looking exactly like a line nobody
// could classify, with a 'kosten' chip pre-selected and a confirm button under it. The owner taps
// it, and books the same cost a second time by hand — with the app's own suggestion telling them
// it was right.
//
// So the hold has to be legible. This module owns the words; the screen renders what it is handed
// and holds no language of its own (AGENTS.md).
//
// NOTE ON LANGUAGE: identifiers and comments are English; the strings come from the catalogue in
// Dutch, because that is what the entrepreneur reads.

import type { DoubleBookingHold } from "./bank-double-booking";
import type { MessageKey } from "./i18n/messages";
import { translator } from "./i18n/t";
import { localeDir, type Locale } from "./i18n/locale";

/**
 * One reason, one pair of sentences.
 *
 * A Record over the union rather than a switch with a default: a third hold reason added to
 * DoubleBookingHold stops compiling here until it has words. The alternative — a default branch —
 * would ship the new reason with the old reason's sentence, which is worse than silence: it would
 * tell the owner a paid invoice explains a line that no invoice explains.
 *
 * Two sentences per reason, each its own key: a noun inside a sentence is not a parameter, and
 * these two cases genuinely say different things — one is about a single invoice, the other about
 * a whole payout.
 */
const COPY: Record<DoubleBookingHold, { title: MessageKey; body: MessageKey }> = {
  "paid-invoice": { title: "cat.alGeboekt.factuur", body: "cat.alGeboekt.factuurUitleg" },
  "mollie-payout": { title: "cat.alGeboekt.mollie", body: "cat.alGeboekt.mollieUitleg" },
};

export interface AlreadyBookedNotice {
  title: string;
  body: string;
  /**
   * Text direction for the panel, carried on the notice itself so that ONE object fully describes
   * what is on the screen — the same rule invoice-sent-notice.ts follows.
   */
  dir: "ltr" | "rtl";
}

/**
 * The explanation, or null when there is nothing to explain.
 *
 * An UNRECOGNISED reason also returns null, and that is not a silent failure: the screen's other
 * half — nothing pre-selected, the confirm button inert until the owner chooses — keys off the
 * presence of a reason, not its spelling. So a client running against a newer server loses the
 * sentence and keeps the safety. Inventing a sentence for a reason we do not know would lose both.
 */
export function alreadyBookedNotice(
  reason: string | null | undefined,
  locale?: Locale | string | null,
): AlreadyBookedNotice | null {
  if (!reason) return null;
  const copy = COPY[reason as DoubleBookingHold];
  if (!copy) return null;
  const t = translator(locale);
  return { title: t(copy.title), body: t(copy.body), dir: localeDir(locale) };
}
