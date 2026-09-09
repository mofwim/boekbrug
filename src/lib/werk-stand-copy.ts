// src/lib/werk-stand-copy.ts
// [WERK-STAND] The sentences for the work layer's money position — on Vandaag and on the Werk
// screen, from one module, so the two can never disagree about what a signal is called.
// Pure; the words come from the catalogue through `t`, the amounts through formatEuroNL.

import { formatEuroNL } from "./format-nl";
import type { WorkCounts, WorkSignal } from "./werk";

type Tr = (k: string, v?: Record<string, string | number>) => string;

/** [WERK] One sentence in the trade's own word: what is ready to invoice, what is in hand, what waits. */
export function werkZin(werk: { pluralKey: string; counts: WorkCounts } | null | undefined, t: Tr): string | null {
  if (!werk) return null;
  const c = werk.counts;
  const plural = t(werk.pluralKey);
  if (c.open + c.bezig + c.wacht + c.klaar === 0) return t("vandaag.werk.niets", { plural });
  // The amount beside the count: "3 klaar voor de factuur · € 2.840" tells the owner what to do
  // NOW, where a month's turnover only tells him what happened.
  if (c.klaar > 0 && c.klaarExBtw > 0) {
    return `${plural}: ${t("vandaag.werk.zinBedrag", { klaar: c.klaar, bedrag: formatEuroNL(c.klaarExBtw), bezig: c.bezig + c.open, wacht: c.wacht })}`;
  }
  return `${plural}: ${t("vandaag.werk.zin", { klaar: c.klaar, bezig: c.bezig + c.open, wacht: c.wacht })}`;
}

/**
 * [WERK-4] One sentence per signal, and where to tap. Money between the work and the invoice:
 * meerwerk not invoiced, hours without a rate, a known supplier's bon on no work, work over its
 * begroting. Pure; the page counted, this only says.
 */
export function werkSignaalZin(s: WorkSignal, t: Tr): { text: string; href: string } {
  switch (s.kind) {
    case "meerwerk_open": return { text: t("vandaag.werk.sig.meerwerk", { n: s.n, bedrag: formatEuroNL(s.amount) }), href: "/dashboard/werk" };
    case "hours_without_rate": return { text: t("vandaag.werk.sig.urenZonderTarief", { n: s.n }), href: "/dashboard/werk" };
    case "costs_unlinked": return { text: t("vandaag.werk.sig.kosten", { n: s.n, bedrag: formatEuroNL(s.amount) }), href: "/dashboard/incoming/manage" };
    case "over_budget": return { text: t("vandaag.werk.sig.begroting", { n: s.n }), href: "/dashboard/werk" };
    case "contract_ending": return { text: t("vandaag.werk.sig.contractEinde", { n: s.n }), href: "/dashboard/werk" };
    case "bundle_over": return { text: t("vandaag.werk.sig.strippenkaartOp", { n: s.n, uren: s.hours.toLocaleString("nl-NL") }), href: "/dashboard/werk" };
    // [UREN-OUD] The one that leads to the hours screen: the money is in the registration, not in the work.
    case "hours_unbilled_old": return { text: t("vandaag.werk.sig.urenOud", { n: s.n, bedrag: formatEuroNL(s.amount), dagen: s.days }), href: "/dashboard/uren" };
  }
}
