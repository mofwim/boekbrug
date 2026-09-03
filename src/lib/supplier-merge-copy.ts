// src/lib/supplier-merge-copy.ts
// [LEVERANCIER-SAMENVOEGEN] The words for the merge offers on the creditors screen. Pure, no I/O,
// no React. Run: npx tsx --test src/lib/supplier-merge-copy.test.ts
//
// supplier-merge.ts decides WHICH pairs may be offered and which way round. This decides what the
// owner reads about each one, and it has exactly one job beyond translation: to put the PROOF on
// the screen. "Deze twee zijn één bedrijf" is the app's opinion; "zelfde KVK-nummer 17123456" is
// something the owner can hold against the two invoices in front of them in four seconds.
//
// That is not politeness. This button rewrites what already-booked invoices say about who sent
// them, and the pair it must never offer — BALKIP B.V. beside GROOTHANDEL M.H. BAL V.O.F. — is
// one an owner might well confirm on a glance at the names alone. So the names are never the
// argument; the identifier is, and it is quoted in full.
//
// [TAAL] The panel that renders this holds no language of its own: it receives this object and
// prints it, and `dir` travels on the same object so the words and their direction cannot end up
// out of step.

import { translator } from "./i18n/t";
import { localeDir, type Locale } from "./i18n/locale";
import type { MergePlan, MergeRefusal } from "./supplier-merge";

export interface MergeOffer {
  /** Sent back to the server, which re-decides on what it reads before it writes anything. */
  survivorId: string;
  mergedAwayId: string;
  /** The name that stays, and the name that becomes an alias of it. Shown as themselves. */
  survivorName: string;
  mergedAwayName: string;
  /** "Zelfde KVK-nummer: 17123456" — the reason, with the value in it. */
  evidence: string;
  /** "3 facturen komen te staan onder GROOTHANDEL M.H. BAL V.O.F." */
  effect: string;
}

export interface MergePanel {
  heading: string;
  /** Says out loud what the app will and will not propose. */
  explanation: string;
  offers: MergeOffer[];
  /** The button on every row. One label, so it cannot drift between rows. */
  action: string;
  busy: string;
  dir: "ltr" | "rtl";
}

/**
 * The panel, or null when there is nothing to offer.
 *
 * Null rather than an empty panel: a heading reading "twee leveranciers die één bedrijf zijn" over
 * no rows is a question mark on a screen about money, and the ordinary state of this panel is to
 * be absent.
 */
export function buildSupplierMergePanel(
  plans: readonly MergePlan[],
  locale: Locale,
): MergePanel | null {
  const t = translator(locale);
  const offers: MergeOffer[] = [];

  for (const plan of plans) {
    if (!plan.ok) continue;
    const evidence = plan.evidence === "kvk"
      ? t("lev.merge.bewijs.kvk", { waarde: plan.sharedValue })
      : t("lev.merge.bewijs.iban", { waarde: plan.sharedValue });
    // Three sentences, not one with a number in it: "1 factuur" and "0 facturen" are different
    // statements, and an empty row is not a smaller merge — it is one where nothing moves and only
    // the name goes, which the owner should read as exactly that.
    const effect = plan.movesInvoices === 0
      ? t("lev.merge.gevolgGeen", { oud: plan.mergedAwayName })
      : plan.movesInvoices === 1
        ? t("lev.merge.gevolgEen", { naam: plan.survivorName })
        : t("lev.merge.gevolgN", { n: plan.movesInvoices, naam: plan.survivorName });

    offers.push({
      survivorId: plan.survivorId,
      mergedAwayId: plan.mergedAwayId,
      survivorName: plan.survivorName,
      mergedAwayName: plan.mergedAwayName,
      evidence,
      effect,
    });
  }

  if (offers.length === 0) return null;

  return {
    heading: t("lev.merge.kop"),
    explanation: t("lev.merge.uitleg"),
    offers,
    action: t("lev.merge.knop"),
    busy: t("lev.merge.bezig"),
    dir: localeDir(locale),
  };
}

/**
 * What the owner reads when the server refused after all.
 *
 * The screen was drawn from a plan; the server re-plans on what it reads, and between the two an
 * import can have given one row the KVK that makes it a different company. Each refusal names the
 * FACT that decided it, because "kon niet" over a merge invites a retry that can never succeed.
 */
export function mergeRefusalText(reason: MergeRefusal | "stale" | null, locale: Locale): string {
  const t = translator(locale);
  if (reason === "different-kvk") return t("lev.merge.geweigerd.kvk");
  if (reason === "two-accounts") return t("lev.merge.geweigerd.rekening");
  if (reason === "no-evidence" || reason === "same-supplier" || reason === "stale") {
    return t("lev.merge.geweigerd.oud");
  }
  return t("lev.merge.fout");
}

/** The sentence after a merge that went through. */
export function mergeDoneText(mergedAwayName: string, survivorName: string, locale: Locale): string {
  // The catalogue's own parameter names are Dutch, like every other key in it; the code around
  // them is not. Mapped here rather than renamed there, so one convention does not leak into two.
  return translator(locale)("lev.merge.klaar", { oud: mergedAwayName, nieuw: survivorName });
}
