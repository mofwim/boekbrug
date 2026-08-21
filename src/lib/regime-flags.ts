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
  | "kor_possible"
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

// Phrase gates. Deliberately tax-specific so an ordinary invoice line never trips them:
//  - reverse charge: require "btw" adjacent to "verleg" (the legally-mandated invoice wording is
//    "btw verlegd", Art. 35a Wet OB), OR the full word "verleggingsregeling", OR "reverse charge".
//    A bare "verleg" stem is NOT enough: it is a substring of the very common word "overleg"
//    (consultation/meeting) and of "verleggen" (to relocate) — an unanchored gate false-flags a
//    consultancy line like "Juridisch overleg" as reverse charge, which erodes trust.
//  - margin scheme: the named regelingen only — NOT the bare word "marge" (winstmarge is common).
// [E-FACTUUR] Exported, because the UBL builder has to answer the same question about the same
// text: is this supply reverse-charged? A second regex somewhere else would be a second definition
// of a legal fact, and the two would drift — the aangifte would flag an invoice that the e-invoice
// exported as an ordinary 0% supply, about one document.
export const RE_REVERSE_CHARGE = /btw[-\s]*verleg|verleggingsregeling|reverse[-\s]*charge/i;
const RE_REVERSE = RE_REVERSE_CHARGE;
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
        "KOR-conform. De omzet zelf klopt; alleen de BTW-afdracht vervalt. " +
        // [KOR-5B] Het spiegelbeeld, en het gevaarlijke van de twee: onder de KOR vervalt ook het
        // RECHT OP AFTREK. Dit concept rekent 5b gewoon uit je inkoopfacturen, dus er staat een
        // teruggaaf in waar een KOR-ondernemer geen recht op heeft. Wie alleen las dat "de
        // afdracht vervalt" mocht redelijkerwijs denken dat de aftrek bleef — en vraagt dan geld
        // terug dat later met rente wordt nageheven.
        "LET OP: onder de KOR vervalt ook je RECHT OP AFTREK — de voorbelasting (5b) in dit " +
        "concept is berekend uit je inkoopfacturen, maar mag NIET worden teruggevraagd. " +
        // [KOR-JAARGRENS] De drempelvlag hieronder toetst op de omzet die deze berekening ziet, en
        // dat is één KWARTAAL. De KOR-grens is een JAARgrens: wie elk kwartaal €6.000 omzet blijft
        // hier onder de €20.000 en overschrijdt de jaargrens toch. Zonder deze zin was dat gat
        // onzichtbaar — de vlag zwijgt dan gewoon. Overschrijden werkt bovendien terug: vanaf de
        // levering die eroverheen gaat is BTW verschuldigd, en die kun je niet meer nafactureren.
        `De KOR-grens van €${KOR_THRESHOLD_EUR.toLocaleString("nl-NL")} geldt per JAAR; dit concept ` +
        "ziet alleen dit kwartaal. Controleer je jaaromzet zelf — bij overschrijding vervalt de " +
        "KOR vanaf die levering, met terugwerkende kracht.",
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

  // ── [KOR-STIL] The mirror of kor_threshold, for the owner who is in the KOR and never said so ──
  //
  // kor_active is a DECLARATION and it defaults to false, so "not in the scheme" and "never opened
  // Instellingen" are the same stored value. Everything the app does about the KOR — the 0%-only
  // invoice screen, the send route's refusal, the counter's refusal — hangs off that declaration,
  // and for the owner who never made it, all of it is inert. He is the one who most needs it.
  //
  // ── WHY THIS CONDITION AND NOT "HE DECLARED NOTHING" ──
  // The header of this file sets the standard these flags are held to: high precision, because a
  // false regime flag is noise that erodes trust. A flag on "no regime declared" would fire for
  // every owner in the country every quarter, which is the definition of noise — and the ones who
  // genuinely charge btw, the large majority, would learn to scroll past the place regime warnings
  // appear.
  //
  // Turnover UNDER the KOR ceiling is the precise condition instead. It is the only population
  // where the mistake is possible at all: an owner at €80.000 cannot be in the scheme, and never
  // sees this. It is actionable in one sentence, and it names a real consequence — btw computed and
  // paid on turnover that may carry none.
  //
  // Zero turnover is excluded deliberately. A quarter with no revenue says nothing about anyone's
  // regime, and a brand-new account would otherwise open on a warning about a scheme it has not yet
  // had the chance to be in.
  if (
    !s.korActive
    && typeof s.omzetForKorCheck === "number"
    && s.omzetForKorCheck > 0
    && s.omzetForKorCheck <= KOR_THRESHOLD_EUR
  ) {
    flags.push({
      code: "kor_possible",
      title: "Val je onder de KOR?",
      detail:
        `Je omzet in dit tijdvak (€${Math.round(s.omzetForKorCheck).toLocaleString("nl-NL")}) blijft onder de ` +
        `KOR-grens van €${KOR_THRESHOLD_EUR.toLocaleString("nl-NL")} per jaar. In BoekBrug staat de ` +
        "kleineondernemersregeling UIT, dus dit concept rekent gewoon BTW over je omzet en zet die in " +
        "5a als verschuldigd. Doe je wél mee aan de KOR, dan klopt dat niet: onder de KOR breng je " +
        "geen BTW in rekening. Zet de KOR dan aan bij Instellingen — daarna houden je facturen en je " +
        "kassa het tarief vanzelf op 0%. Weet je het niet zeker? Vraag het je boekhouder; hij ziet " +
        "deze melding ook.",
    });
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
