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
  if (rate == null || rate === "") return false;
  const n = Number(rate);
  return Number.isFinite(n) && (BTW_RATES as readonly number[]).includes(n);
}

/** Symmetrisch afronden op centen — negatieve bedragen (creditnota) rondt dezelfde kant op. */
export function round2(n: number): number {
  const v = Number(n) || 0;
  return (v < 0 ? -1 : 1) * (Math.round(Math.abs(v) * 100 + 1e-9) / 100);
}

/** Eén factuurregel, zoals beide routes hem aanleveren. */
export interface TotalsLine {
  /** Het opgeslagen regeltotaal (excl. BTW). Ontbreekt het, dan aantal × prijs. */
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

/** Het excl.-bedrag van één regel: het opgeslagen totaal, of anders aantal × prijs. */
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
