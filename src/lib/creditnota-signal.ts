// src/lib/creditnota-signal.ts
// [CREDITNOTA-SIGNAAL] Herkent een inkoop-CREDITNOTA die als gewone factuur is opgeslagen. Puur.
//
// ── WAT ER MISGAAT ──
// Een creditnota van je leverancier is GELD DAT JOU TOEKOMT: hij hoort in de boeken met een
// minteken, zodat hij van het openstaande saldo af gaat en de voorbelasting corrigeert. Zo staat
// het in elke Nederlandse bron ("Het bedrag en de BTW gaan er met een minteken in, zodat uw omzet
// en af te dragen BTW automatisch worden gecorrigeerd").
//
// De lezer herkent er al veel, maar één geval glipt er structureel doorheen: een leverancier die
// zijn creditnota met een POSITIEF eindbedrag afdrukt. Dat is heel gewoon — het papier zegt
// "Creditnota" en zet er € 51,80 onder, niet € -51,80. En ai.ts weigert bewust op dat papier af te
// gaan (HUNT-F2: "A POSITIVE printed total is never a creditnota"), want anders zou elke korting
// op een gewone factuur een creditnota worden. Terecht — maar het gevolg is dat zo'n document als
// gewone inkoopfactuur in de boeken belandt, en dan:
//
//   · telt hij mee in "nog te betalen" terwijl je hem NIET hoeft te betalen;
//   · krijgt hij een aanmaning ("135 dagen te laat") voor geld dat je niet schuldig bent;
//   · en — het zwaarst — wordt zijn voorbelasting OPGETELD in plaats van AFGETROKKEN, waardoor de
//     aangifte te veel btw terugvraagt.
//
// ── WAAROM DIT SIGNALEERT EN NIET BESLIST ──
// De verleiding is om het teken automatisch om te klappen zodra een nummer met "CR" begint. Dat
// mag niet. Bij een andere leverancier kan "CR" iets heel anders betekenen, en een verkeerde
// omklap maakt van een ECHTE schuld een tegoed: je betaalt te weinig, en dat merk je pas bij de
// aanmaning. Dit is de geldkern; daar geldt de huisregel — het scherm TOONT, de mens BESLIST.
//
// Daarom staan er twee eisen naast elkaar, en pas samen zeggen ze iets:
//
//   1. het nummer draagt een bekende creditmarkering als voorvoegsel (CR, CN, …), én
//   2. DEZELFDE leverancier gebruikt aantoonbaar óók een ánder voorvoegsel voor zijn gewone
//      facturen.
//
// Eis 2 is wat het bewijs draagt: het is niet onze aanname over wat "CR" betekent, het is de
// leverancier die met zijn eigen nummering twee soorten documenten uit elkaar houdt. In het geval
// dat dit bestand aanleiding gaf stond dat letterlijk in de lijst — CR0300343 en CR0300510 naast
// RE0801378, alle drie van dezelfde slijter. Eén voorvoegsel zonder tegenhanger zegt niets, en dan
// zwijgen we ook.

/** Het alfabetische voorvoegsel van een documentnummer: "CR0300343" → "CR", "2033161" → "". */
export function numberPrefix(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toUpperCase();
  const m = /^([A-Z]+)/.exec(s);
  return m ? m[1] : "";
}

/**
 * Voorvoegsels die in de Nederlandse praktijk een creditnota aanduiden.
 *
 * Bewust KORT gehouden. Elk voorvoegsel dat hier bij komt, vergroot de kans dat we een gewone
 * factuur aanzien voor een tegoed — en die fout kost de eigenaar een aanmaning. Een enkele "C"
 * staat er daarom niet bij (te vaak "Customer", "Contract"), en "KR" ook niet (kan "krediet"
 * betekenen maar net zo goed een artikelreeks).
 */
const CREDIT_PREFIXES = new Set(["CR", "CN", "CRN", "CRED", "CREDIT", "CRE"]);

export type CreditnotaSignal = {
  /** Waar genoeg om de eigenaar ernaar te laten kijken — nooit genoeg om zelf te boeken. */
  suspected: boolean;
  /** Het voorvoegsel dat opviel, voor de uitleg op het scherm. Leeg als er niets opviel. */
  prefix: string;
  /** Een voorvoegsel van dezelfde leverancier dat er ANDERS uitziet — het bewijs onder eis 2. */
  contrastPrefix: string | null;
};

const NO_SIGNAL: CreditnotaSignal = { suspected: false, prefix: "", contrastPrefix: null };

/**
 * Lijkt dit opgeslagen document een creditnota die als gewone factuur is geboekt?
 *
 * @param invoiceNumber het nummer zoals de leverancier het drukt
 * @param totalIncBtw   het OPGESLAGEN totaal (positief = geboekt als schuld)
 * @param invoiceType   de opgeslagen soort ('factuur' | 'creditnota' | …)
 * @param vendorNumbers alle documentnummers van DEZELFDE leverancier, dit nummer mag erbij zitten
 */
export function looksLikeCreditnota(input: {
  invoiceNumber: string | null | undefined;
  totalIncBtw: number | null | undefined;
  invoiceType: string | null | undefined;
  vendorNumbers: readonly (string | null | undefined)[];
}): CreditnotaSignal {
  // Al goed geboekt — dan valt er niets te melden. Dit is de gewenste eindtoestand, niet een geval
  // dat we alsnog willen aanstippen.
  if (input.invoiceType === "creditnota") return NO_SIGNAL;

  // Al negatief opgeslagen: dan gedraagt de rij zich al als een tegoed (hij gaat van het saldo af).
  // De SOORT klopt dan misschien nog niet, maar het GELD wel — en dit signaal gaat over geld dat
  // de verkeerde kant op staat. `0` telt ook als "niets te melden": daar valt niets aan af te trekken.
  const total = Number(input.totalIncBtw ?? 0);
  if (!Number.isFinite(total) || total <= 0) return NO_SIGNAL;

  // Eis 1 — een bekende creditmarkering.
  const prefix = numberPrefix(input.invoiceNumber);
  if (!prefix || !CREDIT_PREFIXES.has(prefix)) return NO_SIGNAL;

  // Eis 2 — dezelfde leverancier houdt met zijn nummering twee soorten uit elkaar. Zonder deze
  // tegenhanger is het onze aanname over twee letters, en dat is te weinig om iemand op af te
  // sturen. Een tweede CR-nummer telt niet mee: dat bevestigt alleen zichzelf.
  const contrastPrefix =
    input.vendorNumbers
      .map((n) => numberPrefix(n))
      .find((p) => p !== "" && p !== prefix) ?? null;
  if (!contrastPrefix) return NO_SIGNAL;

  return { suspected: true, prefix, contrastPrefix };
}

/**
 * De app noemt dit zelf een creditnota, maar het bedrag staat als SCHULD in de boeken.
 *
 * Dit is geen vermoeden maar een TEGENSPRAAK, en daarom een apart geval: er valt niets te raden —
 * de lezer heeft de soort al vastgesteld en het bedrag wijst de andere kant op. Zo'n rij telt mee
 * in "nog te betalen" terwijl hij er hoort af te gaan, en zijn voorbelasting wordt opgeteld in
 * plaats van afgetrokken. Zwaarder dan het vermoeden hierboven, en met een eigen melding.
 */
export function creditnotaSignConflict(input: {
  invoiceType: string | null | undefined;
  totalIncBtw: number | null | undefined;
}): boolean {
  if (input.invoiceType !== "creditnota") return false;
  const total = Number(input.totalIncBtw ?? 0);
  return Number.isFinite(total) && total > 0;
}

/**
 * De zin op het scherm. Zegt WAT er opviel en WAAROM het uitmaakt, en laat het besluit bij de
 * eigenaar — er staat geen bedrag in dat wij al hebben omgeklapt.
 */
export function creditnotaSignalText(signal: CreditnotaSignal): string | null {
  if (!signal.suspected) return null;
  return (
    `Dit nummer begint met ${signal.prefix} terwijl dezelfde leverancier ${signal.contrastPrefix} gebruikt ` +
    `voor gewone facturen — dit lijkt een creditnota. Die hoort met een minteken in de boeken: hij gaat ` +
    `van je openstaande saldo af en verlaagt de btw die je terugvraagt. Nu telt hij als schuld mee.`
  );
}
