// src/lib/snelstart-claim.ts
// [SNELSTART-CLAIM] Wat weten we ná een mislukte boeking: is er NIETS geboekt, of weten we het
// niet? Puur, geen I/O. Run: npx tsx --test src/lib/snelstart-claim.test.ts
//
// WAAROM DIT BESTAAT
// De boeking naar SnelStart is ONOMKEERBAAR — hij landt in het wettelijke inkoop-/verkoopboek van
// de boekhouder. Het idempotentie-slot (de partiële unique index op status='pushed') werd echter
// pas GESCHREVEN nadat die POST al was gedaan. Tussen de POST en die regel zit een gat, en in dat
// gat past een tweede verzoek: een tweede tabblad, een dubbelklik, een herhaling na een time-out.
// Dan staat dezelfde inkoopfactuur twee keer in de boekhouding van de klant — en de boekhouder
// heeft geen enkele reden om te vermoeden dat het er twee zijn.
//
// De reparatie is: eerst claimen, dan pas posten. Maar dat kan pas veilig met een DERDE staat.
//
// ── WAAROM 'unknown' MOET BESTAAN ───────────────────────────────────────────────────────────
// Claim je vooraf en zet je bij elke fout de claim terug op 'failed', dan is een netwerkfout
// fataal in de andere richting: de POST kán zijn aangekomen — SnelStart boekte hem, en pas het
// ANTWOORD ging verloren. Vrijgeven betekent dan een tweede boeking bij de volgende poging.
// Blijven staan op 'unknown' betekent: wij weten het niet, wij proberen het niet opnieuw, en een
// mens kijkt in SnelStart of de boeking er staat.
//
// Dat is de juiste ruil voor een BRUG. Een zichtbaar dubbel is terug te vinden en te corrigeren;
// een onzichtbaar gemis — een factuur die iedereen als geboekt beschouwt terwijl hij nergens
// staat — komt pas bij de aangifte aan het licht, of nooit.

/** De drie staten die een regel in snelstart_exports kan hebben. */
export type ExportStatus = "pushed" | "failed" | "unknown";

/**
 * Statussen die de factuur CLAIMEN: zolang er zo'n regel staat, mag er niet opnieuw worden
 * geboekt. 'pushed' omdat het al gelukt is, 'unknown' omdat we niet weten of het gelukt is.
 * Dit is óók de predicaat-lijst van de partiële unique index.
 */
export const CLAIMING_STATUSES: readonly ExportStatus[] = ["pushed", "unknown"];

/** Claimt deze status de factuur — mag er dus NIET opnieuw worden geboekt? */
export function isClaiming(status: string | null | undefined): boolean {
  return (CLAIMING_STATUSES as readonly string[]).includes((status ?? "").trim());
}

/**
 * Foutcodes waarbij BEWEZEN is dat SnelStart niets heeft geboekt.
 *
 * Elk hiervan is een weigering vóórdat de boeking werd verwerkt:
 *   NOT_CONFIGURED  — nooit verstuurd, onze sleutel ontbreekt
 *   INVALID_KEY     — 401, geweigerd bij de deur
 *   FORBIDDEN       — 403, idem
 *   NOT_FOUND       — 404, het eindpunt bestond niet
 *   RATE_LIMITED    — 429, geweigerd vóór verwerking
 *   VALIDATION      — 400/422, SnelStart heeft ernaar gekeken en hem inhoudelijk afgewezen
 * Plus alle mapping-fouten, die vóór de POST worden gegooid en dus nooit het net op gingen.
 */
const PROVABLY_NOT_BOOKED = new Set([
  "NOT_CONFIGURED",
  "INVALID_KEY",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "VALIDATION",
  // Mapping-fouten (SnelStartMappingError) — geweigerd aan onze eigen grens.
  "MISSING_NUMBER",
  "MISSING_DATE",
  "MISSING_RELATION",
  "NO_AMOUNTS",
  "AMOUNT_MISMATCH",
  "NO_BTW_MATCH",
  "NOT_EXPORTABLE",
]);

/**
 * Wat wordt de claim ná een mislukking?
 *
 * 'failed'  → bewezen niets geboekt; de claim gaat vrij en de factuur mag opnieuw mee.
 * 'unknown' → afloop onbekend (SERVER 5xx, NETWORK, of een fout die we niet kennen). De claim
 *             blijft staan, er wordt niet opnieuw geboekt, en een mens controleert het.
 *
 * De faalrichting is bewust 'unknown': alles wat we NIET herkennen krijgt het voorzichtige
 * antwoord. Een nieuwe foutcode die we vergeten toe te voegen leidt dan tot één handmatige
 * controle te veel — nooit tot een dubbele boeking in andermans grootboek.
 */
export function claimStatusAfterFailure(errorCode: string | null | undefined): "failed" | "unknown" {
  const code = (errorCode ?? "").trim().toUpperCase();
  if (!code) return "unknown";
  return PROVABLY_NOT_BOOKED.has(code) ? "failed" : "unknown";
}

/**
 * De regel die de gebruiker te zien krijgt bij een 'unknown'. Nooit "mislukt" — dat zou een
 * bewering zijn die we juist niet kunnen doen — en nooit "geboekt".
 */
export function unknownOutcomeMessage(invoiceNumber: string | null | undefined): string {
  const nr = (invoiceNumber ?? "").trim();
  const wie = nr ? `Factuur ${nr}` : "Deze factuur";
  return `${wie} is mogelijk wél geboekt in SnelStart, maar wij kregen geen bevestiging. Controleer het daar voordat je opnieuw boekt — wij proberen het niet vanzelf nog eens.`;
}
