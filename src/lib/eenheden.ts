// src/lib/eenheden.ts
// [EENHEID] De eenheid op een factuurregel — en de code die er in een e-factuur van moet worden.
// Run: npx tsx --test src/lib/eenheden.test.ts
//
// ═══ WAAROM DIT BESTAAT ═══
//
// Op een PDF is "2 uur" gewoon tekst; een mens leest het. In een E-FACTUUR is het een CODE, en
// die code is genormeerd: Peppol BIS Billing 3.0 eist dat @unitCode uit UN/ECE Recommendation 20
// (rev. 11) komt. Een ontvangend boekhoudpakket leest die code, niet ons Nederlandse woord.
//
// ═══ DE FOUT DIE HIER WORDT GEREPAREERD ═══
//
// ubl-export.ts schreef `unitCode="C62"` op ELKE regel, ongeacht wat er stond. C62 betekent
// "one / stuk". Dat is juist voor een product, en FOUT voor:
//
//   · 2 uur arbeid       → moet HUR zijn, stond als "2 stuks"
//   · 14 m² schilderwerk → moet MTK zijn, stond als "14 stuks"
//   · 5 km reiskosten    → moet KMT zijn, stond als "5 stuks"
//
// Geen bedrag verandert daardoor — het TOTAAL blijft kloppen — maar de e-factuur beschrijft iets
// anders dan er is geleverd. Bij een controle of een geschil is dat het document dat telt.
//
// De catalogus had al een `unit`-veld, maar dat was VRIJE TEKST die niemand las: "uur", "Uur",
// "u", "stuk", "st." en "" leidden allemaal tot exact dezelfde C62. Deze module maakt er een
// gesloten lijst van, met één vertaler naar de norm.
//
// ═══ DE FAALRICHTING ═══
//
// Onbekende of lege eenheid → C62. Dat is niet mooi maar het is wat er nu al gebeurt, dus geen
// enkele bestaande factuur verandert van betekenis door deze module toe te voegen. Wie een
// eenheid KIEST krijgt vanaf nu de juiste code; wie niets kiest houdt precies wat hij had.

/** De eenheden die op een factuurregel van een ZZP'er voorkomen. Bewust kort. */
export interface Eenheid {
  /** Wat er in de app en op de PDF staat. */
  naam: string;
  /** De code uit UN/ECE Rec 20 rev. 11 — dit is wat er in de e-factuur komt. */
  code: string;
  /** Meervoud voor de leesbaarheid op een regel ("2 uur", "3 stuks"). */
  meervoud?: string;
}

/**
 * De gesloten lijst. Elke code is nagekeken tegen UN/ECE Rec 20 rev. 11.
 *
 * Kort houden is een keuze: een lijst van 400 codes maakt het kiezen moeilijker dan het typen,
 * en 99% van de facturen in dit product gebruikt de eerste vier. Mist er een eenheid, dan is dat
 * één regel erbij — maar wel BEWUST, met de code opgezocht en niet geraden.
 */
export const EENHEDEN: readonly Eenheid[] = [
  { naam: "stuk", code: "C62", meervoud: "stuks" },
  { naam: "uur", code: "HUR", meervoud: "uur" },
  { naam: "dag", code: "DAY", meervoud: "dagen" },
  { naam: "maand", code: "MON", meervoud: "maanden" },
  { naam: "m²", code: "MTK" },
  { naam: "m¹", code: "MTR" },
  { naam: "km", code: "KMT" },
  { naam: "kg", code: "KGM" },
  { naam: "liter", code: "LTR" },
  // [SET] Een set/paar telt als één geleverd geheel. E96 = 'set'.
  { naam: "set", code: "E96", meervoud: "sets" },
];

/** De code die op een regel ZONDER gekozen eenheid komt — precies wat er vandaag al gebeurt. */
export const STANDAARD_CODE = "C62";

/**
 * Vertaalt wat er in `artikelen.unit` / `invoice_lines` staat naar een UN/ECE-code.
 *
 * Verdraagzaam met opzet: het veld was jarenlang vrije tekst, dus er staat "uur", "Uur", "u",
 * "st", "stuks", "m2" en van alles door elkaar in de bestaande gegevens. Die willen we alsnog
 * goed vertalen — een oude factuur opnieuw exporteren mag niet slechter worden dan hij was.
 *
 * Onbekend of leeg → STANDAARD_CODE. Nooit een gok: een verzonnen code is erger dan de code
 * die er nu al staat, want dan beschrijft de e-factuur iets specifieks dat niet klopt.
 */
export function eenheidCode(unit: string | null | undefined): string {
  const s = (unit ?? "").trim().toLowerCase();
  if (!s) return STANDAARD_CODE;

  // Exacte naam uit de lijst (inclusief meervoud).
  for (const e of EENHEDEN) {
    if (s === e.naam.toLowerCase()) return e.code;
    if (e.meervoud && s === e.meervoud.toLowerCase()) return e.code;
  }
  // Iemand die de CODE zelf heeft ingetypt.
  const alsCode = EENHEDEN.find((e) => e.code.toLowerCase() === s);
  if (alsCode) return alsCode.code;

  return SYNONIEMEN[s] ?? STANDAARD_CODE;
}

/**
 * De schrijfwijzen die in vrije tekst voorkomen.
 *
 * Deze staan hier BUITEN de functie zodat isBekendeEenheid() ze ook kan raadplegen. Stonden ze
 * binnenin, dan moest die tweede functie de kennis dupliceren — en dan groeit er ooit één van de
 * twee mee en de ander niet.
 */
const SYNONIEMEN: Readonly<Record<string, string>> = {
  "u": "HUR", "uren": "HUR", "hr": "HUR", "h": "HUR",
  "st": "C62", "st.": "C62", "stk": "C62", "stks": "C62", "x": "C62",
  "m2": "MTK", "m^2": "MTK", "vierkante meter": "MTK",
  "m": "MTR", "m1": "MTR", "meter": "MTR", "strekkende meter": "MTR",
  "kilometer": "KMT", "kilometers": "KMT",
  "kilo": "KGM", "kilogram": "KGM",
  "l": "LTR", "ltr": "LTR", "liters": "LTR",
  "dagen": "DAY", "mnd": "MON", "maanden": "MON",
  "paar": "E96",
};

/**
 * De naam zoals hij op het scherm en de PDF hoort te staan, gegeven een aantal.
 *
 * ONBEKENDE TEKST BLIJFT STAAN ZOALS DE GEBRUIKER HEM SCHREEF. Dat lijkt vanzelfsprekend, maar
 * de eerste versie deed het fout en de test ving het: "rol" vertaalt naar C62 (de terugval), en
 * wie dán de eenheid bij die code opzoekt vindt "stuk" — dus "2 rol" werd op het scherm "2
 * stuks". Dat is geen weergave meer maar een stille wijziging in iemands factuur.
 *
 * De vraag is dus niet "welke code hoort hierbij" maar "KEN ik dit woord". Alleen dan mag het
 * worden vervangen door de nette schrijfwijze.
 */
export function eenheidLabel(unit: string | null | undefined, aantal = 1): string {
  const s = (unit ?? "").trim();
  if (!s) return "";
  if (!isBekendeEenheid(s)) return s;
  const e = EENHEDEN.find((x) => x.code === eenheidCode(s));
  if (!e) return s;
  // Bij precies 1 altijd het enkelvoud; anders het meervoud als dat er is.
  return aantal === 1 ? e.naam : (e.meervoud ?? e.naam);
}

/**
 * Kent de app deze eenheid, of is het vrije tekst uit het verleden?
 *
 * Let op de valkuil die hier zat: "eenheidCode() !== C62" is GEEN goede toets, want 'stuk' is
 * een volkomen bekende eenheid die juist C62 oplevert. Het antwoord moet komen uit de vraag
 * "staat dit woord ergens in mijn lijst?", niet uit de uitkomst van de vertaling.
 */
export function isBekendeEenheid(unit: string | null | undefined): boolean {
  const s = (unit ?? "").trim().toLowerCase();
  if (!s) return false;
  if (s in SYNONIEMEN) return true;
  return EENHEDEN.some(
    (e) =>
      e.naam.toLowerCase() === s ||
      e.meervoud?.toLowerCase() === s ||
      e.code.toLowerCase() === s,
  );
}
