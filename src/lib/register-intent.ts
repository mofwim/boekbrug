// src/lib/register-intent.ts
// [OAUTH-ROL] Wat de bezoeker bij de voordeur koos, onderweg door OAuth — puur, geen I/O.
//
// ── WAAROM DIT BESTAAT ──
// Stap 1 van /register vraagt één ding: ben je ZZP'er of boekhouder. Daarna kan de bezoeker
// verder met Google, en op dat moment ging het antwoord verloren.
//
// Niet bij ongeluk onopgemerkt: er stond een comment boven de knop dat het WEL werd
// meegegeven ("Role is stored in step 1 — passed as state through OAuth so callback can save
// it"), en een tweede comment dat een eerdere poging beschreef met een `state`-object dat
// nergens aan signInWithOAuth werd meegegeven. Dat tweede comment concludeerde dat `next` "de
// weg is die er al lag" — maar `next` draagt alleen de bestemming, nooit de rol. De callback
// schreef intussen onvoorwaardelijk role: 'zzper'.
//
// Gevolg: elke boekhouder die zich via Google aanmeldde kwam binnen als ZZP'er. Het herstelt
// zichzelf (de wizard vraagt het opnieuw, omdat een kaal profiel op stap 1 staat), dus het is
// nooit als storing gemeld — maar de eerste vraag die wij stellen werd wél stil weggegooid.
//
// ── WAAROM DIT GEEN HANDTEKENING NODIG HEEFT ──
// Een rol is in deze app een ZELFVERKLARING en niets meer. Dat is geen slordigheid maar een
// vastgelegde keuze: ai_spend_guard.sql legt uit dat niemand kan afdwingen dat de verklaring
// klopt — wie 'Boekhouder' aanklikt in het formulier krijgt hem net zo goed — en dat het
// toegangsbesluit daarom op BEWIJS rust: minstens één accountant_clients-koppeling met
// toestemming, waarbij zelf-koppelen al geblokkeerd is.
//
// Deze waarde ondertekenen of versleutelen zou dus iets beschermen wat niet beschermd is, en
// zou vooral de indruk wekken dat de rol een gecontroleerd feit is. Wat wél moet gebeuren is
// het enige wat hier gebeurt: de waarde toetsen aan de twee bekende rollen voordat zij ergens
// wordt opgeslagen. Precies dezelfde toets die handle_new_user() in SQL al doet.

import type { Role } from "./navigation";

export type { Role };

/** De querystring waarmee /register de rolkeuze meegeeft aan zijn eigen OAuth-callback. */
export const ROLE_PARAM = "rol";

/**
 * Lees een rol uit onbetrouwbare invoer (querystring, gebruikersmetadata, databasekolom).
 *
 * Geeft `null` terug bij alles wat niet exact 'zzper' of 'accountant' is — inclusief afwezig.
 * Dat is met opzet géén stille terugval op 'zzper' zoals in de SQL-trigger: daar MOET een
 * waarde staan omdat de rij op dat moment wordt aangemaakt, terwijl een lezer van deze functie
 * juist moet kunnen zien of er iets gekozen is. "Niets gekozen" en "ZZP'er gekozen" zijn twee
 * verschillende dingen zodra je een bestaand profiel voor je hebt: bij het eerste hoor je niets
 * aan te raken.
 *
 * Let op 'client': dat is wel een geldige waarde in de CHECK op profiles.role, maar het is geen
 * rol die iemand zichzelf bij registratie geeft. Hij hoort hier dus niet doorheen te komen.
 */
export function parseRole(raw: string | null | undefined): Role | null {
  return raw === "zzper" || raw === "accountant" ? raw : null;
}
