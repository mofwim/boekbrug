// [MODEL-CONFIG] Pure node test — run: npx tsx --test src/lib/ai-model.test.ts
//
// Two properties carry this file:
//   1. AN UNAVAILABLE MODEL IS RECOGNISED. If not, the owner reads "try again later" on an error
//      where later is never coming — exactly how this outage went unnoticed for months, twice.
//   2. THE SPLIT DOES NOT CHANGE THE SYNC. isAiConfigError must give literally the same answer as
//      the regex email-integration.ts already used, or the automatic reader's watermark hold
//      shifts quietly along with this split.
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

/** The regex exactly as email-integration.ts had it, copied verbatim as the benchmark. */
const ORIGINAL_CONFIG_OUTAGE =
  /not_found_error|404|authentication_error|permission_error|invalid[_ ]?api|model:/i;

/** Real error texts as callClaude throws them: `Claude API error <status>: <body>`. */
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

test("the default is the model this app demonstrably runs on", () => {
  // Changing this is a decision — not a typo. See the header of ai-model.ts.
  assert.equal(DEFAULT_CLAUDE_MODEL, "claude-haiku-4-5-20251001");
});

test("an unavailable model is recognised — that IS the whole outage", () => {
  assert.equal(
    isModelUnavailableError(
      new Error('Claude API error 404: {"error":{"type":"not_found_error","message":"model: claude-sonnet-5"}}'),
    ),
    true,
  );
  // Also when the text carries only the type, or only the status.
  assert.equal(isModelUnavailableError(new Error("not_found_error")), true);
  assert.equal(isModelUnavailableError(new Error("Claude API error 404: ")), true);
});

test("a key error is NOT a model error — otherwise you make a guaranteed pointless second attempt", () => {
  const auth = new Error('Claude API error 401: {"error":{"type":"authentication_error"}}');
  assert.equal(isAiCredentialError(auth), true);
  assert.equal(isModelUnavailableError(auth), false, "falling back to another model does not help here");
  // And conversely: a missing model is not a key problem.
  const missing = new Error('Claude API error 404: {"error":{"type":"not_found_error"}}');
  assert.equal(isAiCredentialError(missing), false);
});

test("a busy or broken API is not a configuration error", () => {
  // Here "try again in a moment" is exactly the right answer.
  for (const msg of ["Claude API error 429: rate_limit_error", "Claude API error 529: overloaded_error", "fetch failed", "socket hang up"]) {
    assert.equal(isAiConfigError(new Error(msg)), false, msg);
  }
});

test("[BENCHMARK] the split does not change the sync reader's verdict", () => {
  // isAiConfigError must be the exact union of the two halves, and exactly equal to the regex that
  // was already there. Without this test, a later refinement of one half could quietly shift the
  // automatic import's watermark hold.
  for (const msg of CLAUDE_ERRORS) {
    assert.equal(isAiConfigError(new Error(msg)), ORIGINAL_CONFIG_OUTAGE.test(msg), msg);
    assert.equal(
      isAiConfigError(new Error(msg)),
      isModelUnavailableError(new Error(msg)) || isAiCredentialError(new Error(msg)),
      msg,
    );
  }
});

test("nonsense does not get through", () => {
  for (const v of [null, undefined, "", 0, {}, []]) {
    assert.equal(isAiConfigError(v), false, String(v));
    assert.equal(isModelUnavailableError(v), false, String(v));
  }
  // A bare string counts too — the sync sometimes passes String(err).
  assert.equal(isModelUnavailableError("not_found_error"), true);
});

test("an empty or missing model id falls back to the proven value", () => {
  // An empty env var must NEVER pass as a model id: the API rejects it, and then you have built
  // exactly the outage this file prevents.
  assert.equal(resolveModel(undefined, DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel(null, DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel("", DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel("   ", DEFAULT_CLAUDE_MODEL), DEFAULT_CLAUDE_MODEL);
  // Surrounding whitespace is a typo in a .env, not a different model.
  assert.equal(resolveModel("  claude-sonnet-5 ", DEFAULT_CLAUDE_MODEL), "claude-sonnet-5");
  // And a real value simply wins.
  assert.equal(resolveModel("claude-opus-5", DEFAULT_CLAUDE_MODEL), "claude-opus-5");
  // Chaining: REREAD_MODEL falls back to CLAUDE_MODEL, which falls back to the default.
  const base = resolveModel(undefined, DEFAULT_CLAUDE_MODEL);
  assert.equal(resolveModel(undefined, base), DEFAULT_CLAUDE_MODEL);
});

test("the message does not send the owner to a button that cannot work", () => {
  assert.ok(!/opnieuw proberen helpt/i.test("") && MODEL_UNAVAILABLE_MESSAGE.length > 0);
  // The word "opnieuw" may appear only to say that it does NOT help.
  assert.ok(/helpt hier niet/i.test(MODEL_UNAVAILABLE_MESSAGE), MODEL_UNAVAILABLE_MESSAGE);
  assert.ok(!/probeer het later opnieuw/i.test(MODEL_UNAVAILABLE_MESSAGE), MODEL_UNAVAILABLE_MESSAGE);
});
