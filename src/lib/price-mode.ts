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
// € 10,00 incl. bij 21% is € 8,264462809917355… ex. Die breuk wordt NIET afgerond opgeslagen in
// unit_price — afronden op de PRIJS zou € 8,26 × aantal opleveren en dat is een heel andere
// factuur dan wat de ondernemer beloofde.
//
// Het REGELTOTAAL wordt wél afgerond, en het koptotaal is de som van die afgeronde regels. Zie de
// kop van draft-totals.ts voor de meting; kort gezegd moet het bedrag onder de kolom optelbaar
// zijn uit de kolom zelf, anders klopt de factuur niet tegen zichzelf en weigert een Peppol access
// point het bestand (BR-CO-10).
//
// DAT KOST SOMS EEN CENT, EN DIE CENT IS ECHT. "€ 0,90 all-in" × 150 stuks bij 9% kan geen
// document opleveren dat én optelt én precies op € 395,00 uitkomt: er bestaat geen ex-bedrag met
// twee decimalen waarvoor X + round2(0,09X) = 395,00 (362,38 geeft 394,99 en 362,39 geeft 395,01).
// Dat is rekenkunde, geen fout, en het is niet op te lossen — alleen te tonen. Daarom rekent het
// scherm sinds [REGEL-AFRONDING] met dezelfde afgeronde regels als de server: je ziet die € 394,99
// terwijl je typt, in plaats van hem te ontdekken op de factuur die je klant al heeft.
//
// Wie exact € 395,00 wil factureren, past één regelprijs een cent aan en ziet het totaal meteen
// meebewegen. Dat is een keuze van de ondernemer over zijn eigen prijs, en die hoort bij hem —
// niet bij een afrondingsregel die het verschil wegmoffelt.

import { round2 } from './invoice-totals'

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

// [PRIJSVELD-CENT] Zie priceFieldValue: het veld toont net zoveel decimalen als de regel nodig
// heeft, en unitPriceDecimals is dezelfde functie die de PDF en de prijskolom daarvoor gebruiken.
// Eén antwoord op "hoe schrijf je deze stuksprijs op", op alle drie de plekken.
// [CENT] roundTo komt uit dezelfde module. Er stond hier een eigen versie zonder de 1e-9, en dat
// is precies de fout die [PRIJSVELD-CENT] hierboven beschrijft, één laag dieper: unitPriceDecimals
// KIEST het aantal decimalen met de ene afronding, dit veld PAST het toe met de andere. Op een
// opgeslagen prijs van € 1,005 kiest hij 2 decimalen omdat 1,01 het regeltotaal oplevert, en toont
// het veld 1,00 — een prijs die niet met zijn eigen regel vermenigvuldigt, en die de opgeslagen
// breuk vervangt zodra iemand het veld aanraakt.
import { unitPriceDecimals, roundTo } from "./unit-price-display";

/** Op centen, voor weergave. Nooit voor opslag — zie de afrondingsnotitie in de kop. */
export function toDisplayCents(value: number): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return round2(v);
}

/**
 * Wat er in het prijsveld van een regel MOET STAAN, gegeven de opgeslagen ex-prijs en de modus.
 *
 * [PRIJSVELD-CENT] Dit stond op centen, en die aanname klopt precies zo lang als de ondernemer
 * zijn prijzen EXCLUSIEF btw intypt. Typt hij ze INCLUSIEF — wat dit scherm aanbiedt en wat een
 * horecazaak altijd doet — dan is de opgeslagen ex-prijs een breuk, en op centen afronden is een
 * ANDERE PRIJS.
 *
 * Gemeten op factuur 20260001, vier regels, prijzen ingetypt als € 0,90 / € 1,90 / € 1,75 all-in
 * bij 9%:
 *
 *     opgeslagen ex   het veld toonde   150 x 0,83 = 124,50   maar de regel is 123,85
 *     0,8256880734    0,83              100 x 1,74 = 174,00   maar de regel is 174,31
 *     1,7431192661    1,74               38 x 1,61 =  61,18   maar de regel is  61,01
 *     1,6055045872    1,61                6 x 1,61 =   9,66   maar de regel is   9,63
 *
 * Twee dingen tegelijk mis. Het veld toonde een prijs die niet met zijn EIGEN regeltotaal
 * vermenigvuldigt — dezelfde fout die de PDF en de prijskolom al hadden en die daar met
 * unitPriceDecimals is opgelost. En zodra er íets in dat veld terechtkwam, verving die afgeronde
 * prijs de opgeslagen breuk: het bewerkscherm gaf € 368,69 waar de verstuurde factuur € 368,80
 * zegt, en bij grotere aantallen loopt dat op tot boven een euro.
 *
 * Dus: net zoveel decimalen als de regel NODIG heeft, en geen meer. Twee blijft twee zolang twee
 * klopt — een gewone prijs van € 12,50 verandert niet in "12,5000".
 */
export function priceFieldValue(
  ex: number,
  rate: number | null | undefined,
  mode: PriceMode,
  // Optioneel, en met opzet als LAATSTE argumenten: een aanroeper die ze niet meestuurt krijgt
  // exact het gedrag van hiervoor terug, op de cent.
  quantity?: number | null,
  lineTotal?: number | null,
): number {
  const shown = mode === "incl" ? inclFromEx(ex, rate) : ex;
  if (quantity === undefined || quantity === null) return toDisplayCents(shown);
  // Het regeltotaal hoort bij de MODUS: in incl-modus moet aantal x incl-prijs het bedrag
  // inclusief btw opleveren, anders zoekt de functie naar een getal dat er niet is.
  const target = lineTotal === undefined || lineTotal === null
    ? undefined
    : mode === "incl" ? inclFromEx(Number(lineTotal), rate) : Number(lineTotal);
  const decimals = unitPriceDecimals(shown, quantity, target);
  return roundTo(shown, decimals);
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
