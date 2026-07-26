// [QUARTER-CLOSE] Pure helpers for the end-of-quarter handoff cron. The cron fires once, early in
// the first month of a new quarter, and turns a fact the system already knows (a quarter has ended,
// and how complete its evidence is) into an ACTION: it notifies the owner and any linked accountant.
// Kept pure + separate so the date math and the (honesty-critical) notification copy are unit-tested.
import type { QuarterNo } from "./quarter";

/**
 * The quarter that just ended, relative to `now`. The cron fires early in the first month of a new
 * quarter, so the just-closed quarter is the one BEFORE the current. Q1 → Q4 of the prior year.
 */
export function previousQuarter(now: Date): { year: number; quarter: QuarterNo } {
  const month = now.getUTCMonth(); // 0..11
  const currentQuarter = Math.floor(month / 3) + 1; // 1..4
  if (currentQuarter === 1) return { year: now.getUTCFullYear() - 1, quarter: 4 };
  return { year: now.getUTCFullYear(), quarter: (currentQuarter - 1) as QuarterNo };
}

export interface QuarterCloseSummaryLike {
  warnings: { message: string }[];
  outgoingCount: number;
  incomingCount: number;
}

export interface QuarterCloseNotice {
  empty: boolean; // no invoice activity + no warnings → skip notifying (don't nag a dormant quarter)
  clean: boolean; // activity present and zero warnings
  gapCount: number;
  ownerTitle: string;
  ownerBody: string;
  accountantTitle: string;
  accountantBody: string;
}

/**
 * Build the owner + accountant notification copy from a closing-package summary. Honest by
 * construction: it NEVER claims the quarter is guaranteed "klaar om in te dienen" — it states what
 * was actually checked (invoice evidence) and the concrete remaining gaps, so the owner reviews
 * rather than trusts a green light blindly. The full reconciliation verdict stays on the readiness
 * screen; this is a nudge to go there, not a replacement for it.
 */
export function buildQuarterCloseNotice(
  quarterLabel: string,
  summary: QuarterCloseSummaryLike,
): QuarterCloseNotice {
  const gapCount = summary.warnings.length;
  const activity = summary.outgoingCount + summary.incomingCount;
  // A quarter with zero invoice activity is dormant → skip it. summarizeClosingPackage STILL emits
  // "no_invoices"/"no_bank_statement" warnings for an empty quarter, so we must NOT also require
  // gapCount===0 here — that made this guard dead code and nagged every inactive account (and its
  // accountant) four times a year. Those warnings are emptiness signals, not real gaps to fix.
  const empty = activity === 0;
  const clean = !empty && gapCount === 0;

  // [BELOFTE §4.3] "staat klaar", nooit "is gedaan".
  //
  // Hier stond "{quarterLabel} is afgesloten" en verderop "Je klant heeft {quarterLabel}
  // afgesloten". Allebei onwaar: deze cron vuurt op de 5e en de klant heeft niets gedaan —
  // wij hebben zijn stukken bij elkaar gezet. AV §4.3 legt vast dat een uitkomst van het
  // systeem een suggestie is die de mens bevestigt, en belofte.ts stelt de regel expliciet:
  // overal `staat klaar`, nooit `is gedaan`. Een melding die zegt dat het kwartaal áf is,
  // is precies de zin waarop wij worden aangesproken als er iets ontbrak.
  const ownerTitle = `${quarterLabel} staat klaar`;
  const ownerBody = clean
    ? `Je facturen voor ${quarterLabel} zijn gecontroleerd (${summary.outgoingCount} verkoop, ${summary.incomingCount} inkoop). Controleer je cijfers op het kwartaaloverzicht en dien je BTW-aangifte in.`
    : `${quarterLabel} heeft nog ${gapCount} aandachtspunt(en) voordat je kunt indienen: ${summary.warnings
        .map((w) => w.message)
        .slice(0, 3)
        .join(" · ")}${gapCount > 3 ? " …" : ""}`;

  const accountantTitle = clean
    ? `${quarterLabel} staat klaar voor je`
    : `${quarterLabel} staat klaar — met ${gapCount} aandachtspunt(en)`;
  // "zijn gecontroleerd" mag blijven staan: dat gaat over de verstuurd/ontvangen/betaald-set
  // die AV §7.2 zelf omschrijft als "alles wat je zelf hebt gecontroleerd". Wat wég moest is
  // de bewering dat de KLANT het kwartaal heeft afgesloten.
  const accountantBody = clean
    ? `De facturen van je klant voor ${quarterLabel} zijn gecontroleerd (${summary.outgoingCount} verkoop, ${summary.incomingCount} inkoop). Het kwartaalpakket staat klaar om te downloaden.`
    : `${quarterLabel} van je klant staat klaar, met nog ${gapCount} aandachtspunt(en). Bekijk het kwartaal om te zien wat er mist.`;

  return { empty, clean, gapCount, ownerTitle, ownerBody, accountantTitle, accountantBody };
}
