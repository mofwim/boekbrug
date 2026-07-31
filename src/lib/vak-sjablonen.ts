// src/lib/vak-sjablonen.ts
// [VAK-SJABLONEN] Kant-en-klare factuurregels per beroep, voor de gratis factuurgenerator.
//
// Waar dit echt over gaat. Het lijkt een sneltoets — de monteur kiest "garage" en heeft zijn
// regels — maar de tijdwinst is het kleinste deel. Het echte probleem dat dit oplost is het
// BTW-TARIEF. Een schilder die een woning van dertig jaar oud schildert mag 9% rekenen; doet
// hij hetzelfde werk aan nieuwbouw, dan is het 21%. Een taxichauffeur zit op 9%, een
// koeriersdienst op 21%, en beide noemen zichzelf "transport". Een schoonmaker binnen een
// woning 9%, dezelfde schoonmaker in een kantoorpand 21%. Dat zijn precies de fouten die pas
// bij de aangifte opvallen, als de factuur al de deur uit is.
//
// Een sjabloon dat het juiste tarief meebrengt is dus een JUISTHEIDSfunctie in het jasje van
// een snelheidsfunctie. Dat past bij de rest van dit product: de uitkomst is een suggestie die
// de mens bevestigt, nooit een bewering.
//
// Twee ontwerpregels die dit uit de onderhoudsval houden:
//
//   1. GEEN PRIJZEN. Nooit. Een uurtarief van € 65 is fout voor iedereen behalve toevallig
//      één iemand, en een verkeerd voorgevuld bedrag dat per ongeluk meegaat is erger dan een
//      leeg veld. We leveren omschrijving + eenheid + tarief; het bedrag is van de ondernemer.
//      In het volledige product komen zijn eigen eerdere regels daar vanzelf voor in de plaats.
//
//   2. TWIJFEL WORDT ZICHTBAAR, NIET WEGGEPOETST. Waar het tarief van de situatie afhangt,
//      staat de veilige 21% ingevuld én een `let_op` die uitlegt wanneer 9% mag. We kiezen
//      nooit stilzwijgend het lage tarief: te veel BTW rekenen kost de klant geld, te weinig
//      rekenen kost de ondernemer een naheffing. Van die twee is de tweede de zwaardere, dus
//      de default is het hoge tarief en het lage is een bewuste keuze.
//
// Pure data + pure functies, node-testbaar (run: npx tsx src/lib/vak-sjablonen.test.ts).

export type Eenheid = "uur" | "stuk" | "dag" | "km" | "m²" | "post";

/** De drie tarieven die op een Nederlandse factuur kunnen staan. */
export type BtwTarief = 21 | 9 | 0;

export interface VakRegel {
  description: string;
  eenheid: Eenheid;
  btw_rate: BtwTarief;
}

export interface Vak {
  slug: string;
  /** Wat er in de keuzelijst staat. */
  label: string;
  /** Eén zin die de ondernemer laat herkennen dat dit zijn vak is. */
  omschrijving: string;
  regels: VakRegel[];
  /**
   * Alleen ingevuld als het tarief van de situatie afhangt. Dit is het waardevolste veld van
   * het hele bestand: het staat er juist bij de vakken waar de ondernemer het vaakst misgrijpt.
   */
  let_op?: string;
}

/**
 * De vakken. Volgorde = wat we verwachten dat het meest gezocht wordt; de generieke
 * dienstverlening staat bewust achteraan zodat een specifiek vak eerst in beeld komt.
 *
 * Alle tarieven volgen de hoofdregel van de Wet OB: 21% tenzij de wet het expliciet verlaagt.
 * Waar 9% van omstandigheden afhangt (leeftijd van de woning, personen vs. goederen, binnen
 * vs. buiten een woning) staat 21% ingevuld met een let_op — zie de kop.
 */
export const VAKKEN: Vak[] = [
  {
    slug: "automonteur",
    label: "Automonteur / garage",
    omschrijving: "Onderhoud en reparatie van auto's",
    regels: [
      { description: "Arbeidsloon monteur", eenheid: "uur", btw_rate: 21 },
      { description: "Kleine beurt", eenheid: "stuk", btw_rate: 21 },
      { description: "Grote beurt", eenheid: "stuk", btw_rate: 21 },
      { description: "APK-keuring", eenheid: "stuk", btw_rate: 21 },
      { description: "Onderdelen (zie specificatie)", eenheid: "stuk", btw_rate: 21 },
      { description: "Banden wisselen en balanceren", eenheid: "stuk", btw_rate: 21 },
      { description: "Diagnose / uitlezen storing", eenheid: "uur", btw_rate: 21 },
    ],
  },
  {
    slug: "loodgieter",
    label: "Loodgieter / installateur",
    omschrijving: "Sanitair, leidingwerk en verwarming",
    regels: [
      { description: "Arbeidsloon installateur", eenheid: "uur", btw_rate: 21 },
      { description: "Voorrijkosten", eenheid: "post", btw_rate: 21 },
      { description: "Spoedtoeslag buiten kantooruren", eenheid: "post", btw_rate: 21 },
      { description: "Lekkage opsporen en herstellen", eenheid: "uur", btw_rate: 21 },
      { description: "Ontstoppen afvoer", eenheid: "post", btw_rate: 21 },
      { description: "Materiaal (zie specificatie)", eenheid: "stuk", btw_rate: 21 },
      { description: "Plaatsen sanitair", eenheid: "uur", btw_rate: 21 },
    ],
    let_op:
      "Loodgieterswerk valt onder het normale tarief van 21%. Het verlaagde tarief voor woningen ouder dan twee jaar geldt alleen voor schilder-, stukadoors- en isolatiewerk — niet voor installatiewerk. Zit er isolatiewerk in de klus, zet die regel dan apart op de factuur.",
  },
  {
    slug: "elektricien",
    label: "Elektricien",
    omschrijving: "Installatie en storingen aan elektra",
    regels: [
      { description: "Arbeidsloon elektricien", eenheid: "uur", btw_rate: 21 },
      { description: "Voorrijkosten", eenheid: "post", btw_rate: 21 },
      { description: "Storing zoeken en verhelpen", eenheid: "uur", btw_rate: 21 },
      { description: "Groepenkast uitbreiden", eenheid: "post", btw_rate: 21 },
      { description: "Aanleggen groep / bedrading", eenheid: "post", btw_rate: 21 },
      { description: "Materiaal (zie specificatie)", eenheid: "stuk", btw_rate: 21 },
      { description: "Inspectie en meetrapport", eenheid: "post", btw_rate: 21 },
    ],
  },
  {
    slug: "schilder",
    label: "Schilder / stukadoor",
    omschrijving: "Schilderwerk, stucwerk en behang",
    regels: [
      { description: "Schilderwerk binnen — arbeidsloon", eenheid: "uur", btw_rate: 21 },
      { description: "Schilderwerk buiten — arbeidsloon", eenheid: "uur", btw_rate: 21 },
      { description: "Stucwerk — arbeidsloon", eenheid: "uur", btw_rate: 21 },
      { description: "Voorbereiden en afplakken", eenheid: "uur", btw_rate: 21 },
      { description: "Behangen", eenheid: "m²", btw_rate: 21 },
      { description: "Verf en materiaal", eenheid: "post", btw_rate: 21 },
    ],
    let_op:
      "Dit is het vak waar het tarief het vaakst misgaat. Is de woning ouder dan twee jaar, dan mag over het ARBEIDSLOON van schilder- en stukadoorswerk 9%. De materialen blijven altijd 21%, en bij een woning jonger dan twee jaar is alles 21%. Zet arbeid en materiaal daarom op aparte regels — anders kun je het lage tarief niet onderbouwen.",
  },
  {
    slug: "transport",
    label: "Transport / koerier / taxi",
    omschrijving: "Vervoer van goederen of personen",
    regels: [
      { description: "Transportkosten", eenheid: "km", btw_rate: 21 },
      { description: "Rit / opdracht", eenheid: "stuk", btw_rate: 21 },
      { description: "Wachttijd", eenheid: "uur", btw_rate: 21 },
      { description: "Laden en lossen", eenheid: "uur", btw_rate: 21 },
      { description: "Toeslag spoedlevering", eenheid: "post", btw_rate: 21 },
      { description: "Opslag", eenheid: "dag", btw_rate: 21 },
    ],
    let_op:
      "Let op het verschil tussen goederen en personen: goederenvervoer is 21%, personenvervoer (taxi, busvervoer) is 9%. Beide heten in de volksmond 'transport'. Rijd je personen, zet die regels dan op 9%.",
  },
  {
    slug: "bouw-klus",
    label: "Bouw / klusbedrijf",
    omschrijving: "Timmerwerk, verbouwing en algemeen klussen",
    regels: [
      { description: "Arbeidsloon vakman", eenheid: "uur", btw_rate: 21 },
      { description: "Voorrijkosten", eenheid: "post", btw_rate: 21 },
      { description: "Sloop- en afvoerwerk", eenheid: "uur", btw_rate: 21 },
      { description: "Timmerwerk", eenheid: "uur", btw_rate: 21 },
      { description: "Tegelwerk", eenheid: "m²", btw_rate: 21 },
      { description: "Materiaal (zie specificatie)", eenheid: "post", btw_rate: 21 },
      { description: "Afvalcontainer / stortkosten", eenheid: "post", btw_rate: 21 },
    ],
    let_op:
      "Werk je voor een aannemer in de bouw, dan geldt vaak de verleggingsregeling: jij brengt géén BTW in rekening en vermeldt 'BTW verlegd' met het BTW-nummer van de opdrachtgever. Dat is iets anders dan 0% — kies in dat geval 0% en zet 'BTW verlegd' in de omschrijving.",
  },
  {
    slug: "schoonmaak",
    label: "Schoonmaak",
    omschrijving: "Schoonmaakwerk voor particulieren en bedrijven",
    regels: [
      { description: "Schoonmaakwerkzaamheden", eenheid: "uur", btw_rate: 21 },
      { description: "Eenmalige grote schoonmaak", eenheid: "post", btw_rate: 21 },
      { description: "Glasbewassing", eenheid: "post", btw_rate: 21 },
      { description: "Opleverschoonmaak na verbouwing", eenheid: "post", btw_rate: 21 },
      { description: "Schoonmaakmiddelen", eenheid: "post", btw_rate: 21 },
    ],
    let_op:
      "Schoonmaken BINNEN een woning valt onder 9%; schoonmaken van bedrijfsruimte, kantoren of de buitenkant van een woning is 21%. Werk je voor particulieren binnenshuis, zet die regels dan op 9%.",
  },
  {
    slug: "kapper",
    label: "Kapper",
    omschrijving: "Knippen, kleuren en verzorging",
    regels: [
      { description: "Knippen", eenheid: "stuk", btw_rate: 9 },
      { description: "Knippen en föhnen", eenheid: "stuk", btw_rate: 9 },
      { description: "Kleuren", eenheid: "stuk", btw_rate: 9 },
      { description: "Watergolf / styling", eenheid: "stuk", btw_rate: 9 },
      { description: "Verzorgingsproducten", eenheid: "stuk", btw_rate: 21 },
    ],
    let_op:
      "Kappersdiensten vallen onder 9%. Verkoop je daarnaast producten (shampoo, wax), dan is dát 21% — die staan hier daarom apart.",
  },
  {
    slug: "fietsenmaker",
    label: "Fietsenmaker",
    omschrijving: "Reparatie en onderhoud van fietsen",
    regels: [
      { description: "Reparatie fiets — arbeidsloon", eenheid: "uur", btw_rate: 9 },
      { description: "Band plakken / vervangen", eenheid: "stuk", btw_rate: 9 },
      { description: "Onderhoudsbeurt", eenheid: "stuk", btw_rate: 9 },
      { description: "Onderdelen", eenheid: "stuk", btw_rate: 21 },
      { description: "Verkoop fiets", eenheid: "stuk", btw_rate: 21 },
    ],
    let_op:
      "Het REPAREREN van fietsen valt onder 9%; het verkopen van een fiets of losse onderdelen is 21%. Zet arbeid en onderdelen daarom op aparte regels.",
  },
  {
    slug: "hovenier",
    label: "Hovenier / tuinonderhoud",
    omschrijving: "Aanleg en onderhoud van tuinen",
    regels: [
      { description: "Tuinonderhoud — arbeidsloon", eenheid: "uur", btw_rate: 21 },
      { description: "Snoeiwerk", eenheid: "uur", btw_rate: 21 },
      { description: "Aanleg bestrating", eenheid: "m²", btw_rate: 21 },
      { description: "Beplanting", eenheid: "post", btw_rate: 21 },
      { description: "Afvoeren groenafval", eenheid: "post", btw_rate: 21 },
    ],
  },
  {
    slug: "dienstverlening",
    label: "Advies / dienstverlening (algemeen)",
    omschrijving: "Uren, projecten en consultancy",
    regels: [
      { description: "Werkzaamheden volgens afspraak", eenheid: "uur", btw_rate: 21 },
      { description: "Projectwerk", eenheid: "post", btw_rate: 21 },
      { description: "Adviesgesprek", eenheid: "uur", btw_rate: 21 },
      { description: "Reiskosten", eenheid: "km", btw_rate: 21 },
      { description: "Onkosten (zie specificatie)", eenheid: "post", btw_rate: 21 },
    ],
  },
];

/** Opzoeken op slug. Onbekend → null; de aanroeper toont dan gewoon een lege regel. */
export function vakBySlug(slug: string | null | undefined): Vak | null {
  if (!slug) return null;
  return VAKKEN.find((v) => v.slug === slug) ?? null;
}

/** Alleen wat een keuzelijst nodig heeft. */
export function vakOpties(): Array<{ slug: string; label: string }> {
  return VAKKEN.map((v) => ({ slug: v.slug, label: v.label }));
}

/**
 * De regels van een vak, klaar om in het formulier te zetten: aantal 1, geen prijs. De eenheid
 * gaat in de omschrijving mee ("Arbeidsloon monteur (per uur)") omdat de factuurregel zelf geen
 * eenheidsveld heeft — zo blijft op de PDF zichtbaar waar het aantal voor staat.
 */
export function vakRegelsVoorFormulier(slug: string): Array<{ description: string; quantity: string; unit_price: string; btw_rate: number }> {
  const vak = vakBySlug(slug);
  if (!vak) return [];
  return vak.regels.map((r) => ({
    description: `${r.description} (per ${r.eenheid})`,
    quantity: "1",
    unit_price: "",
    btw_rate: r.btw_rate,
  }));
}
