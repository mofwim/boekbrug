// [MODEL-CONFIG] Pure node test — run: npx tsx --test src/lib/ai-model.test.ts
//
// Twee eigenschappen dragen dit bestand:
//   1. EEN NIET-VRIJGEGEVEN MODEL WORDT HERKEND. Zo niet, dan leest de eigenaar "probeer het later
//      opnieuw" bij een fout waar later nooit gaat komen — en dat is exact hoe deze storing twee
//      keer maandenlang onopgemerkt bleef.
//   2. DE SPLITSING VERANDERT DE SYNC NIET. isAiConfigError moet letterlijk hetzelfde antwoord
//      geven als de regexp die email-integration.ts al gebruikte, anders verschuift de
//      watermerk-hold van de automatische lezer stilletjes mee met deze opsplitsing.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CLAUDE_MODEL,
  resolveModel,
  isModelUnavailableError,
  isAiCredentialError,
  isAiConfigError,
  MODEL_UNAVAILABLE_MESSAGE,
} from "./ai-model";

/** De regexp zoals email-integration.ts hem had, letterlijk overgenomen als ijkpunt. */
const ORIGINAL_CONFIG_OUTAGE =
  /not_found_error|404|authentication_error|permission_error|invalid[_ ]?api|model:/i;

/** Echte foutteksten zoals callClaude ze opgooit: `Claude API error <status>: <body>`. */
const CLAUDE_ERRORS = [
  'Claude API error 404: {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-5"}}',
  'Claude API error 404: {"type":"error","error":{"type":"not_found_error","message":"model: claude-opus-5"}}',
  'Claude API error 401: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
  'Claude API error 403: {"type":"error","error":{"type":"permission_error","message":"not allowed"}}',
  'Claude API error 429: {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}',
  'Claude API error 529: {"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}',
  'Claude API error 500: {"type":"error","error":{"type":"api_error","message":"internal"}}',
  "fetch failed",
  "socket hang up",
  "[COST-GUARD] daily AI budget exhausted",
  "Claude API returned unexpected response shape",
];

test("het standaardmodel is het model waarop deze app aantoonbaar draait", () => {
  // Verandert dit, dan is dat een besluit — geen typefout. Zie de kop van ai-model.ts.
  assert.equal(DEFAULT_CLAUDE_MODEL, "claude-haiku-4-5-20251001");
});

test("een niet-vrijgegeven model wordt herkend — dát is de hele storing", () => {
  assert.equal(
    isModelUnavailableError(
      new Error('Claude API error 404: {"error":{"type":"not_found_error","message":"model: claude-sonnet-5"}}'),
    ),
    true,
  );
  // Ook als de tekst alleen het type draagt, of alleen de status.
  assert.equal(isModelUnavailableError(new Error("not_found_error")), true);
  assert.equal(isModelUnavailableError(new Error("Claude API error 404: ")), true);
});

test("een sleutelfout is GEEN modelfout — anders doe je een gegarandeerd zinloze tweede poging", () => {
  const auth = new Error('Claude API error 401: {"error":{"type":"authentication_error"}}');
  assert.equal(isAiCredentialError(auth), true);
  assert.equal(isModelUnavailableError(auth), false, "terugvallen op een ander model helpt hier niet");
  // En omgekeerd: een ontbrekend model is geen sleutelprobleem.
  const missing = new Error('Claude API error 404: {"error":{"type":"not_found_error"}}');
  assert.equal(isAiCredentialError(missing), false);
});

test("een drukke of kapotte API is geen configuratiefout", () => {
  // Hier is "probeer het zo meteen opnieuw" juist het goede antwoord.
  for (const msg of ["Claude API error 429: rate_limit_error", "Claude API error 529: overloaded_error", "fetch failed", "socket hang up"]) {
    assert.equal(isAiConfigError(new Error(msg)), false, msg);
  }
});

test("[IJKPUNT] de splitsing verandert het oordeel van de sync-lezer niet", () => {
  // isAiConfigError moet exact de vereniging zijn van de twee helften, en exact gelijk aan de
  // regexp die er al stond. Zonder deze test kan een latere verfijning van één helft de
  // watermerk-hold van de automatische import stilletjes verschuiven.
  for (const msg of CLAUDE_ERRORS) {
    assert.equal(isAiConfigError(new Error(msg)), ORIGINAL_CONFIG_OUTAGE.test(msg), msg);
    assert.equal(
      isAiConfigError(new Error(msg)),
      isModelUnavailableError(new Error(msg)) || isAiCredentialError(new Error(msg)),
      msg,
    );
  }
});

test("onzin komt er niet doorheen", () => {
  for (const v of [null, undefined, "", 0, {}, []]) {
    assert.equal(isAiConfigError(v), false, String(v));
    assert.equal(isModelUnavailableError(v), false, String(v));
  }
  // Een string zonder Error-wikkel telt net zo goed — de sync geeft soms String(err) door.
  assert.equal(isModelUnavailableError("not_found_error"), true);
});

test("een leeg of ontbrekend model-id valt terug op de bewezen waarde", () => {
  // Een lege env-variabele mag NOOIT als model-id doorgaan: de API wijst dat af, en dan heb je
  // precies de storing gebouwd die dit bestand voorkomt.
  assert.equal(resolveModel(undefined, DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel(null, DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel("", DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel("   ", DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  // Spaties eromheen zijn een typefout in een .env, geen ander model.
  assert.equal(resolveModel("  claude-sonnet-5 ", DEFAULT_CLAUDE_MODEL), "claude-sonnet-5");
  // En een echte waarde wint gewoon.
  assert.equal(resolveModel("claude-opus-5", DEFAULT_CLAUDE_MODEL), "claude-opus-5");
  // Ketenen: REREAD_MODEL valt terug op CLAUDE_MODEL, die terugvalt op de standaard.
  const base = resolveModel(undefined, DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel(undefined, base), DEFAULT_CLAUDE_MODEL);
});

test("de melding stuurt de eigenaar niet op een knop die niet kan werken", () => {
  assert.ok(!/opnieuw proberen helpt/i.test("") && MODEL_UNAVAILABLE_MESSAGE.length > 0);
  // Het woord "opnieuw" mag hier alleen voorkomen om te zeggen dat het NIET helpt.
  assert.ok(/helpt hier niet/i.test(MODEL_UNAVAILABLE_MESSAGE), MODEL_UNAVAILABLE_MESSAGE);
  assert.ok(!/probeer het later opnieuw/i.test(MODEL_UNAVAILABLE_MESSAGE), MODEL_UNAVAILABLE_MESSAGE);
});
