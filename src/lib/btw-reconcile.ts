// src/lib/btw-reconcile.ts
// [BTW-RIJM] "Excl + BTW ≠ totaal" — welk van de drie getallen is de vreemde eend? Puur.
//
// ── WAAROM DIT BESTAAT ──
// De rekenpoort in safecore.ts merkt betrouwbaar op dát de drie bedragen niet op elkaar aansluiten,
// en zegt dan: "excl + BTW ≠ totaal". Waar. Alleen: daar kan de ondernemer niets mee. Hij ziet drie
// getallen, weet dat er één fout is, en mag zelf de pdf induiken om uit te zoeken welke.
//
// Drie echte gevallen uit de praktijk, alle drie dezelfde melding en alle drie een ander verhaal:
//
//   A. Vleesgroothandel — excl 985,87 · BTW 88,73 · totaal 1.078,46 (verschil 3,86)
//      Op het papier: een btw-tabel met twee regels, 9% over 985,87 én 0% over 3,86 (E2-kratten,
//      in 6 en uit 5). De lezer nam de 9%-BASIS als "ex. BTW" en liet de 0%-regel vallen — terwijl
//      er letterlijk "ex. BTW € 989,73" onder staat.
//   B. Groothandel — excl 1.722,54 · BTW 144,95 · totaal 1.843,49 (verschil −24,00)
//      Op het papier: Subtotaal 1.610,34 + BTW 144,95 + Totaal Statiegeld 88,20. Het statiegeld
//      (0%) hoort in de grondslag; het excl-bedrag klopte niet.
//   C. Horeca — excl 3.413,92 · BTW 995,90 · totaal 3.819,82 (verschil −590,00)
//      Op het papier: BTW 9% € 233,20 + BTW 21% € 172,70 = € 405,90. Hier was juist de BTW fout.
//
// Eén patroon: een btw-SPECIFICATIEBLOK met MEER DAN ÉÉN regel — twee tarieven, of een 0%-post als
// statiegeld/emballage/kratten. De lezer pakt één regel in plaats van de som. Kratten en statiegeld
// zijn daarin geen rariteit maar de regel: in de horeca- en levensmiddelengroothandel staat er
// vrijwel altijd zo'n 0%-post onder de goederen.
//
// ── WAT DIT BESTAND WEL EN NIET DOET ──
// Het REPAREERT niets. Bedragen worden hier niet omgeklapt, niet herrekend en niet weggeschreven —
// dat is de geldkern, en daar beslist de mens. Wat het doet is de vraag omdraaien: in plaats van
// "er klopt iets niet, zoek het maar uit" rekent het uit wat elk van de twee mogelijke lezingen
// zou betekenen, en zegt welke daarvan volgens de Nederlandse tarieven überhaupt KAN.
//
// Dat laatste is de kern. Met drie getallen en één vergelijking is elk van de twee te "repareren"
// door de andere twee — dus rekenen alleen wijst niets aan. Maar het btw-TARIEF dat elke reparatie
// impliceert, moet tussen 0% en 21% liggen (geen Nederlands tarief ligt daarboven, dus geen mengsel
// ook). In geval C valt daarmee één lezing meteen af (35% bestaat niet) en blijft er precies één
// over — dan mag het scherm hem bij naam noemen. In A en B zijn beide lezingen legaal, en dan
// zeggen we dat eerlijk en laten we de keuze staan. Beslissen waar het niet kan is raden.

/** Dezelfde marge als de rekenpoort in safecore.ts — afrondingsruis op centen, niets meer. */
export const SUM_TOLERANCE = 0.02;

/** Het hoogste Nederlandse btw-tarief. Een mengsel van 0/9/21 komt hier nooit boven. */
const MAX_NL_RATE = 21;

export type BtwReconcile = {
  /** Sluiten de drie op elkaar aan? */
  ok: boolean;
  /** totaal − (excl + BTW). Positief = er ontbreekt iets in de uitsplitsing. */
  difference: number;
  /** Wat excl zou zijn als totaal en BTW kloppen. */
  impliedExcl: number;
  /** Wat de BTW zou zijn als totaal en excl kloppen. */
  impliedBtw: number;
  /** Het tarief dat die eerste lezing impliceert, in hele procenten. null als niet te bepalen. */
  exclRepairRate: number | null;
  /** Idem voor de tweede lezing. */
  btwRepairRate: number | null;
  /** Kan de eerste lezing volgens de Nederlandse tarieven? */
  exclRepairPossible: boolean;
  /** Kan de tweede lezing? */
  btwRepairPossible: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Het tarief in hele procenten, zoals safecore het ook afrondt. null bij een grondslag van 0. */
function rateOf(btw: number, base: number): number | null {
  if (!(base > 0)) return null;
  return Math.round((btw / base) * 100);
}

function possible(rate: number | null): boolean {
  return rate !== null && rate >= 0 && rate <= MAX_NL_RATE;
}

/**
 * Rijmt de drie bedragen, en zegt wat elk van de twee mogelijke lezingen zou betekenen.
 *
 * Het TOTAAL geldt daarbij als het vaste punt. Dat is geen willekeur: het totaal is wat er
 * daadwerkelijk betaald wordt, het staat het grootst afgedrukt, en het is het enige getal dat de
 * bankafschriften straks moeten matchen. In alle drie de praktijkgevallen hierboven klopte het
 * totaal en zat de fout in de uitsplitsing.
 */
export function reconcileBtw(
  excl: number | null | undefined,
  btw: number | null | undefined,
  incl: number | null | undefined,
): BtwReconcile {
  const ex = Number(excl ?? 0);
  const bt = Number(btw ?? 0);
  const inc = Number(incl ?? 0);

  const difference = round2(inc - (ex + bt));
  const impliedExcl = round2(inc - bt);
  const impliedBtw = round2(inc - ex);
  const exclRepairRate = rateOf(bt, impliedExcl);
  const btwRepairRate = rateOf(impliedBtw, ex);

  return {
    ok: Math.abs(inc - (ex + bt)) <= SUM_TOLERANCE,
    difference,
    impliedExcl,
    impliedBtw,
    exclRepairRate,
    btwRepairRate,
    exclRepairPossible: possible(exclRepairRate),
    btwRepairPossible: possible(btwRepairRate),
  };
}

/**
 * De andere helft van het probleem: de SOM klopt, maar het TARIEF kan niet.
 *
 * Vierde praktijkgeval, aardappelgroothandel: opgeslagen excl € 26,00 · BTW € 13,42 · totaal
 * € 39,42. Die drie sluiten netjes op elkaar aan, dus de rekenpoort zwijgt — alleen het tarief
 * schreeuwt (52%). Op het papier staat een netto-negatieve factuur: goederen 149,00 tegen 9%,
 * plus een geretourneerde container van −408,00 tegen 0%, samen "Totaal excl. BTW € -123,00" en
 * "Totaal te voldoen € -109,58". Alle drie de opgeslagen bedragen zijn dus fout, en juist daarom
 * kan de identiteit hier niets aanwijzen: hij klopt.
 *
 * Wat wél iets aanwijst is de BTW zelf. Die wordt zelden verkeerd gelezen (hij staat in een eigen
 * kolom, met een eigen kopje), en bij een BEKEND tarief hoort er precies één grondslag bij. Voor
 * € 13,42 is dat € 149,11 bij 9% — en op het papier staat 149,00. Eén regel die de eigenaar
 * meteen naar de goede kolom stuurt.
 *
 * Geeft de grondslag per Nederlands tarief, of null wanneer er niets te zeggen valt.
 */
export function impliedBasesForBtw(btw: number | null | undefined): { rate: number; base: number }[] {
  const b = Number(btw ?? 0);
  if (!Number.isFinite(b) || b === 0) return [];
  // 0% valt af: daar hoort per definitie geen btw-bedrag bij, dus levert het geen grondslag op.
  return [9, 21].map((rate) => ({ rate, base: round2(b / (rate / 100)) }));
}

/**
 * De aanvulling op "ongeldig BTW-tarief (x%)": bij welk bedrag excl. deze BTW wél zou kloppen.
 *
 * Bewust ZONDER het woord "moet". Het is een aanwijzing waar te kijken, geen oordeel over welk van
 * de bedragen fout is — dat kan hier niet worden vastgesteld.
 */
export function rateHint(btw: number | null | undefined, storedExcl: number | null | undefined): string | null {
  const bases = impliedBasesForBtw(btw);
  if (bases.length === 0) return null;
  const ex = Number(storedExcl ?? 0);
  const opties = bases.map((b) => `${eur(b.base)} bij ${b.rate}%`).join(" of ");
  return (
    `Een BTW van ${eur(Number(btw))} hoort bij een bedrag excl. van ${opties} — ` +
    `opgeslagen staat ${eur(ex)}. Staat er een 0%-post op de factuur (statiegeld, emballage, ` +
    `retour container)? Die hoort in het bedrag excl. mee te tellen, mét zijn teken.`
  );
}

/** € 1.234,56 — dezelfde notatie als het scherm, zodat de zin niet uit twee werelden komt. */
function eur(n: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
}

/**
 * De aanvulling op "excl + BTW ≠ totaal": het verschil, en wat er dan zou moeten staan.
 *
 * Geeft null wanneer de bedragen wél kloppen of wanneer er niets zinnigs te zeggen valt — dan
 * blijft de oude melding staan, en dat is beter dan een zin die suggereert dat wij het weten.
 */
export function reconcileHint(r: BtwReconcile): string | null {
  if (r.ok) return null;

  const verschil = `Verschil ${eur(Math.abs(r.difference))}`;

  // Precies één lezing kan — dan mag hij bij naam genoemd worden. Dit is geval C: een BTW van
  // € 995,90 zou 35% impliceren, en dat tarief bestaat niet, dus blijft er één over.
  if (r.btwRepairPossible && !r.exclRepairPossible) {
    return `${verschil}. Klopt het totaal, dan hoort de BTW ${eur(r.impliedBtw)} te zijn.`;
  }
  if (r.exclRepairPossible && !r.btwRepairPossible) {
    return `${verschil}. Klopt het totaal, dan hoort het bedrag excl. BTW ${eur(r.impliedExcl)} te zijn.`;
  }

  // Beide kunnen — dan noemen we ze allebei en kiezen we niet. Dit is geval A en B: rekenkundig is
  // er niets tegen beide, en een keuze zou raden zijn. De zin wijst wel de kant op waar het bij
  // dit soort facturen bijna altijd zit: een 0%-post (statiegeld, emballage, kratten) of een tweede
  // tarief dat niet in de uitsplitsing is meegenomen.
  if (r.exclRepairPossible && r.btwRepairPossible) {
    return (
      `${verschil}. Klopt het totaal, dan hoort excl. BTW ${eur(r.impliedExcl)} te zijn, ` +
      `óf de BTW ${eur(r.impliedBtw)}. Staat er een 0%-post op de factuur (statiegeld, emballage, ` +
      `kratten) of een tweede btw-tarief? Die hoort in de uitsplitsing mee te tellen.`
    );
  }

  // Geen van beide kan: dan is er meer mis dan één getal, en zwijgen we over reparaties.
  return `${verschil}. Geen van beide bedragen levert een geldig btw-tarief op — controleer de hele uitsplitsing.`;
}
