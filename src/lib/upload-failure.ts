// src/lib/upload-failure.ts
// [UPLOAD-ERRORS] Eén mislukte upload, vijf verschillende oorzaken — en tot nu toe één zin.
//
// De uploadpagina hing alles wat geen 409 of 429 was onder dezelfde regel: "Lezen mislukt — probeer
// dit bestand opnieuw", met een knop eronder. Dat is precies één keer waar (een tijdelijke leesfout)
// en verder misleidend:
//
//   · 402 — het maandtegoed voor automatisch uitlezen is op. De server stuurt de reden, een
//     wachttermijn én een uitweg (/prijzen) mee; de pagina gooide dat alles weg en zette er een knop
//     onder die per definitie hetzelfde antwoord blijft geven. De eigenaar denkt dat de app stuk is,
//     terwijl hij één klik van de oplossing af staat.
//   · 413 — het bestand is te groot voor de server. Dit antwoord komt van het PLATFORM, niet van
//     onze route, dus de body is HTML en `data.error` bestaat niet: vandaar dat juist dit geval altijd
//     in de algemene zin viel. Opnieuw proberen geeft gegarandeerd hetzelfde.
//   · 504/408 — het uitlezen duurde te lang. Ook platform, ook geen JSON. Hier helpt opnieuw
//     proberen wél, maar de eigenaar moet weten dat het niet aan zijn bestand ligt.
//   · 502/503 — even niet bereikbaar. Zelfde verhaal.
//
// Waarom dit een eigen module is en niet vijf regels in de component: dit bepaalt wat de eigenaar
// leest én of er een knop verschijnt. Dat is een beslissing, geen opmaak, en beslissingen horen
// hier waar een test erbij kan. Puur, geen I/O.

export interface UploadFailure {
  /** De zin die de eigenaar leest. */
  message: string;
  /** Een 429: te snel, niet stuk. Eigen kleur, en opnieuw proberen helpt echt. */
  rateLimited?: boolean;
  /** Een 402: het maandtegoed is op. Rechtvaardigt een verwijzing naar /prijzen. */
  fairUse?: boolean;
  /** Zet géén "opnieuw proberen"-knop neer — die zou hier altijd hetzelfde antwoord geven. */
  noRetry?: boolean;
}

/**
 * Vertaal een mislukt antwoord van /api/intake naar wat de eigenaar te zien krijgt.
 *
 * `serverError` is `data.error` uit de JSON-body, of null/undefined wanneer er geen JSON was (een
 * platform-antwoord). De regel is: de server weet het beter dan wij, dus zijn zin wint — behalve bij
 * de statussen waar er per definitie geen serverzin ís, en behalve waar de status zelf iets vertelt
 * wat de zin niet dekt (of opnieuw proberen zin heeft).
 *
 * Bewust NIET meegenomen: 409 (duplicaat) en 200. Die hebben hun eigen afhandeling met eigen knoppen;
 * ze horen niet in een "mislukt"-vertaler thuis.
 */
export function describeUploadFailure(status: number, serverError?: string | null): UploadFailure {
  const fromServer = typeof serverError === "string" && serverError.trim() !== "" ? serverError.trim() : null;

  // 402 — fair use. De server stuurt hier altijd een uitgeschreven reden mee (fair-use-gate.ts), dus
  // die wint; de fallback is er alleen voor het geval dat ooit verandert.
  if (status === 402) {
    return {
      message: fromServer ?? "Je maandtegoed voor automatisch uitlezen is op. Het bestand zelf is niet geweigerd — de teller begint op de 1e weer bij nul.",
      fairUse: true,
      noRetry: true,
    };
  }

  // 429 — te snel, niet stuk. Blijft zijn eigen geval met zijn eigen kleur.
  if (status === 429) {
    return { message: fromServer ?? "Te veel tegelijk — probeer dit bestand zo opnieuw.", rateLimited: true };
  }

  // 413 — te groot voor de server. Geen JSON, dus nooit een serverzin; en opnieuw proberen met
  // hetzelfde bestand geeft gegarandeerd hetzelfde. Noem de enige twee wegen die wél werken.
  if (status === 413) {
    return {
      message: "Dit bestand is te groot om te versturen. Splits een grote PDF, of maak er een foto van — die verkleinen we automatisch.",
      noRetry: true,
    };
  }

  // 408/504 — het duurde te lang. Ligt niet aan het bestand, en opnieuw proberen helpt vaak.
  if (status === 408 || status === 504) {
    return { message: "Het uitlezen duurde te lang. Dat ligt niet aan je bestand — probeer het zo opnieuw." };
  }

  // 502/503 — even niet bereikbaar (of onze eigen 503 als de lezer hapert; die stuurt wél een zin).
  if (status === 502 || status === 503) {
    return { message: fromServer ?? "De server was even niet bereikbaar — probeer het zo opnieuw." };
  }

  // De rest: onze eigen route stuurt hier een uitgeschreven reden mee (400 te groot, 500 opslaan
  // mislukt, …). Is er géén JSON, noem dan de status in plaats van te doen alsof we weten wat er
  // misging — "onverwacht antwoord" is eerlijker dan "lezen mislukt" bij een bestand dat prima is.
  return {
    message: fromServer ?? `De server gaf een onverwacht antwoord (HTTP ${status}) — probeer het opnieuw.`,
  };
}
