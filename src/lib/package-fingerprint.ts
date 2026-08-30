// src/lib/package-fingerprint.ts
// [PAKKET-AFDRUK] Wat er in de handen van de boekhouder is beland, en of dat sinds de vorige keer
// is veranderd.
//
// ── HET GAT ──
// package_shares legt de HANDELING vast — naar wie de link ging, wanneer, hoe vaak hij is
// opgehaald. Wat er UIT kwam legt niets vast, en de zip wordt bij elke download opnieuw gebouwd
// uit de huidige tabellen ("Alles komt uit de RIJ"). Dus:
//
//   april  — de boekhouder haalt het pakket op: 47 facturen, € 12.400 aan kosten;
//   mei    — een late inkoopfactuur wordt bevestigd;
//   juni   — hij haalt DEZELFDE link nog eens op: 48 facturen, € 12.454,02.
//
// Zelfde token, zelfde URL, ander pakket. En de vraag die een auditor acht maanden later stelt —
// "waarom veranderde deze post van € 12.400 naar € 12.454,02?" — heeft dan geen antwoord dat
// verder komt dan "omdat de gegevens zijn veranderd".
//
// ── WAAROM btw_filings DIT NIET DEKT ──
// Dat dekt het KWARTAAL, en pas nadat het is ingediend: de snapshot wordt bij het indienen bevroren
// en first_divergence_at markeert het moment dat de boeken erna bewogen. Uitstekend, en een andere
// gebeurtenis. De boekhouder werkt uit het PAKKET, vóór de aangifte. Beweegt het pakket tussen zijn
// lezing en zijn indiening, dan zegt niets het — de aangifte is dan gebouwd op cijfers die niemand
// meer kan reproduceren, en de divergentie die daarna wél wordt gemeten rekent tegen de verkeerde
// startwaarde.
//
// ── DE VORM IS GELEEND, NIET UITGEVONDEN ──
// Precies de vorm van btw_filings: een afdruk die NOOIT wordt herschreven, en een vergelijking
// tegen de vorige. Dat patroon is in dit huis bewezen; een tweede mechanisme ernaast zetten zou
// twee waarheden over hetzelfde kwartaal opleveren.
//
// Puur. De afdruk gaat over de INHOUD, dus generatedAt hoort er met opzet NIET in — dat verschilt
// bij elke download en zou elk pakket als "veranderd" aanmerken, wat hetzelfde is als niets zeggen.

/** The part of a closing-package summary that describes WHAT was handed over. */
export interface PackageContent {
  outgoingCount: number;
  incomingCount: number;
  /** Files actually in the ZIP: invoices-with-PDF + bank statement(s) + shared documents. */
  filesIncluded: number;
  /** Invoice-evidence only — never read filesIncluded as an evidence signal. */
  invoicesWithPdf: number;
  /** Which invoices lacked their source document, by number. */
  missingEvidence: string[];
  bankStatementIncluded: boolean;
  /** Warning CODES, not their sentences: the sentence may be reworded, the code is the fact. */
  warningCodes: string[];
}

/** One recorded handover. Never rewritten — see the header. */
export interface PackageDelivery {
  fingerprint: string;
  deliveredAt: string;
  content: PackageContent;
}

/**
 * Reduce a summary to the content that was handed over.
 *
 * Takes the loose shape rather than importing ClosingPackageSummary, so this module stays pure and
 * testable without dragging the whole package builder (and its Supabase types) into a unit test.
 */
export function contentOf(summary: {
  outgoingCount: number;
  incomingCount: number;
  filesIncluded: number;
  invoicesWithPdf: number;
  missingEvidence: string[];
  bankStatementIncluded: boolean;
  warnings: { code: string }[];
}): PackageContent {
  return {
    outgoingCount: summary.outgoingCount,
    incomingCount: summary.incomingCount,
    filesIncluded: summary.filesIncluded,
    invoicesWithPdf: summary.invoicesWithPdf,
    // Sorted, because the ORDER a list came back in is not part of what was delivered. Two
    // identical packages whose reads returned in a different order must fingerprint the same, or
    // every download looks like a change and the signal is worthless.
    missingEvidence: [...summary.missingEvidence].sort(),
    bankStatementIncluded: summary.bankStatementIncluded,
    warningCodes: [...new Set(summary.warnings.map((w) => w.code))].sort(),
  };
}

/**
 * A stable print of that content.
 *
 * Deliberately NOT a cryptographic hash: this is not a tamper seal (the row lives in the same
 * database as the data) but an equality key, and a readable one costs nothing and can be eyeballed
 * in a support conversation. It is compared, never parsed.
 */
export function fingerprint(c: PackageContent): string {
  return [
    `u${c.outgoingCount}`,
    `i${c.incomingCount}`,
    `f${c.filesIncluded}`,
    `p${c.invoicesWithPdf}`,
    `b${c.bankStatementIncluded ? 1 : 0}`,
    `m[${c.missingEvidence.join("|")}]`,
    `w[${c.warningCodes.join("|")}]`,
  ].join(".");
}

/**
 * WHAT KIND of change this is — and this is the difference between a diff and understanding.
 *
 * Two packages can move by the same numbers and mean opposite things:
 *
 *   · a purchase invoice arrives late → the FIGURES moved. The accountant is reading a total that
 *     no longer exists, and if he files on it the aangifte is wrong before it is sent;
 *   · a receipt arrives for an invoice that was already counted → only the EVIDENCE moved. Every
 *     amount is what it was; the package is simply better proved. Nobody has to do anything, and
 *     telling the owner to "send the link again" for that is noise that teaches him to ignore the
 *     next one — which will be the first kind;
 *   · a bank statement or a document disappeared → the evidence got WORSE. Nothing in the figures
 *     says so, and this is the one that quietly weakens a package nobody re-checks.
 *
 * A message that cannot tell these apart is a diff. One that can is the app understanding what
 * happened, which is the only version worth waking someone for.
 */
export type DriftKind =
  /** Invoice counts moved: what the accountant read is out of date. */
  | "figures_moved"
  /** Same invoices, better documented. Good news, and no action. */
  | "evidence_improved"
  /** Same invoices, worse documented. Nothing else says so. */
  | "evidence_lost";

export interface PackageDrift {
  changed: boolean;
  /** Null when nothing moved. */
  kind: DriftKind | null;
  /** Does anyone have to DO something? Evidence that improved needs nobody. */
  needsAction: boolean;
  /** Dutch sentences, one per thing that moved. Empty when nothing did. */
  reasons: string[];
  outgoingDelta: number;
  incomingDelta: number;
  filesDelta: number;
  evidenceDelta: number;
}

const telwoord = (n: number, een: string, meer: string): string =>
  n === 1 ? `1 ${een}` : `${n} ${meer}`;

/**
 * What moved between two handovers of the same quarter.
 *
 * `previous` is the OLDER delivery. Deltas are current − previous, so a positive number means the
 * package grew.
 */
export function driftBetween(previous: PackageContent, current: PackageContent): PackageDrift {
  const reasons: string[] = [];
  const outgoingDelta = current.outgoingCount - previous.outgoingCount;
  const incomingDelta = current.incomingCount - previous.incomingCount;
  const filesDelta = current.filesIncluded - previous.filesIncluded;
  const evidenceDelta = current.invoicesWithPdf - previous.invoicesWithPdf;

  const beweging = (delta: number, een: string, meer: string) =>
    delta > 0
      ? `${telwoord(delta, een, meer)} erbij`
      : `${telwoord(-delta, een, meer)} eraf`;

  if (outgoingDelta !== 0) reasons.push(`${beweging(outgoingDelta, "verkoopfactuur", "verkoopfacturen")}`);
  if (incomingDelta !== 0) reasons.push(`${beweging(incomingDelta, "inkoopfactuur", "inkoopfacturen")}`);
  if (filesDelta !== 0) reasons.push(`${beweging(filesDelta, "bestand", "bestanden")}`);
  if (evidenceDelta !== 0) reasons.push(`${beweging(evidenceDelta, "factuur met bon", "facturen met bon")}`);
  if (previous.bankStatementIncluded !== current.bankStatementIncluded) {
    reasons.push(current.bankStatementIncluded ? "het bankafschrift is nu bijgevoegd" : "het bankafschrift zit er niet meer bij");
  }

  // De waarschuwingen apart: die veranderen zonder dat een telling beweegt (een ontbrekende bon die
  // wordt aangeleverd haalt een code weg terwijl elk aantal gelijk blijft), en juist die stille
  // verandering is er een die de boekhouder wil zien.
  const erbij = current.warningCodes.filter((c) => !previous.warningCodes.includes(c));
  const eraf = previous.warningCodes.filter((c) => !current.warningCodes.includes(c));
  if (erbij.length > 0) reasons.push(`nieuwe waarschuwing: ${erbij.join(", ")}`);
  if (eraf.length > 0) reasons.push(`waarschuwing opgelost: ${eraf.join(", ")}`);

  // Welke facturen precies van de "zonder bon"-lijst kwamen of gingen. Een telling die gelijk blijft
  // terwijl de NAMEN verschillen betekent dat de ene bon binnenkwam en de andere wegviel — twee
  // gebeurtenissen die elkaar in het getal opheffen en allebei het melden waard zijn.
  const bonErbij = current.missingEvidence.filter((n) => !previous.missingEvidence.includes(n));
  const bonEraf = previous.missingEvidence.filter((n) => !current.missingEvidence.includes(n));
  if (bonErbij.length > 0) reasons.push(`mist nu ook een bon: ${bonErbij.slice(0, 5).join(", ")}`);
  if (bonEraf.length > 0) reasons.push(`bon aangeleverd voor: ${bonEraf.slice(0, 5).join(", ")}`);

  // ── Wat voor soort verandering is dit? ───────────────────────────────────
  // De volgorde is de volgorde van gevolg. Bewegen de AANTALLEN, dan is dat het verhaal, ook als er
  // tegelijk een bon binnenkwam: de boekhouder leest dan een totaal dat niet meer bestaat, en dat
  // overstemt alles wat er verder gebeurde.
  const cijfersBewogen = outgoingDelta !== 0 || incomingDelta !== 0;
  // Bewijs dat WEGVIEL: minder facturen met bon, of het bankafschrift dat er niet meer bij zit.
  // Bestandsaantal alléén telt hier niet — dat beweegt ook mee met de facturen hierboven.
  const bewijsWeg =
    evidenceDelta < 0 || (previous.bankStatementIncluded && !current.bankStatementIncluded) || bonErbij.length > 0;

  const kind: DriftKind | null =
    reasons.length === 0 ? null : cijfersBewogen ? "figures_moved" : bewijsWeg ? "evidence_lost" : "evidence_improved";

  return {
    changed: reasons.length > 0,
    kind,
    // Alleen beter geworden bewijs vraagt niets van niemand. Daar een melding voor sturen is hoe
    // een eigenaar leert de vólgende weg te klikken — en dat is er een van de eerste soort.
    needsAction: kind === "figures_moved" || kind === "evidence_lost",
    reasons, outgoingDelta, incomingDelta, filesDelta, evidenceDelta,
  };
}

/**
 * The sentence the owner reads when a package they already handed over has moved since.
 *
 * Dutch, and it names the DATE of the earlier handover: "it changed" is not actionable, "what your
 * accountant downloaded on 12 April is not what this link gives today" is.
 */
export function driftSentence(quarterLabel: string, previousAt: string, drift: PackageDrift): string | null {
  if (!drift.changed || !drift.kind) return null;
  const datum = previousAt.slice(0, 10).split("-").reverse().join("-");
  const wat = drift.reasons.join("; ");
  // Drie verhalen, drie handelingen. Eén zin voor alle drie zou de eigenaar bij de derde soort
  // laten schrikken en bij de eerste laten doorklikken — precies verkeerd om.
  switch (drift.kind) {
    case "figures_moved":
      return (
        `Het pakket ${quarterLabel} bevat andere CIJFERS dan toen je boekhouder het op ${datum} ophaalde: ${wat}. ` +
        `Wat hij nu voor zich heeft klopt niet meer met je boeken — stuur hem de link opnieuw voordat hij aangifte doet.`
      );
    case "evidence_lost":
      return (
        `Het pakket ${quarterLabel} is sinds ${datum} MINDER goed onderbouwd: ${wat}. ` +
        `De bedragen zijn niet veranderd, maar het bewijs eronder wel — kijk na of er iets is weggegooid of losgekoppeld.`
      );
    case "evidence_improved":
      return (
        `Het pakket ${quarterLabel} is beter onderbouwd dan toen je boekhouder het op ${datum} ophaalde: ${wat}. ` +
        `De bedragen zijn gelijk gebleven; er hoeft niets te gebeuren.`
      );
  }
}

// ── WAT HET BETEKENT, niet alleen wat er gebeurde ────────────────────────────
//
// Dezelfde verandering betekent twee verschillende dingen, en het verschil is niet gradueel maar
// juridisch:
//
//   · in een OPEN kwartaal is een late inkoopfactuur gewoon boekhouden. Er is niets aan de hand,
//     er hoeft niemand iets te doen, en het pakket dat straks wordt overhandigd klopt gewoon;
//   · in een INGEDIENDE kwartaal is diezelfde factuur een verplichting. Art. 10a AWR vraagt de
//     ondernemer het verschil te melden zodra hij het WEET — en dit bericht is precies het moment
//     waarop hij het weet.
//
// Een app die alleen "het pakket is veranderd" zegt, laat de eigenaar dat onderscheid zelf maken.
// Dat is de vraag waarvoor hij een boekhouder heeft, gesteld aan de partij die hem niet kan
// beantwoorden.
//
// De juridische som staat NIET hier. correctionRoute() en de suppletiegrens wonen in btw-filing.ts
// en filed-quarter.ts, waar ze getest zijn en waar de aangifte ze ook vandaan haalt; deze functie
// krijgt de uitkomst aangereikt. Twee plekken die dezelfde grens rekenen is hoe twee schermen een
// ander bedrag gaan noemen over hetzelfde kwartaal.

/** What the app knows about the quarter this package belongs to. */
export interface QuarterStanding {
  /** Has this quarter's aangifte been sent? */
  filed: boolean;
  /**
   * The route btw-filing.ts computed for what is still uncorrected: "none" | "carry" | "suppletie".
   * Null when the quarter is open, or when the app could not work it out — and those are NOT the
   * same thing, which is why this is nullable rather than defaulted to "none".
   */
  route: "none" | "carry" | "suppletie" | null;
  /** The uncorrected BTW difference in euros, when known. */
  outstandingEur: number | null;
}

/**
 * The sentence that says what this drift MEANS for this quarter.
 *
 * Falls back to driftSentence when the quarter is open — there the change is bookkeeping, and
 * dressing it as a legal matter would be its own kind of wrong.
 */
export function driftMeaning(
  quarterLabel: string,
  previousAt: string,
  drift: PackageDrift,
  standing: QuarterStanding,
): string | null {
  const basis = driftSentence(quarterLabel, previousAt, drift);
  if (!basis) return null;
  if (!standing.filed) return basis;

  // Ingediend, maar het pakket bewoog alleen in BEWIJS. De aangifte klopt nog; wat veranderde is
  // hoe goed hij te onderbouwen is. Geen suppletie, wel het vermelden waard.
  if (drift.kind === "evidence_improved" || drift.kind === "evidence_lost") {
    return `${basis} Dit kwartaal is al ingediend — de bedragen in die aangifte veranderen hier niet door.`;
  }

  const bedrag =
    typeof standing.outstandingEur === "number" && Number.isFinite(standing.outstandingEur)
      ? `€ ${Math.abs(standing.outstandingEur).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null;

  switch (standing.route) {
    case "suppletie":
      return (
        `${basis} Dit kwartaal is al INGEDIEND en het verschil${bedrag ? ` van ${bedrag}` : ""} is groter dan € 1.000: ` +
        `dat moet als suppletie worden gemeld, niet meegenomen in de volgende aangifte.`
      );
    case "carry":
      return (
        `${basis} Dit kwartaal is al INGEDIEND${bedrag ? `, en het verschil is ${bedrag}` : ""}. ` +
        `Onder de € 1.000 mag dat in je volgende gewone aangifte worden verrekend.`
      );
    case "none":
      return `${basis} Dit kwartaal is al ingediend, maar de BTW komt op hetzelfde bedrag uit — er hoeft niets te worden gecorrigeerd.`;
    // [NO-SILENT-EMPTY] null is niet "geen correctie nodig". Het is "we konden het niet uitrekenen",
    // en die twee als hetzelfde behandelen is hoe een verplichting stilvalt: de eigenaar leest dat
    // er niets hoeft, terwijl niemand heeft gekeken.
    default:
      return (
        `${basis} Dit kwartaal is al ingediend. We konden niet vaststellen of de BTW erdoor verandert — ` +
        `laat dit nakijken voordat je het laat rusten.`
      );
  }
}
