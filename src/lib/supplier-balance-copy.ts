// src/lib/supplier-balance-copy.ts
// [LEVERANCIER-SALDO] The words for the creditors screen. Pure, no I/O, no React.
// Run: npx tsx --test src/lib/supplier-balance-copy.test.ts
//
// supplier-balances.ts and payment-corroboration.ts decide WHAT is true and return figures and
// codes. This decides which sentence each one gets, in the owner's language, and it is the only
// place a number becomes a sentence.
//
// [TAAL] The panel that renders this holds no language of its own — it receives this object and
// prints it, and `dir` travels on the same object so the words and their direction cannot be
// rendered out of step.
//
// ── TWO COPY RULES THAT ARE NOT COSMETIC ──
//
// A number the owner can act on always carries its BASIS. "€ 2.383,65 openstaand" is a fact about
// a date, and the same figure with the wrong date above it is a wrong number. So the peildatum
// line is never optional, and when the figure is today's while an older date was asked for, the
// panel says that in its own sentence rather than in a footnote.
//
// And an uncheckable payment is never phrased as a suspicion. "We konden dit nog niet nakijken,
// je afschrift loopt tot 21 augustus" is a statement about OUR data; "deze betaling klopt
// misschien niet" is an accusation about the owner's memory, on evidence we do not have.

import { formatEuroNL } from "./format-nl";
import { translator } from "./i18n/t";
import { localeDir, type Locale } from "./i18n/locale";
import type { CorroborationResult, UncheckableReason } from "./payment-corroboration";
import type { SupplierBalanceResult } from "./supplier-balances";

/** ISO "YYYY-MM-DD" → Dutch "31-12-2026". Returns the input when it is not a date. */
function nlDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso ?? "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

export interface SupplierLine {
  key: string;
  name: string;
  /** The amount, formatted. Signed: a supplier in credit shows a minus, as its own row does. */
  bedrag: string;
  /** "3 facturen" — count only, never folded into the amount line. */
  aantal: string;
  /** "waarvan € 1.165,73 vervallen", or null when nothing is past due. */
  vervallen: string | null;
  /** "oudste vervaldatum 29-08-2026", or null when no invoice states one. */
  oudste: string | null;
  /** Bills of this supplier still in the queue, as a sentence, or null. */
  onbevestigd: string | null;
}

export interface AgingLine {
  label: string;
  bedrag: string;
  /** True for the buckets that are actually overdue — the screen may emphasise those. */
  vervallen: boolean;
}

export interface SupplierBalancePanel {
  heading: string;
  /** "Stand op 30-08-2026". Always present: an amount without its date is not a fact. */
  peildatum: string;
  /** Present only when the figure is today's while an earlier date was asked for. */
  basisWaarschuwing: string | null;
  totaalLabel: string;
  totaal: string;
  /** Empty when nothing is open — `leeg` then carries the sentence. */
  leveranciers: SupplierLine[];
  /** The one sentence shown instead of an empty list. Null when there is a list. */
  leeg: string | null;
  ouderdomKop: string;
  ouderdom: AgingLine[];
  /** Unverified bills across all suppliers, as a sentence. Null when there are none. */
  onbevestigd: string | null;
  /** Open invoices with no supplier, as a sentence. Null when there are none. */
  zonderLeverancier: string | null;
  dir: "ltr" | "rtl";
}

export function buildSupplierBalancePanel(
  result: SupplierBalanceResult,
  locale: Locale,
  /** Today, ISO. Passed in — this module owns no clock. */
  today: string,
): SupplierBalancePanel {
  const t = translator(locale);
  const eur = (n: number) => formatEuroNL(n);

  const leveranciers: SupplierLine[] = result.suppliers
    .filter((s) => s.openCount > 0)
    .map((s) => ({
      key: s.key,
      name: s.name,
      bedrag: eur(s.open),
      aantal: s.openCount === 1 ? t("leveranciers.eenFactuur") : t("leveranciers.aantalFacturen", { aantal: s.openCount }),
      vervallen: s.overdueCount > 0 ? t("leveranciers.vervallen", { bedrag: eur(s.overdue) }) : null,
      oudste: s.oldestDueDate ? t("leveranciers.oudste", { datum: nlDate(s.oldestDueDate) }) : null,
      onbevestigd: s.unverifiedCount > 0
        ? t("leveranciers.onbevestigd", { aantal: s.unverifiedCount })
        : null,
    }));

  const a = result.aging;
  // Only the buckets that carry money. A row of five zeroes is a table nobody reads, and the
  // absence of a bucket says exactly as much as a zero in it.
  const ouderdom: AgingLine[] = ([
    [t("leveranciers.ouderdom.nietVervallen"), a.nietVervallen, false],
    ["1 – 30", a.dag1tot30, true],
    ["31 – 60", a.dag31tot60, true],
    ["61 – 90", a.dag61tot90, true],
    ["90+", a.dag90plus, true],
    [t("leveranciers.ouderdom.zonderDatum"), a.zonderVervaldatum, false],
  ] as Array<[string, number, boolean]>)
    .filter(([, bedrag]) => Math.abs(bedrag) >= 0.005)
    .map(([label, bedrag, vervallen]) => ({ label, bedrag: eur(bedrag), vervallen }));

  return {
    heading: t("leveranciers.titel"),
    peildatum: t("leveranciers.peildatum", { datum: nlDate(result.asOf) }),
    // The warning fires only where it is TRUE: a "huidig" basis answering for today is not a
    // problem, it is the same answer. Showing it anyway would train the owner to ignore it.
    basisWaarschuwing: result.basis === "huidig" && result.asOf !== today
      ? t("leveranciers.basisHuidig")
      : null,
    totaalLabel: t("leveranciers.totaal"),
    totaal: eur(result.total),
    leveranciers,
    leeg: leveranciers.length === 0 ? t("leveranciers.leeg") : null,
    ouderdomKop: t("leveranciers.ouderdom"),
    ouderdom,
    onbevestigd: result.unverifiedCount > 0
      ? t("leveranciers.onbevestigd", { aantal: result.unverifiedCount })
      : null,
    zonderLeverancier: result.unkeyedCount > 0
      ? t("leveranciers.zonderLeverancier", { aantal: result.unkeyedCount, bedrag: eur(result.unkeyedOpen) })
      : null,
    // [TAAL] Travels on the same object as the words. A component that looked the direction up
    // itself could render an Arabic sentence left-to-right for one frame, and physical sides are
    // wrong in exactly one language — the one nobody checks.
    dir: localeDir(locale),
  };
}

export interface CorroborationPanel {
  heading: string;
  /**
   * The lines, most consequential first: a payment dated past the newest statement is live, a
   * supplier whose books outrun their bank lines is a real gap, and history is history.
   */
  regels: string[];
  /** True when every ticked payment inside the covered period is accounted for. */
  allesKlopt: boolean;
  /** The sentence for that state. Present so absence is never the message. */
  klopt: string | null;
  dir: "ltr" | "rtl";
}

/**
 * The corroboration as sentences, or null when there is genuinely nothing to say.
 *
 * Null and "everything checks out" are different answers and both exist here: null means no
 * payment was ticked by hand at all, and `allesKlopt` means several were and the bank covers them.
 */
export function buildCorroborationPanel(
  result: CorroborationResult,
  locale: Locale,
): CorroborationPanel | null {
  const t = translator(locale);
  const eur = (n: number) => formatEuroNL(n);
  const dir = localeDir(locale);

  const byReason = new Map<UncheckableReason, number>();
  for (const u of result.uncheckable) {
    if (u.verdict.kind !== "niet_te_controleren") continue;
    byReason.set(u.verdict.reason, (byReason.get(u.verdict.reason) ?? 0) + 1);
  }
  const naDekking = byReason.get("na_dekking") ?? 0;
  const voorDekking = byReason.get("voor_dekking") ?? 0;
  const geenAfschrift = byReason.get("geen_afschrift") ?? 0;
  const geenDatum = byReason.get("geen_datum") ?? 0;

  const handChecked = result.short.reduce((n, s) => n + s.handClaimCount, 0)
    + result.covered.reduce((n, s) => n + s.handClaimCount, 0);
  const nothingAtAll = naDekking + voorDekking + geenAfschrift + geenDatum === 0
    && handChecked === 0 && result.unkeyed.length === 0;
  if (nothingAtAll) return null;

  const regels: string[] = [];

  // Live first. This is the one that would have caught invoice 2034488 on the day it was ticked.
  if (naDekking > 0) {
    regels.push(
      naDekking === 1
        ? t("betaalcheck.naDekkingEen", { datum: nlDate(result.coverage.to) })
        : t("betaalcheck.naDekking", { aantal: naDekking, datum: nlDate(result.coverage.to) }),
    );
  }
  // Then a real gap between the books and the bank, per supplier, worst first.
  for (const s of result.short) {
    regels.push(t("betaalcheck.tekort", {
      geclaimd: eur(s.claimed),
      leverancier: s.supplierName ?? s.supplierKey,
      betaald: eur(s.paidByBank),
      verschil: eur(s.gap),
    }));
  }
  if (geenAfschrift > 0) regels.push(t("betaalcheck.geenAfschrift"));
  if (geenDatum > 0) regels.push(t("betaalcheck.geenDatum", { aantal: geenDatum }));
  if (voorDekking > 0) {
    regels.push(t("betaalcheck.voorDekking", { aantal: voorDekking, datum: nlDate(result.coverage.from) }));
  }

  const allesKlopt = regels.length === 0;
  return {
    heading: t("betaalcheck.titel"),
    regels,
    allesKlopt,
    klopt: allesKlopt ? t("betaalcheck.klopt") : null,
    dir,
  };
}
