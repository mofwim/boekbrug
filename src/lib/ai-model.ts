// src/lib/ai-model.ts
// [MODEL-CONFIG] Welk Claude-model er wordt gelezen, en hoe je een mislukking DUIDT. Puur, geen I/O.
//
// ── WAAROM DIT BESTAAT ──
// Dit project heeft twee keer hetzelfde gehad: iemand zet een model-id met de hand in de code, dat
// id blijkt niet vrijgegeven op dit account, de API antwoordt HTTP 404 — en een functie die het
// altijd deed doet ineens niets meer.
//
//   · De eerste keer was 'claude-sonnet-4-5-20251001' in de lezer. Gevolg: ELKE factuurclassificatie
//     brak, geen enkele factuur kon nog worden ingelezen. De reparatie staat in ai.ts: het model
//     werd instelbaar (CLAUDE_MODEL) met een BEWEZEN standaard eronder, zodat een verkeerd id niets
//     meer breekt en je zonder deploy terugvalt.
//   · De tweede keer was 'claude-sonnet-5' in de handmatige herlezing. Diezelfde reparatie stond
//     ernaast en werd niet gebruikt: de knop "Opnieuw inlezen" ging langs CLAUDE_MODEL heen en viel
//     stil terug op een 404. Erger nog: de eigenaar las "probeer het later opnieuw", terwijl later
//     nooit zou werken.
//
// De les uit die twee is niet "beter opletten" maar: er hoort GEEN model-id met de hand in een
// route te staan, en de app hoort een niet-vrijgegeven model te HERKENNEN in plaats van hem als
// storing te behandelen. Dat is precies wat dit bestand doet, op één plek, met tests.
//
// ── DRIE SOORTEN "NEE" ──
// De sync-lezer maakte al onderscheid tussen "dit is de schuld van dit bestand" en "dit is een
// app-brede configuratiefout" — met één regexp die beide gevallen ving. Voor het HERLEZEN is dat
// niet fijn genoeg, want daar bestaat een handeling die alleen bij het eerste geval helpt:
//
//   isModelUnavailableError  → het MODEL is het probleem (404 / not_found / "model: ...").
//                              Een ANDER model kan wél werken → terugvallen heeft zin.
//   isAiCredentialError      → de SLEUTEL of de rechten zijn het probleem (auth/permission).
//                              Geen enkel model gaat werken → terugvallen is een verspilde call.
//   isAiConfigError          → één van beide. App-breed, nooit de schuld van dit ene bestand.
//
// isAiConfigError is met opzet EXACT de vereniging van de twee, en exact gelijk aan de regexp die
// email-integration.ts al gebruikte — daar is een test voor, zodat de splitsing hierboven het
// gedrag van de sync niet stilletjes kan verschuiven.

/**
 * Het model waar deze app aantoonbaar op draait.
 *
 * Verander dit NIET naar iets nieuwers zonder het eerst op het echte account te proberen. Wil je
 * een sterker model proberen: zet CLAUDE_MODEL (of REREAD_MODEL) in de omgeving. Blijkt dat id
 * niet beschikbaar, dan wis je de variabele en staat alles weer op deze waarde — zonder deploy.
 */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Een model-id uit de omgeving, met een bewezen terugval eronder.
 *
 * Leeg, spaties of afwezig telt als "niet ingesteld" — en niet als een leeg model-id, want dat
 * laatste zou de API afwijzen en dus precies de storing veroorzaken die dit bestand voorkomt.
 */
export function resolveModel(raw: string | null | undefined, fallback: string): string {
  const v = (raw ?? "").trim();
  return v || fallback;
}

/** De tekst van een fout, ongeacht of het een Error, een string of iets anders is. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

/**
 * Zegt de API dat DIT MODEL er niet is? (404 / not_found_error / een "model: ..."-validatiefout)
 *
 * Dit is de enige fout waarbij het zin heeft dezelfde lezing met een ANDER model over te doen.
 */
export function isModelUnavailableError(error: unknown): boolean {
  return /not_found_error|404|model:/i.test(messageOf(error));
}

/**
 * Zegt de API dat de SLEUTEL of de rechten niet kloppen?
 *
 * Hier helpt een ander model niet: dezelfde sleutel gaat opnieuw stuk. Een terugval zou hier een
 * tweede betaalde poging zijn met een gegarandeerde uitkomst.
 */
export function isAiCredentialError(error: unknown): boolean {
  return /authentication_error|permission_error|invalid[_ ]?api/i.test(messageOf(error));
}

/**
 * App-brede configuratiefout: model óf sleutel. Nooit de schuld van het bestand dat toevallig
 * langskwam, dus nooit een reden om dat bestand als "onleesbaar" weg te zetten.
 */
export function isAiConfigError(error: unknown): boolean {
  return isModelUnavailableError(error) || isAiCredentialError(error);
}

/**
 * Wat de eigenaar hierover te horen krijgt.
 *
 * Zonder het woord "opnieuw". Dat is het hele punt: dit is een instelling die fout staat, en
 * nog een keer op de knop drukken kan per definitie niet helpen — de melding die dat wél
 * suggereerde is precies waarom deze storing zo lang onopgemerkt bleef.
 */
export const MODEL_UNAVAILABLE_MESSAGE =
  "Het leesmodel is niet beschikbaar op dit account. Opnieuw proberen helpt hier niet — dit moet in de instellingen van de app worden rechtgezet.";
