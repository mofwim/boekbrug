// src/lib/auth-errors.ts
// [AUTH-FOUT] Wat er werkelijk mis ging, in één zin — puur, geen I/O.
//
// ── WAAROM DIT BESTAAT ──
// Alle drie de authschermen deden hetzelfde: één `if` voor het geval dat ze verwachtten, en een
// `else` die al het andere op één hoop gooide. Dat leest als netjes afgehandeld en is het niet,
// want de hoop bevat gevallen waarin de voorgestelde oplossing niet werkt:
//
//   · /login zei "E-mail of wachtwoord is onjuist" — óók bij een 429 (te veel pogingen). Wie dat
//     leest tikt zijn wachtwoord opnieuw, dus opnieuw een poging, dus een langere blokkade. De
//     melding maakt het probleem groter dat ze beschrijft.
//   · /wachtwoord-herstellen zei "Opslaan mislukt. Vraag een nieuwe link aan" — óók als de link
//     prima was en alleen het wachtwoord te zwak. Dan vraagt iemand een nieuwe link aan, kiest
//     hetzelfde wachtwoord, en komt precies even ver.
//
// Een foutmelding die de verkeerde kant op wijst kost meer dan geen foutmelding: zonder melding
// probeer je iets anders, mét een verkeerde melding doe je hardnekkig het verkeerde.
//
// De vorm is bewust: `code` leidt, de tekst is de terugval. Supabase levert sinds v2.something
// stabiele foutcodes, maar oudere servers (en de selfhost-variant) sturen alleen een message. Op
// alleen de tekst leunen zou breken bij een vertaling; op alleen de code leunen zou nu al gaten
// laten. Beide, met de code eerst.

/** De vorm van een Supabase AuthError, zonder het type te hoeven importeren. */
import type { MessageKey } from "./i18n/messages";

export interface RuweAuthFout {
  code?: string;
  status?: number;
  message?: string;
}

export interface AuthFout {
  /**
   * De regel die de gebruiker leest, in de BRONTAAL.
   *
   * [TAAL] Blijft staan, en is niet overbodig: de wachtwoordschermen renderen hem nog rechtstreeks,
   * en hij is de bron waaruit de catalogusregel is geschreven. Een scherm dat vertaald is gebruikt
   * `sleutel` hieronder; een scherm dat dat nog niet is, verandert door deze wijziging niets.
   */
  tekst: string;
  /**
   * [TAAL] Dezelfde zin als sleutel in de catalogus.
   *
   * Deze module beslist WELKE fout het is — dat is de moeilijke helft en die is puur. Welke WOORDEN
   * daarbij horen is de taal van het scherm, en dat kan een module die geen scherm kent niet weten.
   * Zo hoeft de beslisboom hierboven, met zijn zorgvuldig gekozen volgorde, nooit vertaald te
   * worden: hij levert een naam, en het scherm zoekt het woord erbij.
   */
  sleutel: MessageKey;
  /** Bij welk veld de melding hoort. Ontbreekt hij, dan is het een algemene melding. */
  veld?: "email" | "password";
  /** Het account bestaat, maar de e-mail is nog niet bevestigd — toon de "stuur opnieuw"-knop. */
  bevestigNodig?: boolean;
  /** De herstellink is op of al gebruikt — een nieuwe aanvragen is de enige weg. */
  linkVerlopen?: boolean;
}

function tekstVan(fout: RuweAuthFout): string {
  return fout.message?.toLowerCase() ?? "";
}

/** Te veel verzoeken. Apart, want dit is het geval waarin "probeer opnieuw" verkeerd advies is. */
function isRatelimiet(fout: RuweAuthFout): boolean {
  const t = tekstVan(fout);
  return (
    fout.status === 429 ||
    fout.code === "over_request_rate_limit" ||
    fout.code === "over_email_send_rate_limit" ||
    t.includes("rate limit") ||
    t.includes("too many")
  );
}

/**
 * Wat er misging bij het inloggen met e-mail en wachtwoord.
 *
 * De volgorde is niet willekeurig: "nog niet bevestigd" moet vóór "onjuist", want dat account
 * bestaat en het wachtwoord kán kloppen — daar hoort een knop bij, geen ontkenning.
 */
export function inlogFout(fout: RuweAuthFout): AuthFout {
  const t = tekstVan(fout);

  if (fout.code === "email_not_confirmed" || t.includes("confirm")) {
    return { tekst: "Je moet eerst je e-mail bevestigen.", sleutel: "auth.bevestigEerst", bevestigNodig: true };
  }
  if (isRatelimiet(fout)) {
    return { tekst: "Te veel pogingen achter elkaar — wacht een minuut en probeer opnieuw.", sleutel: "auth.teVeelPogingen" };
  }
  if (fout.code === "user_banned") {
    return { tekst: "Dit account is geblokkeerd. Neem contact op via de website.", sleutel: "auth.geblokkeerd" };
  }
  if (fout.code === "invalid_credentials" || t.includes("invalid login") || t.includes("credentials")) {
    return { tekst: "E-mail of wachtwoord is onjuist", sleutel: "auth.onjuist" };
  }
  // Onbekend: NIET "onjuist" zeggen. Dat is een bewering over wat de gebruiker intikte, en die
  // kunnen we hier niet doen — een serverstoring is geen typefout.
  return { tekst: "Inloggen lukte niet — probeer het zo opnieuw.", sleutel: "auth.inlogMislukt" };
}

/**
 * Wat er misging bij het opslaan van een nieuw wachtwoord (de tweede stap van herstellen).
 *
 * `linkVerlopen` is het geval dat er echt uit moet springen: dan is opnieuw proberen zinloos en
 * is een nieuwe link de enige weg. Alle andere gevallen zijn juist wél opnieuw te proberen op
 * ditzelfde scherm, en die mogen dus niet naar een nieuwe link verwijzen.
 */
export function wachtwoordOpslaanFout(fout: RuweAuthFout): AuthFout {
  const t = tekstVan(fout);

  if (fout.code === "weak_password" || t.includes("password should be") || t.includes("weak")) {
    return {
      tekst: "Dit wachtwoord is te zwak — kies er een die langer is.",
      sleutel: "auth.wachtwoordZwak",
      veld: "password",
    };
  }
  if (fout.code === "same_password" || t.includes("should be different")) {
    return {
      tekst: "Dit is je huidige wachtwoord — kies een ander.",
      sleutel: "auth.wachtwoordZelfde",
      veld: "password",
    };
  }
  if (isRatelimiet(fout)) {
    return { tekst: "Te veel pogingen achter elkaar — wacht een minuut en probeer opnieuw.", sleutel: "auth.teVeelPogingen" };
  }
  if (
    fout.status === 401 ||
    fout.status === 403 ||
    fout.code === "session_not_found" ||
    t.includes("session") ||
    t.includes("expired") ||
    t.includes("jwt") ||
    t.includes("token")
  ) {
    return {
      tekst: "Deze herstellink is verlopen of al gebruikt. Vraag een nieuwe aan.",
      sleutel: "auth.linkVerlopen",
      linkVerlopen: true,
    };
  }
  return { tekst: "Opslaan lukte niet — probeer het zo opnieuw.", sleutel: "auth.opslaanMislukt" };
}

/** Wat er misging bij het AANVRAGEN van een herstelmail (de eerste stap). */
export function herstelmailFout(fout: RuweAuthFout): AuthFout {
  if (isRatelimiet(fout)) {
    return { tekst: "Te veel aanvragen achter elkaar — wacht een minuut en probeer opnieuw.", sleutel: "auth.teVeelAanvragen" };
  }
  return { tekst: "Versturen lukte niet — probeer het zo opnieuw.", sleutel: "auth.versturenMislukt" };
}

/**
 * De reden waarmee de OAuth-callback iemand terugstuurt naar /login.
 *
 * Die callback zet er al ?error=no_code of ?error=auth_failed op, maar /login las dat nooit: wie
 * met Google strandde kwam terug op een leeg inlogformulier zonder één woord over wat er zojuist
 * mislukte, en probeerde hetzelfde nog eens.
 *
 * Alleen bekende waarden krijgen een eigen tekst. Wat er verder ook in die parameter staat, komt
 * NIET op het scherm — een querystring is invoer van buiten, en die hoort niet als melding
 * teruggetoond te worden.
 */
export function callbackFoutSleutel(reden: string | null | undefined): MessageKey | null {
  switch (reden) {
    case "no_code":
      return "auth.googleAfgebroken";
    case "auth_failed":
      return "auth.googleMislukt";
    case null:
    case undefined:
    case "":
      return null;
    default:
      // Iets ging mis en we weten niet wat. Dat wordt gezegd — maar in ONZE woorden: de waarde uit
      // de querystring komt nooit op het scherm, ook niet als naam van een sleutel.
      return "auth.googleMislukt";
  }
}
