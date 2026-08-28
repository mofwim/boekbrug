// src/lib/auth-landing.ts
// [KLUIS][OAUTH-ROL] Wat er na de OAuth-callback moet gebeuren — puur, geen I/O.
//
// ── WAAROM DIT EEN APART BESTAND IS ──
// De callback nam vier beslissingen door elkaar: bestaat er al een profiel, welke rol schrijven
// we, is dit een archiefaccount, en waar gaat de gebruiker heen. Ze stonden verweven met de
// databaseaanroepen, en daardoor kon niemand ze lezen zonder de aanroepen mee te lezen — laat
// staan testen.
//
// Dat is niet theoretisch gebleven. Precies hier zat de fout die het archiefpad brak: `next`
// wees al naar de kluis, maar de regel "stuur elke nieuwe gebruiker naar /onboarding" stond
// ervóór en won altijd. Een regel te vroeg, en de hele voordeur van /bewaarplicht kwam nergens
// uit. Zoiets is onzichtbaar in code die je alleen kunt uitproberen door je echt te
// registreren; in een pure functie is het een test van drie regels.
//
// Deze functie beslist dus, en de route voert alleen nog uit.

import { isSafeRedirect, safeRedirect } from "./safe-redirect";
import { parseRole, type Role } from "./register-intent";
import { PURPOSE_PARAM, landingPath, parsePurpose } from "./account-purpose";

/** Wat de callback aan de querystring meekrijgt. Onbetrouwbare invoer, ruw doorgegeven. */
export interface CallbackIntent {
  /** ?next= — de gewenste bestemming. */
  next: string | null;
  /** ?rol= — de keuze uit stap 1 van /register. */
  role: string | null;
  /** ?doel= — waarvoor deze bezoeker binnenkomt. */
  purpose: string | null;
}

/** De velden van het profiel waar deze beslissing op rust. */
export interface CallbackProfile {
  onboarding_done: boolean | null;
  onboarding_step: number | null;
  role: string | null;
}

export interface CallbackPlan {
  /** Waar de gebruiker heen gaat. Altijd een pad op onze eigen origin. */
  destination: string;
  /** Aan te maken profiel, of null als er al een rij is. */
  profileToCreate: { role: Role; onboarding_done: boolean; onboarding_step: number } | null;
  /** Rol die op een BESTAAND profiel geschreven moet worden, of null om het niet aan te raken. */
  roleUpdate: Role | null;
  /** Moet dit profiel als archiefaccount worden vastgelegd? */
  markArchief: boolean;
}

/**
 * Mag een meegereisde keuze (rol, doel) nog op dit profiel geschreven worden?
 *
 * Alleen als het de wizard nog niet gepasseerd is: stap 1 of lager én onboarding niet afgerond.
 * Dat is met opzet eng. Wie de wizard heeft doorlopen of al verder stond, heeft die keuzes al
 * gemaakt in de app zelf, en een parameter in een URL hoort daar niet overheen te gaan.
 *
 * Bij Google is dit het NORMALE geval, niet de uitzondering: on_auth_user_created vuurt tijdens
 * exchangeCodeForSession, dus tegen de tijd dat de callback kijkt bestaat de rij al — kaal,
 * want een OAuth-aanmelding draagt geen signUp-metadata.
 */
function isOnbeschreven(profile: CallbackProfile): boolean {
  return !profile.onboarding_done && (profile.onboarding_step ?? 1) <= 1;
}

export function planAfterOAuth(
  intent: CallbackIntent,
  profile: CallbackProfile | null,
): CallbackPlan {
  const chosenRole = parseRole(intent.role);
  const wantsArchief = parsePurpose(intent.purpose) === "archief";

  // De bestemming, met de terugval van deze route. [SEC-REDIRECT] `isSafeRedirect` weigert alles
  // wat niet een pad op onze eigen origin is; het onderscheid "is er een bestemming" is nodig
  // omdat een meegegeven bestemming (een uitnodiging, een betaalpagina) vóór de standaardlanding
  // van het archiefpad gaat.
  const hasNext = isSafeRedirect(intent.next);
  const next = safeRedirect(intent.next, "/dashboard");
  const archiefLanding = `${landingPath("archief")}?${PURPOSE_PARAM}=archief`;

  // [UITNODIGING] Een uitnodigingslink wint van de wizard — de tweede keer dat deze les valt.
  //
  // De kop van dit bestand beschrijft hoe het archiefpad brak: `next` wees al goed, maar de regel
  // "elke nieuwe gebruiker naar /onboarding" stond ervóór en won altijd. Precies dezelfde fout
  // zat op het uitnodigingspad, en daar was hij duurder. De genodigde klant klikt de mail van
  // zijn BOEKHOUDER, registreert, bevestigt zijn e-mail — en de callback gooide het token weg en
  // zette hem in een wizard over facturen versturen. De uitnodiging bleef stil op 'pending'
  // staan; de enige weg terug was zelf de mail opnieuw opzoeken. Voor het kanaal waar het hele
  // product op leunt (één kantoor nodigt vijftig klanten uit) is dat geen scherpe rand maar een
  // gebroken hoofdpad: het faalde juist bij NIEUWE gebruikers, en elke genodigde is er een.
  //
  // De acceptatiepagina stuurt na de tik zelf door naar /dashboard, waar de middleware een vers
  // account alsnog de wizard in leidt — de wizard wordt dus niet overgeslagen, hij komt één
  // stap later. Alleen de acceptatie gaat voor.
  const isInviteAccept = hasNext && next.startsWith("/invite/accept");

  // ── Nog geen profiel ──────────────────────────────────────────────────
  if (!profile) {
    return {
      // [KLUIS] Een archiefaccount heeft geen wizard te doorlopen: die gaat over facturen
      // versturen, bedrijfsgegevens en het koppelen van een mailbox, en deze bezoeker kwam voor
      // geen van drieën.
      destination: wantsArchief ? (hasNext ? next : archiefLanding) : isInviteAccept ? next : "/onboarding",
      profileToCreate: {
        role: chosenRole ?? "zzper",
        onboarding_done: wantsArchief,
        onboarding_step: 1,
      },
      roleUpdate: null,
      markArchief: wantsArchief,
    };
  }

  // ── Bestaand (meestal: zojuist door de trigger gemaakt) profiel ───────
  const onbeschreven = isOnbeschreven(profile);

  if (wantsArchief && onbeschreven) {
    return {
      destination: hasNext ? next : archiefLanding,
      profileToCreate: null,
      // Rol en doel reizen samen mee; is er een rol gekozen, dan hoort die er ook te staan.
      roleUpdate: chosenRole && chosenRole !== profile.role ? chosenRole : null,
      markArchief: true,
    };
  }

  const roleUpdate = chosenRole && chosenRole !== profile.role && onbeschreven ? chosenRole : null;

  // Een bestaand boekhoudaccount wordt hier NOOIT omgezet naar archief, ook niet met
  // ?doel=archief. Dat blijft aan het zelfherstel op /dashboard/kluis, waar het gebeurt op de
  // pagina die de gebruiker zelf heeft opgevraagd — zichtbaar, en niet als bijwerking van een
  // aanmelding. Zie de toelichting in src/app/dashboard/kluis/page.tsx.
  if (!profile.onboarding_done) {
    return { destination: isInviteAccept ? next : "/onboarding", profileToCreate: null, roleUpdate, markArchief: false };
  }

  return { destination: next, profileToCreate: null, roleUpdate, markArchief: false };
}
