// src/lib/invoice-totals.ts
// [BTW-ROUND] De wettelijke totalen van een verkoopfactuur, op ÉÉN plek.
//
// Er waren er twee, en ze gaven verschillende antwoorden:
//   · /api/invoice/[id] PUT (opslaan van een concept) telde de BTW PER REGEL op en rondde één
//     keer af aan het eind;
//   · /api/invoice/send (uitgifte) groepeert het excl.-bedrag PER TARIEF, rondt de BTW van elk
//     tarief af, en telt die af-geronde bedragen op — de methode die de Belastingdienst/Peppol
//     voorschrijft en die de PDF (btwBreakdown) en de UBL-export óók gebruiken.
//
// Op een factuur met gemengde tarieven schelen die twee een cent (gemeten: 23,88 vs 23,89). Dat
// betekende dat het bedrag dat de ondernemer in de editor zag NIET het bedrag was dat hij
// verstuurde — send rekent bij uitgifte opnieuw — en dat het opgeslagen concept een cent afweek
// van de PDF die er straks uit komt. Een cent is klein; twee bronnen van waarheid over hetzelfde
// wettelijke bedrag zijn dat niet, en de send-route noemde de andere methode in zijn eigen
// commentaar al fout ("the old way").
//
// Dus: één functie, allebei de routes roepen hem aan, en ze kunnen nooit meer uit elkaar lopen.
// Puur — geen I/O. Draai de test met: npx tsx src/lib/invoice-totals.test.ts

/** De BTW-tarieven die in Nederland bestaan, en die de factuur-editor aanbiedt. */
export const BTW_RATES = [0, 9, 21] as const;
export type BtwRate = (typeof BTW_RATES)[number];

/**
 * Is dit een tarief dat op een Nederlandse factuur mag staan?
 *
 * `null`, `undefined` en `""` zijn NIET geldig, en dat is geen muggenzifterij: `Number(null)`
 * is 0, dus een ontbrekend tarief zou als "0%" door een naïeve check glippen — en 0% is een
 * echt tarief met een echte betekenis (vrijgesteld/verlegd). Een ontbrekend tarief stilzwijgend
 * als 0% lezen zet de BTW van een gewone factuur op nul. Ontbreekt het, dan hoort de aanroeper
 * ernaar te vragen, niet te gokken.
 */
export function isValidBtwRate(rate: unknown): rate is BtwRate {
  // [TARIEF-STRIKT] The header above names three values that must not pass — null, undefined and
  // "" — and the guard used to name exactly those. That is one short of the problem: Number()
  // turns `" "`, `[]` and `false` into 0 as well, and 0 is a REAL rate. Measured: all three were
  // accepted as a legal 0% tarief by this very function.
  //
  // So the question is not "which values do I know to refuse" but "what IS a rate": a number (a
  // JSON body, a database row) or the text of one (a form field). Nothing else — and that closes
  // the class instead of naming three more members of it.
  if (typeof rate !== "number" && typeof rate !== "string") return false;
  if (typeof rate === "string" && rate.trim() === "") return false;
  const n = Number(rate);
  return Number.isFinite(n) && (BTW_RATES as readonly number[]).includes(n);
}

/**
 * [CENT] Afronden op centen. DE plek — er is er precies één, en dat is geen nettigheid.
 *
 * Er waren er vijf, met vier verschillende antwoorden, en ze stonden allemaal op een geldpad:
 *
 *   A  Math.round(n * 100) / 100                       ai · e-invoice · statement-reconcile ·
 *                                                      btw-reconcile · btw-split · money-invariants ·
 *                                                      bank-statement-balance
 *   B  Math.round((n + Number.EPSILON) * 100) / 100    ubl-export · vier publieke rekenhulpen
 *   C' sign * Math.round(|n| * 100) / 100              snelstart-mapping
 *   D  Math.round(n * 100 + 1e-9) / 100                unit-price-display
 *   E  deze                                            invoice-totals (concept, uitgifte, PDF, scherm)
 *
 * Twee dingen gaan er mis, en ze zijn allebei gemeten, niet bedacht:
 *
 * 1. HET HALVE CENT DAT WEGVALT. Een bedrag als 21,50 × 21% is in binaire drijvende komma niet
 *    4,515 maar 4,514999999999999, dus `Math.round(x * 100)` rondt naar BENEDEN. Dat is A, B én C'
 *    (EPSILON is 2,2e-16 en veel te klein om dit te halen). Over alle bedragen tot € 5.000 bij 9%
 *    en 21% gebeurt dat 492 keer. Niet exotisch: 21,50 · 22,50 · 26,50 · 46,50 — elke prijs op een
 *    halve euro.
 *
 * 2. DE CREDITNOTA DIE GEEN SPIEGELBEELD IS. `Math.round(-0.5)` is −0, dus A en B ronden een
 *    negatief half cent naar NUL terwijl ze het positieve naar boven ronden. Een creditnota van
 *    hetzelfde bedrag is dan een cent kleiner dan de factuur die hij terugneemt.
 *
 * Deze versie doet allebei goed: het teken gaat er eerst af (symmetrisch), en de 1e-9 haalt het
 * halve cent terug dat de drijvende komma kwijtraakte. 1e-9 is groot genoeg voor de ruis van een
 * vermenigvuldiging (die zit rond 1e-13 op bedragen van deze grootte) en klein genoeg om nooit een
 * echt bedrag te verschuiven: pas bij een verschil van 1e-11 cent kantelt hij.
 *
 * Niet-eindige invoer wordt 0. Een Infinity of NaN die als bedrag doorloopt komt uiteindelijk op
 * een factuur, in een CSV of in een aangifte terecht, en "€ 0,00" is daar het enige antwoord dat
 * niemand verkeerd kan lezen.
 */
export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return (v < 0 ? -1 : 1) * (Math.round(Math.abs(v) * 100 + 1e-9) / 100);
}

/**
 * Eén factuurregel, zoals beide routes hem aanleveren.
 *
 * [REGEL-KORTING] `line_total` is het NETTO bedrag — aantal × prijs MIN de korting die op de regel
 * zelf zit (invoice_line_discount.sql). Dat is de afspraak van de kolom, en hij is met opzet zo
 * gekozen: een lezer die van regelkortingen nooit heeft gehoord telt line_total op en komt op het
 * juiste bedrag uit. Deze functie is zo'n lezer.
 *
 * Daarom trekt de terugval hieronder GEEN korting af, en daarom moet elke aanroeper die met
 * kortingen te maken kan hebben `line_total` meesturen. Wie een korting wél door de som heen wil
 * laten rekenen gebruikt applyDiscount uit invoice-discount.ts; dat is de enige plek waar een
 * korting wordt AFGETROKKEN, precies één keer.
 */
export interface TotalsLine {
  /** Het opgeslagen regeltotaal (excl. BTW), al NETTO. Ontbreekt het, dan aantal × prijs. */
  line_total?: number | null;
  quantity?: number | null;
  unit_price?: number | null;
  btw_rate?: number | null;
}

export interface InvoiceTotals {
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
}

/**
 * Het excl.-bedrag van één regel: het opgeslagen totaal, of anders aantal × prijs.
 *
 * [REGEL-KORTING] Die terugval WEET NIETS VAN REGELKORTING, en dat is geen slordigheid maar de
 * grens van deze module: `line_total` is per afspraak al NETTO (invoice_line_discount.sql), dus wie
 * hem meegeeft heeft de korting er allang af. Alle drie de aanroepers doen dat ook — draft-totals
 * en de PUT rekenen hem eerst uit met `lineNetEx`, en de verstuurroute leest hem uit de database.
 * Nagelopen, niet aangenomen.
 *
 * Maar wie ooit regels ZONDER `line_total` doorgeeft — een nieuw voorbeeldscherm dat rechtstreeks
 * uit een formulier rekent, bijvoorbeeld — krijgt hier stilzwijgend de VOLLE prijs terug, en dan
 * staat er een korting op het scherm die niet in het bedrag zit. Reken hem in dat geval eerst uit
 * met `lineNetEx` uit invoice-discount.ts; die module kent de kortingskolommen wel.
 *
 * Waarom niet gewoon hier `lineNetEx` aanroepen: invoice-discount.ts haalt `round2` uit dit
 * bestand, dus dat zou een importcirkel maken tussen de twee modules die samen al het geld
 * uitrekenen. Een waarschuwing op de juiste plek is dat niet waard.
 */
function lineEx(l: TotalsLine): number {
  return typeof l.line_total === "number" ? l.line_total : (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
}

/**
 * De drie wettelijke totalen, gerekend PER TARIEF.
 *
 * Het teken van de regels blijft staan, dus een creditnota (negatieve regels) komt er negatief
 * uit — dezelfde tekenafspraak als de rest van de app ([BOEK-031]).
 *
 * Een lege regelset geeft nullen terug; de aanroeper beslist of dat mag (uitgifte mag het niet).
 */
export function computeInvoiceTotals(lines: TotalsLine[]): InvoiceTotals {
  const exByRate = new Map<number, number>();
  for (const l of lines) {
    const rate = Number(l.btw_rate) || 0;
    exByRate.set(rate, (exByRate.get(rate) ?? 0) + lineEx(l));
  }
  const ex = round2([...exByRate.values()].reduce((s, e) => s + e, 0));
  const btw = round2([...exByRate.entries()].reduce((s, [rate, e]) => s + round2((e * rate) / 100), 0));
  return { total_ex_btw: ex, btw_amount: btw, total_inc_btw: round2(ex + btw) };
}
