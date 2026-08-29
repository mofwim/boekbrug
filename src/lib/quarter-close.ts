// [QUARTER-CLOSE] Pure helpers for the end-of-quarter handoff cron. The cron fires once, early in
// the first month of a new quarter, and turns a fact the system already knows (a quarter has ended,
// and how complete its evidence is) into an ACTION: it notifies the owner and any linked accountant.
// Kept pure + separate so the date math and the (honesty-critical) notification copy are unit-tested.
import type { QuarterNo } from "./quarter";
import { formatEuroNL as eur } from "./format-nl";

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
  /**
   * [COM-IN-DE-REGEL] The acquirer commission this quarter's own bank lines stated, if any.
   *
   * Optional, so a caller predating this still builds the same notice it always did.
   */
  cardStatedCommission?: {
    total: number;
    gross: number;
    lines: number;
    unverified: number;
    booked: boolean;
  } | null;
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
  // [COM-IN-DE-REGEL] Card payouts that stated a commission are ACTIVITY, and counting only
  // invoices missed that. A shop whose quarter is 91 till days and no invoices at all — the shape
  // of a market or a snackbar — scored activity 0, was classed dormant, and was skipped along with
  // its accountant, while the app had found and booked a real cost in that same quarter. "Dormant"
  // has to mean nothing happened, not "nothing was invoiced".
  const stated = summary.cardStatedCommission ?? null;
  const statedFound = (stated?.lines ?? 0) > 0 && (stated?.total ?? 0) > 0;
  const activity = summary.outgoingCount + summary.incomingCount + (statedFound ? 1 : 0);
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
    // [ONE-FILING-DOOR] "…en dien je BTW-aangifte in" stond hier terwijl de melding naar het
    // kwartaaloverzicht linkt — en indienen gebeurt sinds de samenvoeging alleen nog op Waarheid.
    // De link blijft waar hij is (het eerste werkwoord is "controleer", en de cijfers, de export en
    // het sluitpakket staan daar); alleen de zin wijst nu naar het scherm dat de handeling
    // werkelijk heeft, in plaats van hem te beloven op de pagina waar je landt.
    ? `Je facturen voor ${quarterLabel} zijn gecontroleerd (${summary.outgoingCount} verkoop, ${summary.incomingCount} inkoop). Controleer je cijfers op het kwartaaloverzicht en markeer het kwartaal daarna als ingediend op Waarheid.`
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
  // [GAP-NAMES] The owner's mail has always named the gaps; the accountant's printed only the
  // COUNT. So a client with four missing PDFs and one unplaced bank line produced a byte-identical
  // mail to a client with five missing PDFs — the recipient who can actually act on the difference
  // got the one version that hid it, and "5 aandachtspunten" is a digit, not a signal. Same three
  // messages, same order (the array is sorted so the most consequential leads), same truncation.
  const accountantBody = clean
    ? `De facturen van je klant voor ${quarterLabel} zijn gecontroleerd (${summary.outgoingCount} verkoop, ${summary.incomingCount} inkoop). Het kwartaalpakket staat klaar om te downloaden.`
    : `${quarterLabel} van je klant staat klaar, met nog ${gapCount} aandachtspunt(en): ${summary.warnings
        .map((w) => w.message)
        .slice(0, 3)
        .join(" · ")}${gapCount > 3 ? " …" : ""}`;

  // [COM-IN-DE-REGEL] One sentence, appended — never replacing the gap list, which is what the
  // reader has to act on. Deliberately says what the amount IS: a cost that was in the statement
  // and not in the books, so the profit was overstated by it. Calling it "gevonden geld" would be
  // the one framing MARKTPOSITIE_2026.md §5 warns against, and it would be a lie about direction.
  //
  // A finding that was NOT booked says so instead of staying silent — the owner is reading this
  // precisely because they will not open the app to discover the difference themselves.
  const statedSentence = !statedFound || !stated
    ? ""
    : stated.booked
      ? ` Je bank noemde zelf ${eur(stated.total)} aan kosten van de betaalautomaat op ${stated.lines} afrekening(en); die staan als kosten in je cijfers — je winst was tot nu toe met dat bedrag te hoog.`
      : ` Je bank noemde zelf ${eur(stated.total)} aan kosten van de betaalautomaat op ${stated.lines} afrekening(en). Die staan nog NIET in je cijfers, omdat er ook een terminal-afrekening voor dit kwartaal is — controleer dat op Waarheid voordat je indient.`;
  const statedSentenceAccountant = !statedFound || !stated
    ? ""
    : stated.booked
      ? ` De bank noemt zelf ${eur(stated.total)} acquirer-commissie op ${stated.lines} afrekening(en) (over ${eur(stated.gross)} bruto); die is als betaalkosten geboekt — zie kaart-reconciliatie.csv.`
      : ` De bank noemt zelf ${eur(stated.total)} acquirer-commissie op ${stated.lines} afrekening(en); die is NIET geboekt omdat er ook een terminal-afrekening is — zie kaart-reconciliatie.csv.`;

  return {
    empty, clean, gapCount, ownerTitle,
    ownerBody: ownerBody + statedSentence,
    accountantTitle,
    accountantBody: accountantBody + statedSentenceAccountant,
  };
}
