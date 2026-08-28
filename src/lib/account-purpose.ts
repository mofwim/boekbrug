// src/lib/account-purpose.ts
// [KLUIS] Waarvoor iemand een account maakt — puur, geen I/O.
//
// ── WAAROM DIT BESTAAT ──
// De app ging er tot nu toe van uit dat iedereen komt om te bóékhouden. Dat klopt voor de
// meeste mensen en niet voor de groep waar /bewaarplicht op mikt: iemand wiens zaak gestopt
// is, of wiens boekhoudpakket ophoudt, komt zijn administratie WEGZETTEN. Hij gaat geen
// factuur sturen, hij gaat zijn Gmail niet koppelen, en hij wil geen wizard van vier
// schermen over facturen maken.
//
// Zonder dit onderscheid was de voordeur van /bewaarplicht een lege belofte: de knop stuurde
// naar /register?doel=archief, die parameter deed niets, en de bezoeker liep alsnog de
// gewone onboarding in — precies de wrijving waar hij voor wegliep.
//
// ── WAT DIT NADRUKKELIJK NIET IS ──
// Geen plan, geen abonnement, geen beperking. Een archiefaccount kan alles wat elk ander
// account kan; het krijgt alleen een andere begroeting en een andere eerste pagina. Wie
// binnenkomt om zijn oude doos weg te zetten en een half jaar later toch een factuur wil
// sturen, klikt gewoon op Facturen. Er is niets om te "upgraden" en niets om te ontgrendelen.
//
// Dat is bewust: het hele idee achter de bewaarplicht-als-voordeur is dat de rest van de app
// er al staat voor als hij hem nodig heeft (zie docs/BEWAARKLUIS_BUSINESS_CASE.md §4). Een
// archiefaccount dat dingen NIET mag, zou dat idee kapotmaken.

import type { MessageKey } from "./i18n/messages";
import { BELOFTE_KORT, BELOFTE_GERUST } from "./belofte";

/** Waarvoor het account is aangemaakt. Beïnvloedt de begroeting, nooit de rechten. */
export type AccountPurpose = "boekhouden" | "archief";

export const DEFAULT_PURPOSE: AccountPurpose = "boekhouden";

/** De querystring op /register die het archiefpad kiest: /register?doel=archief */
export const PURPOSE_PARAM = "doel";

/**
 * Lees een doel uit onbetrouwbare invoer (querystring, gebruikersmetadata, databasekolom).
 *
 * Alles wat niet exact 'archief' is wordt 'boekhouden'. De faalrichting is bewust die kant
 * op: 'boekhouden' is het volledige pad met de volledige onboarding, dus een verkeerd
 * gelezen waarde levert hooguit een wizard te veel op. Andersom zou een typefout iemand de
 * onboarding laten overslaan die hij wél nodig had.
 */
export function parsePurpose(raw: string | null | undefined): AccountPurpose {
  return raw === "archief" ? "archief" : DEFAULT_PURPOSE;
}

/**
 * Moet dit account door de onboarding-wizard?
 *
 * Een archiefaccount niet, en dat is geen tijdsbesparing maar het punt zelf: die wizard gaat
 * over facturen versturen, je bedrijfsgegevens en het koppelen van je mailbox. Iemand die
 * zijn gestopte zaak komt archiveren heeft daar geen van drieën. Hem er toch doorheen sturen
 * is precies de wrijving waar /bewaarplicht hem vandaan haalde.
 */
export function needsOnboarding(purpose: AccountPurpose): boolean {
  return purpose !== "archief";
}

/** Waar iemand na registratie landt. */
export function landingPath(purpose: AccountPurpose): string {
  return purpose === "archief" ? "/dashboard/kluis" : "/onboarding";
}

/**
 * De teksten op /register. Iemand die uit /bewaarplicht komt heeft een ander probleem dan
 * iemand die een boekhoudprogramma zoekt, en hoort dus iets anders te lezen — anders begint
 * de belofte van die pagina al bij het aanmaken van het account te schuiven.
 */
export interface PurposeCopy {
  /** Onder de naam BoekBrug. */
  subtitle: string;
  /** De belofte in één zin. */
  promise: string;
  /** De geruststelling eronder. */
  reassurance: string;
  /** Het opschrift op de knop die het account aanmaakt. */
  cta: string;
  /**
   * [TAAL] Dezelfde knop als sleutel.
   *
   * Alleen de KNOP, en dat is een grens met een reden. De drie regels erboven (subtitle, promise,
   * reassurance) komen uit belofte.ts en zijn geen interfacetekst: BELOFTE_GERUST is volgens zijn
   * eigen kop een CONTRACTUELE regel (voorwaarden §5.2), met een eigen vertaalmodule ernaast
   * (belofte-en.ts). Die horen niet in de schermcatalogus te belanden als bijvangst van een
   * vertaalslag — dat is een aparte, bewuste wijziging. Een knopopschrift is dat niet.
   */
  ctaSleutel: MessageKey;
}

export function purposeCopy(purpose: AccountPurpose): PurposeCopy {
  if (purpose === "archief") {
    return {
      subtitle: "Je archief veiligstellen",
      promise:
        "Zet je administratie weg: geordend per jaar en kwartaal, doorzoekbaar, en op elk moment te exporteren.",
      // Geen woord over facturen of bonnen scannen. Die staan er wel, maar het noemen zou
      // deze bezoeker het gevoel geven dat hij toch software moet gaan leren.
      reassurance:
        "Gratis beginnen · geen creditcard · je bewaarplicht blijft van jou, wij zijn je tweede exemplaar",
      cta: "Archief aanmaken",
      ctaSleutel: "reg.ctaArchief",
    };
  }
  // [BELOFTE] Geen opsomming van functies meer. Wat hier stond ("Maak facturen, scan bonnen
  // en houd je BTW bij") is een featurelijst, en een featurelijst nodigt uit tot vergelijken
  // met pakketten die op elke regel meer hebben. Bron: src/lib/belofte.ts.
  return {
    subtitle: "Niets meer kwijtraken",
    promise: BELOFTE_KORT,
    reassurance: BELOFTE_GERUST,
    cta: "Gratis beginnen",
    ctaSleutel: "reg.ctaGratis",
  };
}

/**
 * De rol van een archiefaccount: gewoon 'zzper', dezelfde als iedere andere ondernemer.
 *
 * Nadrukkelijk GEEN aparte rol, en dat is een bewuste beperking van dit hele bestand.
 * Rollen bepalen in deze app wie wat van wie mag zien — het boekhoudersportaal, de
 * koppeling tussen ondernemer en boekhouder, de RLS-policies die daarop rusten. Een archief
 * verandert daar niets aan: het is dezelfde ondernemer met dezelfde stukken, alleen op een
 * ander moment in zijn leven. Een derde rol invoeren voor een verschil in begroeting zou dat
 * model vervuilen en elke policy die erop rust een extra geval geven.
 */
export const ARCHIEF_ROLE = "zzper" as const;
