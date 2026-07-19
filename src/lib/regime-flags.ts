// src/lib/regime-flags.ts
// [REGIME-FLAGS] Detect special BTW regimes the concept aangifte does NOT auto-compute,
// and HAND them to the accountant as flags instead of silently producing a wrong number.
// Pure + phrase-gated (high precision — a false regime flag is noise that erodes trust).
// No I/O; fully testable (run: npx tsx src/lib/regime-flags.test.ts).
//
// The one rule these encode: BoekBrug reads the BTW rate off the invoice/turnover and maps
// it into the rubrieken. Three regimes break that mapping in a way we cannot detect from the
// rate alone, so a silent map would be a WRONG number on the aangifte. We flag, never guess:
//
//  - KOR (kleineondernemersregeling): the owner declares it (settings). Under the KOR you
//    charge NO BTW — the verschuldigde BTW (5a) our concept computes must NOT be paid. The
//    omzet is right; only the afdracht changes, and that is the accountant's to apply.
//  - BTW verlegd (verleggingsregeling / reverse charge): the BTW is shifted to the other
//    party. A verlegd line reads as 0% here but is NOT a genuine 0%-sale — it belongs in
//    rubriek 2a (purchase) / stated "btw verlegd" (sale). Phrase-gated on the line text.
//  - Margeregeling (margin scheme, 2e-hands goederen): BTW is due on the MARGIN, not the
//    full price — computing BTW over the full amount overstates it. Phrase-gated.
//
// None of these BLOCK "klaar": the owner did their part by importing the data. They are
// RISKS/notes that travel to the accountant flagged (constraint: no false reassurance, and
// human intervention only where the app genuinely cannot decide).

/** The KOR annual turnover ceiling (€). Above it the regime lapses and BTW applies again. */
export const KOR_THRESHOLD_EUR = 20000;

export type RegimeCode =
  | "kor"
  | "kor_threshold"
  | "reverse_charge_purchase"
  | "reverse_charge_sale"
  | "margin_scheme";

export interface RegimeFlag {
  code: RegimeCode;
  title: string;        // Dutch, short headline
  detail: string;       // Dutch, what the accountant must handle / what it means
  evidence?: string;    // up to a few invoice labels that triggered a phrase-gated flag
}

/** One scannable piece of invoice free-text (a line description), with its direction. */
export interface RegimeLineSignal {
  direction: "incoming" | "outgoing";
  text: string;
  invoiceLabel?: string; // invoice number (for the flag's evidence list)
}

export interface RegimeSignals {
  korActive: boolean;
  // Best available omzet figure to test against the KOR ceiling. A LOWER bound is fine
  // (e.g. one quarter's omzet): if even that exceeds €20k the annual total certainly does,
  // so the threshold flag never false-positives — it can only under-warn, the safe side.
  omzetForKorCheck?: number;
  lines: RegimeLineSignal[];
}

// Phrase gates. Deliberately tax-specific stems so an ordinary invoice line never trips them:
//  - "verleg" covers verlegd / verleggen / verlegging / verleggingsregeling; plus "reverse charge".
//  - margin scheme: the named regelingen only — NOT the bare word "marge" (winstmarge is common).
const RE_REVERSE = /(btw[-\s]*)?verleg|verleggings|reverse[-\s]*charge/i;
const RE_MARGIN = /margeregeling|marge[-\s]?regeling|globalisatieregeling|inkoopverklaring/i;

/**
 * Detect the regimes present in the owner's data. Pure. Phrase-gated flags are de-duped and
 * carry up to 5 invoice labels as evidence so the accountant can find the source invoices.
 */
export function detectRegimeFlags(s: RegimeSignals): RegimeFlag[] {
  const flags: RegimeFlag[] = [];

  if (s.korActive) {
    flags.push({
      code: "kor",
      title: "KOR is actief — bereken geen BTW",
      detail:
        "Je hebt de kleineondernemersregeling (KOR) aangezet. Onder de KOR breng je GEEN BTW in " +
        "rekening en draag je geen BTW af. De verschuldigde BTW (5a) in dit concept is uit je omzet " +
        "berekend, maar hoort onder de KOR niet te worden betaald — je boekhouder verwerkt dit " +
        "KOR-conform. De omzet zelf klopt; alleen de BTW-afdracht vervalt.",
    });
    if (typeof s.omzetForKorCheck === "number" && s.omzetForKorCheck > KOR_THRESHOLD_EUR) {
      flags.push({
        code: "kor_threshold",
        title: `KOR-omzetgrens (€${KOR_THRESHOLD_EUR.toLocaleString("nl-NL")}) mogelijk overschreden`,
        detail:
          `Je omzet in dit tijdvak (€${Math.round(s.omzetForKorCheck).toLocaleString("nl-NL")}) is al hoger ` +
          `dan de KOR-grens van €${KOR_THRESHOLD_EUR.toLocaleString("nl-NL")} per jaar. Overschrijd je de grens ` +
          "over het hele jaar, dan vervalt de KOR en moet je vanaf dat moment weer BTW rekenen — laat je " +
          "boekhouder controleren of de KOR nog van toepassing is.",
      });
    }
  }

  // Phrase-gated line scan — one pass, de-dup evidence per regime.
  const reverseP = new Set<string>();
  const reverseS = new Set<string>();
  const margin = new Set<string>();
  for (const ln of s.lines) {
    const t = typeof ln.text === "string" ? ln.text : "";
    if (!t) continue;
    if (RE_REVERSE.test(t)) (ln.direction === "outgoing" ? reverseS : reverseP).add(ln.invoiceLabel ?? "");
    if (RE_MARGIN.test(t)) margin.add(ln.invoiceLabel ?? "");
  }
  const ev = (set: Set<string>): string | undefined => {
    const labels = [...set].filter(Boolean);
    return labels.length ? labels.slice(0, 5).join(", ") : undefined;
  };

  if (reverseP.size > 0) {
    flags.push({
      code: "reverse_charge_purchase",
      title: "Inkoop met BTW verlegd (rubriek 2a)",
      detail:
        "Op een inkoopfactuur staat 'BTW verlegd' (verleggingsregeling). De BTW is naar jou verlegd: " +
        "die hoort in rubriek 2a én je mag dezelfde BTW als voorbelasting aftrekken. Dit concept telt de " +
        "regel als 0% en berekent die verlegging NIET automatisch — je boekhouder verwerkt rubriek 2a.",
      evidence: ev(reverseP),
    });
  }
  if (reverseS.size > 0) {
    flags.push({
      code: "reverse_charge_sale",
      title: "Verkoop met BTW verlegd",
      detail:
        "Op een verkoopfactuur staat 'BTW verlegd'. Je hebt de BTW naar je afnemer verlegd; deze omzet is " +
        "GEEN gewone 0%-omzet maar hoort apart te worden aangegeven. Dit concept berekent de verlegging niet " +
        "automatisch — je boekhouder plaatst deze omzet in het juiste vak.",
      evidence: ev(reverseS),
    });
  }
  if (margin.size > 0) {
    flags.push({
      code: "margin_scheme",
      title: "Margeregeling gedetecteerd",
      detail:
        "Een factuur verwijst naar de margeregeling (2e-hands goederen). Onder de margeregeling is BTW " +
        "verschuldigd over de WINSTMARGE, niet over het volledige bedrag. Dit concept rekent de BTW over het " +
        "hele bedrag en overschat de BTW dus — je boekhouder berekent de marge-BTW apart.",
      evidence: ev(margin),
    });
  }

  return flags;
}

/** One honest note line for a flag (title + detail + optional evidence). Shared by the concept
 *  aangifte notes and the closing-package warnings so every surface phrases a regime the same. */
export function regimeFlagNote(f: RegimeFlag): string {
  const base = `${f.title}: ${f.detail}`;
  return f.evidence ? `${base} (bijv. factuur ${f.evidence})` : base;
}
