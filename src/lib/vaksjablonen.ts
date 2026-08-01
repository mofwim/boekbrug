// src/lib/vaksjablonen.ts
// [VAK] Startbundels voor de artikelencatalogus — de regels van jouw vak, met het JUISTE tarief.
// Run: npx tsx --test src/lib/vaksjablonen.test.ts
//
// ═══ WAAROM DIT BESTAAT ═══
//
// De catalogus werkt al: typ in een factuurregel en je eigen artikelen komen als suggestie
// omhoog. Maar hij begint LEEG. Iedereen typt zijn eerste regels zelf, in zijn eigen woorden, met
// een tarief dat hij zelf kiest — en dat laatste is geen smaakkwestie.
//
// In de mechanica bestaan abonnementen (HaynesPro, Autodata, TecDoc) die precies dit oplossen:
// je krijgt de juiste bewerking met de juiste tijd, in plaats van hem te verzinnen. Die data is
// gelicenseerd en kan hier niet in. Wat WEL kan, en wat voor een Nederlandse factuur zwaarder
// weegt, is het TARIEF.
//
// ═══ HET GEVAAR DAT DIT AFDEKT ═══
//
// Het 9%-tarief is in Nederland smal en VOORWAARDELIJK. Twee regels die identiek klinken hebben
// een ander tarief:
//
//   "Binnenschilderwerk woning"  → 9%  ALS de woning ouder is dan 2 jaar, anders 21%
//   "Schilderwerk nieuwbouw"     → 21% altijd
//   "Schoonmaken woning"         → 9%  ALS de woning ouder is dan 2 jaar, anders 21%
//   "Schoonmaken kantoor"        → 21% altijd
//
// Dat verschil ontdekt niemand bij het typen. Het komt boven bij de aangifte, of pas bij een
// controle — en dan gaat het over alle facturen van dat jaar.
//
// ═══ DRIE REGELS DIE HIER GELDEN ═══
//
// 1. NOOIT EEN PRIJS. Een bundel geeft de omschrijving, de eenheid en het tarief. Wat het kost
//    bepaalt de ondernemer; een voorgestelde prijs is een advies dat wij niet mogen geven en
//    waarvan hij bovendien niet meer weet of hij hem zelf heeft gekozen.
//
// 2. BIJ TWIJFEL HET VEILIGE TARIEF, MET DE VOORWAARDE ERBIJ. Waar 9% afhangt van iets dat wij
//    niet weten, staat er 21% — en `let_op` legt uit wanneer 9% wél mag. Te veel BTW rekenen kost
//    een gesprek met je klant. Te weinig kost een naheffing.
//
// 3. HET IS EEN STARTPUNT, GEEN WAARHEID. De ondernemer past aan, en zijn aanpassing wint altijd.
//    Deze module schrijft nooit iets weg; hij levert alleen voorstellen.

export interface VakRegel {
  /** Wat er op de factuur komt te staan. Nederlands, want de factuur is Nederlands. */
  description: string;
  /** Een eenheid uit src/lib/eenheden.ts — of null als de regel per stuk gaat. */
  unit: string | null;
  /** 0, 9 of 21. Zie regel 2 hierboven. */
  btw_rate: 0 | 9 | 21;
  /**
   * De voorwaarde, in gewone woorden, als het tarief van iets afhangt.
   *
   * Dit is het hart van de bundel. Het staat er NIET om ons in te dekken maar omdat de
   * ondernemer het moet weten op het moment dat hij de regel gebruikt — niet drie maanden later.
   */
  let_op?: string;
}

export interface Vak {
  /** Sleutel in de database/URL. */
  key: string;
  /** Wat de ondernemer kiest. */
  naam: string;
  regels: readonly VakRegel[];
}

/** Het standaardadvies waar 9% van een voorwaarde afhangt die wij niet kunnen kennen. */
const WONING_2_JAAR =
  "9% mag alleen als de woning ouder is dan 2 jaar. Is dat niet zo (of is het geen woning), dan is het 21%.";

/**
 * De bundels.
 *
 * Bewust klein gehouden: vijf tot acht regels per vak, de dingen die echt elke week op een
 * factuur staan. Een lijst van veertig regels is geen hulp maar een tweede probleem — dan zoek
 * je langer dan je typt.
 */
export const VAKKEN: readonly Vak[] = [
  {
    key: "schilder",
    naam: "Schilder / stukadoor",
    regels: [
      // Schilder-, behang- en stukadoorwerk aan een woning ouder dan 2 jaar valt onder 9%
      // (arbeidsintensieve dienst). Nieuwbouw en bedrijfspanden niet.
      { description: "Binnenschilderwerk woning", unit: "uur", btw_rate: 9, let_op: WONING_2_JAAR },
      { description: "Buitenschilderwerk woning", unit: "uur", btw_rate: 9, let_op: WONING_2_JAAR },
      { description: "Behangwerk", unit: "m²", btw_rate: 9, let_op: WONING_2_JAAR },
      { description: "Stucwerk wanden", unit: "m²", btw_rate: 9, let_op: WONING_2_JAAR },
      { description: "Schilderwerk nieuwbouw", unit: "uur", btw_rate: 21, let_op: "Nieuwbouw valt nooit onder 9% — de woning is dan jonger dan 2 jaar." },
      { description: "Schilderwerk bedrijfspand", unit: "uur", btw_rate: 21, let_op: "Het 9%-tarief geldt alleen voor woningen, niet voor bedrijfspanden." },
      { description: "Verf en materiaal", unit: "stuk", btw_rate: 21, let_op: "Materiaal dat je apart doorberekent is 21%, ook bij een 9%-klus." },
    ],
  },
  {
    key: "kapper",
    naam: "Kapper",
    regels: [
      // Kappersdiensten vallen onder 9%. Producten die je verkoopt niet.
      { description: "Knippen", unit: "stuk", btw_rate: 9 },
      { description: "Knippen en föhnen", unit: "stuk", btw_rate: 9 },
      { description: "Kleuren", unit: "stuk", btw_rate: 9 },
      { description: "Permanent", unit: "stuk", btw_rate: 9 },
      { description: "Baard trimmen", unit: "stuk", btw_rate: 9 },
      { description: "Haarproducten (verkoop)", unit: "stuk", btw_rate: 21, let_op: "Een product dat je VERKOOPT is 21%, ook al is de behandeling 9%." },
    ],
  },
  {
    key: "fietsenmaker",
    naam: "Fietsenmaker",
    regels: [
      // Het repareren van fietsen valt onder 9% (arbeidsintensieve dienst). De verkoop van een
      // fiets of los onderdeel niet.
      { description: "Reparatie fiets — arbeid", unit: "uur", btw_rate: 9 },
      { description: "Band plakken", unit: "stuk", btw_rate: 9 },
      { description: "Remmen afstellen", unit: "stuk", btw_rate: 9 },
      { description: "Onderhoudsbeurt fiets", unit: "stuk", btw_rate: 9 },
      { description: "Onderdelen", unit: "stuk", btw_rate: 21, let_op: "Reparatie-ARBEID is 9%; onderdelen en accessoires die je levert zijn 21%." },
      { description: "Verkoop fiets", unit: "stuk", btw_rate: 21 },
    ],
  },
  {
    key: "schoonmaak",
    naam: "Schoonmaak",
    regels: [
      // Schoonmaken BINNEN een woning ouder dan 2 jaar is 9%. Kantoren en bedrijfsruimtes 21%.
      { description: "Schoonmaken woning", unit: "uur", btw_rate: 9, let_op: WONING_2_JAAR },
      { description: "Schoonmaken kantoor", unit: "uur", btw_rate: 21, let_op: "Het 9%-tarief geldt alleen binnen een woning, niet in een kantoor of bedrijfsruimte." },
      { description: "Glasbewassing", unit: "uur", btw_rate: 21, let_op: "Ramen wassen aan de buitenkant valt niet onder het 9%-tarief voor schoonmaken binnen de woning." },
      { description: "Opleveringsschoonmaak", unit: "uur", btw_rate: 21, let_op: WONING_2_JAAR },
      { description: "Schoonmaakmiddelen", unit: "stuk", btw_rate: 21 },
    ],
  },
  {
    key: "bouw",
    naam: "Bouw / klusbedrijf",
    regels: [
      // Renovatie en herstel aan een woning ouder dan 2 jaar: 9% op de ARBEID. Materiaal 21%,
      // tenzij het opgaat in de dienst — daarom staat het hier apart, met de voorwaarde erbij.
      { description: "Arbeid renovatie woning", unit: "uur", btw_rate: 9, let_op: WONING_2_JAAR },
      { description: "Arbeid nieuwbouw", unit: "uur", btw_rate: 21, let_op: "Nieuwbouw valt nooit onder 9%: de woning is dan jonger dan 2 jaar. Altijd 21%." },
      { description: "Arbeid bedrijfspand", unit: "uur", btw_rate: 21 },
      { description: "Materiaal", unit: "stuk", btw_rate: 21, let_op: "Materiaal dat je apart op de factuur zet is 21%, ook bij een 9%-klus." },
      { description: "Voorrijkosten", unit: "stuk", btw_rate: 21 },
      { description: "Afvoer bouwafval", unit: "stuk", btw_rate: 21 },
    ],
  },
  {
    key: "monteur",
    naam: "Monteur / installateur",
    regels: [
      { description: "Arbeid", unit: "uur", btw_rate: 21 },
      { description: "Arbeid renovatie woning", unit: "uur", btw_rate: 9, let_op: WONING_2_JAAR },
      { description: "Voorrijkosten", unit: "stuk", btw_rate: 21 },
      { description: "Spoedtoeslag", unit: "stuk", btw_rate: 21 },
      { description: "Onderdelen", unit: "stuk", btw_rate: 21 },
      { description: "Kilometers", unit: "km", btw_rate: 21 },
    ],
  },
  {
    key: "adviseur",
    naam: "Adviseur / ZZP-dienstverlener",
    regels: [
      { description: "Advies", unit: "uur", btw_rate: 21 },
      { description: "Consultancy", unit: "dag", btw_rate: 21 },
      { description: "Projectbegeleiding", unit: "uur", btw_rate: 21 },
      { description: "Reistijd", unit: "uur", btw_rate: 21 },
      { description: "Kilometers", unit: "km", btw_rate: 21 },
      { description: "Maandelijkse ondersteuning", unit: "maand", btw_rate: 21 },
    ],
  },
  {
    key: "winkel",
    naam: "Winkel / horeca",
    regels: [
      // Eten en niet-alcoholische drank: 9%. Alcohol: 21%. Non-food: 21%.
      { description: "Etenswaren", unit: "stuk", btw_rate: 9, let_op: "Voedingsmiddelen zijn 9%. Alcoholhoudende drank is 21%." },
      { description: "Niet-alcoholische drank", unit: "stuk", btw_rate: 9 },
      { description: "Alcoholhoudende drank", unit: "stuk", btw_rate: 21 },
      { description: "Non-food artikelen", unit: "stuk", btw_rate: 21 },
      { description: "Bezorgkosten", unit: "stuk", btw_rate: 21 },
    ],
  },
];

/** Eén vak opzoeken. Onbekende sleutel → null, nooit een gok. */
export function vakVan(key: string | null | undefined): Vak | null {
  const k = (key ?? "").trim().toLowerCase();
  if (!k) return null;
  return VAKKEN.find((v) => v.key === k) ?? null;
}

/**
 * De regels van een vak, klaar om als artikel te worden opgeslagen.
 *
 * `unit_price` is met opzet 0: een bundel geeft NOOIT een prijs. Zie regel 1 in de kop.
 */
export function startArtikelen(key: string): Array<{
  code: null;
  description: string;
  unit_price: 0;
  btw_rate: number;
  unit: string | null;
}> {
  const vak = vakVan(key);
  if (!vak) return [];
  return vak.regels.map((r) => ({
    code: null,
    description: r.description,
    unit_price: 0,
    btw_rate: r.btw_rate,
    unit: r.unit,
  }));
}

/**
 * Welke van deze regels heeft de ondernemer al?
 *
 * Vergelijkt op omschrijving, hoofdletter- en spatie-ongevoelig. Zo levert twee keer op
 * "toevoegen" tikken geen dubbele catalogus op — en dubbele regels in een suggestielijst zijn
 * precies waarom mensen zo'n lijst daarna niet meer gebruiken.
 */
export function nieuweRegels(
  key: string,
  bestaandeOmschrijvingen: readonly string[],
): ReturnType<typeof startArtikelen> {
  const hebIk = new Set(bestaandeOmschrijvingen.map((d) => d.trim().toLowerCase().replace(/\s+/g, " ")));
  return startArtikelen(key).filter(
    (r) => !hebIk.has(r.description.trim().toLowerCase().replace(/\s+/g, " ")),
  );
}
