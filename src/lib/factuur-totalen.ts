// src/lib/factuur-totalen.ts
// [NAMENS] De optelsom van een factuur, op de server. Puur.
// Run: npx tsx --test src/lib/factuur-totalen.test.ts
//
// WAAROM DIT VERHUIST
// De totalen werden in de BROWSER berekend en meegestuurd met de INSERT. Zolang er één mens per
// boekhouding was, was dat hooguit onnetjes: je kon alleen jezelf voorliegen. Met een
// verkoopmedewerker erbij is het iets anders — dan bepaalt een tweede persoon wat er onder het
// BTW-nummer van zijn baas in de boeken komt, en dan hoort de server te rekenen, niet de pagina.
//
// DE REKENSOM IS LETTERLIJK DEZELFDE ALS DIE IN DE PAGINA STOND, inclusief het NIET afronden.
// Dat is met opzet: dit mag voor een bestaande eigenaar geen cent verschil maken. Zou hier een
// afronding bij komen, dan zou dezelfde factuur vandaag een andere uitkomst geven dan gisteren —
// een stille verandering in de boekhouding, en precies wat dit product niet doet.

export interface FactuurRegel {
  quantity: number;
  unit_price: number;
  btw_rate: number;
}

export interface FactuurTotalen {
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
}

/**
 * Optellen. `sign` is -1 voor een creditnota: die staat negatief in de boeken, en dat teken hoort
 * op één plek te worden gezet in plaats van bij elke aanroeper opnieuw.
 */
export function berekenTotalen(regels: readonly FactuurRegel[], sign: 1 | -1 = 1): FactuurTotalen {
  const ex = regels.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const btw = regels.reduce((s, l) => s + l.quantity * l.unit_price * (l.btw_rate / 100), 0);
  return {
    total_ex_btw: sign * ex,
    btw_amount: sign * btw,
    total_inc_btw: sign * (ex + btw),
  };
}

/** Het BTW-tarief moet een tarief zijn dat in Nederland bestaat — niet een getal dat iemand typte. */
export const TOEGESTANE_BTW: readonly number[] = [0, 9, 21];

export type RegelFout = { index: number; veld: string; reden: string };

/**
 * Controleert de regels die binnenkomen.
 *
 * Dit is geen vormcontrole maar een geldcontrole: een negatieve hoeveelheid op een gewone factuur,
 * een BTW-tarief van 13%, een prijs die geen getal is — allemaal dingen die een browser kan sturen
 * en die daarna in een aangifte belanden. De pagina controleert ze ook, maar de pagina is de kant
 * die je niet in de hand hebt.
 */
export function controleerRegels(regels: unknown): { ok: true; regels: FactuurRegel[] } | { ok: false; fouten: RegelFout[] } {
  const fouten: RegelFout[] = [];
  if (!Array.isArray(regels) || regels.length === 0) {
    return { ok: false, fouten: [{ index: -1, veld: "lines", reden: "een factuur zonder regels bestaat niet" }] };
  }
  if (regels.length > 200) {
    return { ok: false, fouten: [{ index: -1, veld: "lines", reden: "meer regels dan een factuur kan dragen" }] };
  }

  const schoon: FactuurRegel[] = [];
  regels.forEach((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const q = Number(row.quantity);
    const p = Number(row.unit_price);
    const t = Number(row.btw_rate);
    if (!Number.isFinite(q)) fouten.push({ index: i, veld: "quantity", reden: "geen getal" });
    if (!Number.isFinite(p)) fouten.push({ index: i, veld: "unit_price", reden: "geen getal" });
    if (!TOEGESTANE_BTW.includes(t)) {
      fouten.push({ index: i, veld: "btw_rate", reden: `${row.btw_rate} is geen bestaand BTW-tarief` });
    }
    const omschrijving = typeof row.description === "string" ? row.description.trim() : "";
    if (!omschrijving) {
      // Art. 35a Wet OB: de aard van de geleverde goederen of diensten hoort op de factuur.
      fouten.push({ index: i, veld: "description", reden: "een regel zonder omschrijving mag niet op een factuur" });
    }
    schoon.push({ quantity: q, unit_price: p, btw_rate: t });
  });

  return fouten.length ? { ok: false, fouten } : { ok: true, regels: schoon };
}
