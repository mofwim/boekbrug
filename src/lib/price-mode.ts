// src/lib/price-mode.ts
// [PRIJS-MODUS] Typ je prijzen INCLUSIEF of EXCLUSIEF btw? Eén pure omrekening, gedeeld door het
// aanmaakscherm en het bewerkscherm, zodat die twee nooit een andere prijs uit hetzelfde getal
// kunnen halen.
//
// WAAROM DIT BESTAAT. Een deel van de klanten werkt met prijzen inclusief btw (horeca, retail, een
// vast tarief "€ 50 all-in"). Die ondernemer moest tot nu toe eerst zelf de btw eruit rekenen —
// € 50 / 1,21 = € 41,3223… — en dát getal in de regel typen. Elke factuur begon dus met een
// deling op een rekenmachine, en elke afronding daarvan werd een cent verschil op het bedrag dat
// zijn klant uiteindelijk ziet.
//
// WAT DEZE MODUS NIET VERANDERT — en dat is het belangrijkste aan dit bestand:
// er verandert NIETS aan wat er wordt opgeslagen. invoice_lines.unit_price blijft de prijs
// EXCLUSIEF btw, line_total blijft exclusief, en de kop (total_ex_btw / btw_amount /
// total_inc_btw) blijft precies zoals hij was. Alles wat daarna komt leest ex-btw: de
// rubriekensplitsing van de aangifte (btw-rate-split.ts), de PDF, het sluitpakket, de export naar
// de boekhouder. Een "incl-factuur" in de database zou al die lezers stilzwijgend van betekenis
// laten veranderen. Dit is dus een INVOERSTAND, geen opslagformaat.
//
// DE AFRONDING, EXPLICIET. Bij het intypen van een inclusief bedrag is de ex-prijs zelden rond:
// € 10,00 incl. bij 21% is € 8,264462809917355… ex. Die waarde wordt NIET afgerond opgeslagen,
// want dan betaalt de klant € 9,99 terwijl de ondernemer € 10,00 heeft ingetypt — een cent die
// niemand kan verklaren en die je pas ziet als de factuur al verstuurd is. Het bedrag dat je
// intypt, is het bedrag dat je klant betaalt; het scherm toont de ex-prijs afgerond op centen
// (want dat is wat een prijs is), de berekening houdt de exacte breuk vast. Dat is dezelfde keuze
// die dit scherm al maakte: ook zonder deze modus worden de koptotalen onafgerond weggeschreven
// (3 × € 33,33 → btw € 20,9979).

export type PriceMode = "excl" | "incl";

/** Een tarief als factor: 21 → 1.21. Onbekend/kapot tarief telt als 0% (geen stille verhoging). */
function factor(rate: number | null | undefined): number {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return 1;
  return 1 + r / 100;
}

/** Van een prijs INCLUSIEF btw naar de prijs exclusief — de waarde die wordt opgeslagen. */
export function exFromIncl(incl: number, rate: number | null | undefined): number {
  const v = Number(incl);
  if (!Number.isFinite(v)) return 0;
  return v / factor(rate);
}

/** Van de opgeslagen prijs EXCLUSIEF btw naar wat de klant betaalt. */
export function inclFromEx(ex: number, rate: number | null | undefined): number {
  const v = Number(ex);
  if (!Number.isFinite(v)) return 0;
  return v * factor(rate);
}

/** Op centen, voor weergave. Nooit voor opslag — zie de afrondingsnotitie in de kop. */
export function toDisplayCents(value: number): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Wat er in het prijsveld van een regel MOET STAAN, gegeven de opgeslagen ex-prijs en de modus.
 *
 * Afgerond op centen, omdat het veld een prijs toont en niet een breuk: in incl-modus is dat exact
 * het bedrag dat de ondernemer zelf intypte (10 → 8,2644…/ex → 10,00 terug), dus het heen-en-weer
 * is stabiel zolang hij in dezelfde modus blijft.
 */
export function priceFieldValue(ex: number, rate: number | null | undefined, mode: PriceMode): number {
  return toDisplayCents(mode === "incl" ? inclFromEx(ex, rate) : ex);
}

/**
 * Wat er wordt OPGESLAGEN als iemand een getal in het prijsveld typt.
 *
 * In excl-modus is dat het getal zelf (ongewijzigd gedrag). In incl-modus de exacte breuk — niet
 * afgerond, zodat het totaal precies uitkomt op wat er is ingetypt.
 */
export function priceFieldToStored(typed: number, rate: number | null | undefined, mode: PriceMode): number {
  const v = Number(typed);
  if (!Number.isFinite(v)) return 0;
  return mode === "incl" ? exFromIncl(v, rate) : v;
}

/**
 * Een regel krijgt een ander btw-tarief. Wat blijft er staan?
 *
 * Dit is de vraag waar de modus echt over gaat, en het antwoord is verschillend per modus:
 *   · excl — de prijs die je intypte blijft staan, het totaal inclusief btw beweegt mee. Precies
 *     zoals het scherm zich altijd gedroeg.
 *   · incl — je verkoopt voor "€ 50 all-in". Verandert het tarief, dan blijft die € 50 staan en
 *     verandert je marge; anders zou een tik op het tarief-menu stilletjes de prijs veranderen die
 *     je klant betaalt, terwijl het veld nog steeds 50 laat zien.
 *
 * Geeft de nieuwe op te slaan ex-prijs terug.
 */
export function repriceForRateChange(
  storedEx: number,
  oldRate: number | null | undefined,
  newRate: number | null | undefined,
  mode: PriceMode,
): number {
  if (mode !== "incl") return storedEx;
  return exFromIncl(inclFromEx(storedEx, oldRate), newRate);
}
