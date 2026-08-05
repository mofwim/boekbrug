// src/lib/mandate-request.ts
// [VRAAG-MACHTIGING] De boekhouder vraagt zijn klant om toestemming. Puur, geen I/O.
// Run: npx tsx --test src/lib/mandate-request.test.ts
//
// WAAROM DIT ER MOET ZIJN, EN WAAROM HET ER NIET WAS
//
// Er zijn vier schermen gebouwd die alle vier op een machtiging wachten, en er was geen enkele
// manier om die machtiging te VRAGEN. De lege staten zeiden "je klant zet het zelf aan bij
// Instellingen" — instructies voor een telefoongesprek dat buiten de app moet plaatsvinden. Een
// functie die alleen begint na een telefoontje, begint niet.
//
// En de klant vindt het niet uit zichzelf: het staat op regel 831 van een instellingenscherm van
// 1035 regels, onder zijn profiel, KVK, BTW, IBAN, KOR, kasstelsel, vrijstelling, herinneringen en
// factuurnummering. Niemand scrollt daarheen om iets aan te zetten waarvan hij niet weet dat het
// bestaat.
//
// DE TOON IS HET ONTWERP
//
// Dit bericht vraagt om toegang tot iemands boekhouding. Het moet dus drie dingen doen die een
// verkopende tekst juist niet doet: zeggen wat je NIET krijgt, zeggen dat de klant het op elk
// moment terugneemt, en niet aandringen. Een klant die zich overvallen voelt, zegt nee — en dan is
// de functie erger dan afwezig, want hij is geprobeerd en afgewezen.
//
// EN ÉÉN KEER VRAGEN IS VRAGEN, TWEE KEER IS ZEUREN
//
// Vandaar de wachttijd. Aan de andere kant zit geen gebruiker van ons maar de klant van een
// boekhouder, en hun relatie is niet iets wat wij met herinneringen mogen belasten.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md). The produced TEXT is Dutch —
// it is read by a Dutch entrepreneur, and it is the whole output of this file.

import type { MandateKind } from "./accountant-mandate";

/**
 * Hoe lang tussen twee verzoeken voor dezelfde machtiging.
 *
 * Veertien dagen. Kort genoeg dat een vergeten verzoek nog eens langs kan komen voordat het
 * kwartaal sluit, lang genoeg dat het nooit als aandringen leest. Wie sneller antwoord wil, belt —
 * en dat is de juiste weg, niet een tweede melding.
 */
export const REQUEST_COOLDOWN_DAYS = 14;

export type RequestVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Mag dit verzoek nu de deur uit?
 *
 * `lastRequestedAt` is het moment van het vorige verzoek voor DEZELFDE soort, of null. Een
 * onleesbare datum telt als "net gevraagd": bij twijfel niet nog een keer bij iemand aankloppen.
 */
export function canRequestMandate(
  lastRequestedAt: string | null | undefined,
  nowMs: number,
): RequestVerdict {
  if (!lastRequestedAt) return { allowed: true };
  const ms = Date.parse(lastRequestedAt);
  if (!Number.isFinite(ms)) {
    return { allowed: false, reason: "Er is al eens gevraagd — probeer het over een paar dagen." };
  }
  const dagen = (nowMs - ms) / 86_400_000;
  if (dagen >= REQUEST_COOLDOWN_DAYS) return { allowed: true };
  const rest = Math.max(1, Math.ceil(REQUEST_COOLDOWN_DAYS - dagen));
  return {
    allowed: false,
    reason: `Je hebt dit al gevraagd. Je kunt het over ${rest} dag${rest === 1 ? "" : "en"} nog eens vragen — of even bellen.`,
  };
}

export interface RequestText {
  /** De kop van de melding in de app. */
  title: string;
  /** Het bericht dat in zijn inbox belandt. */
  body: string;
}

/**
 * De tekst van het verzoek.
 *
 * Elke alinea heeft een taak, en de derde is de belangrijkste: die zegt wat de machtiging NIET
 * geeft. Een klant die de grens kent, zegt vaker ja — en een klant die ja zegt zonder de grens te
 * kennen, is een klacht die op zich laat wachten.
 */
export function buildMandateRequest(
  kind: MandateKind,
  accountantName: string,
): RequestText {
  const naam = (accountantName || "").trim() || "Je boekhouder";

  if (kind === "bevestigen") {
    return {
      title: `${naam} vraagt of hij je inkoopfacturen mag bevestigen`,
      body: [
        `${naam} vraagt of hij je bonnen en inkoopfacturen mag nakijken en boeken.`,
        "",
        "Waarom hij het vraagt: zolang een bon niet is bevestigd, telt hij niet mee in je kwartaal en blijft je aangifte op 'nog niet klaar' staan. Nu doe jij dat stuk voor stuk; met deze toestemming doet hij het.",
        "",
        "Wat hij NIET kan: bedragen, datums of btw-tarieven wijzigen. Hij kan alleen bevestigen wat er staat. Klopt er iets niet, dan hoort hij het bij je na te vragen. Bij elke bevestiging komt zijn naam te staan en krijg je bericht.",
        "",
        "Je zet het aan bij Instellingen → Jouw boekhouder, en je zet het daar ook weer uit. Nee zeggen mag; er verandert dan niets.",
      ].join("\n"),
    };
  }

  return {
    title: `${naam} vraagt of hij facturen namens jou mag versturen`,
    body: [
      `${naam} vraagt of hij facturen op jouw naam mag maken en versturen, en of hij je klanten mag herinneren als ze te laat betalen.`,
      "",
      "De facturen komen op jouw naam, in jouw nummerreeks en onder jouw btw-nummer. Je krijgt van elke verstuurde factuur en elke herinnering bericht, en bij elke factuur staat wie hem heeft gemaakt.",
      "",
      "Wat hij NIET kan: bij je bankrekening, betalingen doen, aangifte indienen, of iets veranderen aan facturen die jij zelf hebt gemaakt.",
      "",
      "Je zet het aan bij Instellingen → Jouw boekhouder, en je zet het daar ook weer uit — zonder opzegtermijn. Nee zeggen mag; er verandert dan niets.",
    ].join("\n"),
  };
}
