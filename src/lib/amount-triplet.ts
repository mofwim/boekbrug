// src/lib/amount-triplet.ts
// [BEDRAG-DRIELUIK] De drie bedragen van een factuur, waarbij excl + BTW = totaal ALTIJD klopt.
// Puur, geen I/O.
//
// ── WAAROM DIT BESTAAT ──
// Het bevestigscherm liet de ondernemer twee velden invullen — excl. BTW en BTW — en rekende het
// totaal eruit. Die keuze garandeert de identiteit (excl + BTW = totaal kán niet meer misgaan) en
// dat is waardevol. Maar hij staat haaks op hoe een factuur eruitziet.
//
// Op papier is het TOTAAL het betrouwbaarste getal dat er staat: het is wat je overmaakt, het staat
// vetgedrukt onderaan ("Totaal te voldoen", "Totaal te betalen"), en het is het enige bedrag dat je
// bankafschrift straks moet matchen. Het bedrag EXCLUSIEF is juist het lastigste: op één factuur
// staan zomaar vier kandidaten — "Subtotaal", "basis", "Ex. BTW", "Totaal exclusief BTW" — en op
// de vier facturen die dit bestand veroorzaakten was het steeds precies dát getal dat verkeerd was
// gelezen.
//
// Wie zo'n factuur kwam corrigeren moest dus het betrouwbaarste getal van de pagina NIET invullen,
// en in plaats daarvan uit z'n hoofd 1.078,46 − 88,73 = 989,73 uitrekenen om bij hetzelfde
// eindbedrag uit te komen. Dat is de app die de mens laat rekenen, terwijl het andersom hoort.
//
// ── DE REGEL ──
// Alle drie de velden zijn invulbaar, en na élke wijziging klopt de identiteit exact. Wat er
// meebeweegt hangt af van wat je aanraakt:
//
//   · typ je EXCL   → het totaal beweegt mee (de BTW blijft staan)
//   · typ je BTW    → het totaal beweegt mee (het excl-bedrag blijft staan)
//   · typ je TOTAAL → het EXCL-bedrag beweegt mee (de BTW blijft staan)
//
// In alle drie de gevallen blijft de BTW staan tenzij je hem zelf aanraakt. Dat is geen willekeur:
// de BTW staat op vrijwel elke factuur in een eigen kolom met een eigen kopje, wordt daardoor het
// betrouwbaarst gelezen, en is bovendien het bedrag dat rechtstreeks de aangifte in gaat als
// voorbelasting. Van de drie is dat het getal dat je het minst wilt zien verspringen.
//
// Voor de aardappelfactuur betekent dit: typ totaal −109,58 en BTW 13,42, en het excl-bedrag wordt
// vanzelf −123,00 — exact wat er op het papier staat.

export type AmountTriplet = {
  /** Bedrag exclusief BTW. Mag negatief zijn (creditnota / netto-retour). */
  ex: number;
  /** Het BTW-bedrag. */
  btw: number;
  /** Het eindtotaal — wat er betaald wordt. */
  incl: number;
};

/** Onleesbare invoer telt als 0, zodat een half getypt veld nooit NaN de rekensom in duwt. */
function num(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Het excl-bedrag is gewijzigd. Het totaal beweegt mee; de BTW blijft staan.
 *
 * Niet afgerond: `ex + btw` is per definitie precies het totaal, en afronden zou hier centen
 * kunnen laten ontstaan of verdwijnen die niemand heeft ingetypt.
 */
export function setExcl(t: AmountTriplet, ex: number | null | undefined): AmountTriplet {
  const nx = num(ex);
  return { ex: nx, btw: t.btw, incl: nx + t.btw };
}

/** De BTW is gewijzigd. Het totaal beweegt mee; het excl-bedrag blijft staan. */
export function setBtw(t: AmountTriplet, btw: number | null | undefined): AmountTriplet {
  const nb = num(btw);
  return { ex: t.ex, btw: nb, incl: t.ex + nb };
}

/**
 * Het TOTAAL is gewijzigd — het nieuwe geval. Het excl-bedrag beweegt mee; de BTW blijft staan.
 *
 * Dit is de richting die de vier vastgelopen facturen in één keer oplost: het totaal en de BTW
 * staan allebei letterlijk op het papier, en het bedrag waar de lezer over struikelde volgt
 * vanzelf.
 */
export function setIncl(t: AmountTriplet, incl: number | null | undefined): AmountTriplet {
  const ni = num(incl);
  return { ex: ni - t.btw, btw: t.btw, incl: ni };
}

/**
 * Klopt de identiteit? Zelfde marge als de rekenpoort in safecore.
 *
 * Bedoeld als vangnet in een test, niet als iets dat het scherm hoeft te controleren: de drie
 * functies hierboven kunnen hem per constructie niet breken.
 */
export function tripletHolds(t: AmountTriplet): boolean {
  return Math.abs(t.ex + t.btw - t.incl) <= 0.02;
}
