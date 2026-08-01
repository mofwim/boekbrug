// src/lib/ai-model.ts
// [MODEL-CONFIG] Which Claude model we read with, and how to INTERPRET a failure. Pure, no I/O.
//
// ── WHY THIS EXISTS ──
// This project has hit the same thing twice: someone hard-codes a model id, that id turns out not
// to be enabled on this account, the API answers HTTP 404 — and a feature that always worked
// suddenly does nothing.
//
//   · The first time was 'claude-sonnet-4-5-20251001' in the reader. Result: EVERY invoice
//     classification broke, no invoice could be read at all. The fix lives in ai.ts: the model
//     became configurable (CLAUDE_MODEL) with a PROVEN default underneath, so a wrong id breaks
//     nothing and you fall back without a deploy.
//   · The second time was 'claude-sonnet-5' in the manual re-read. That same fix stood right next
//     to it and was not used: the "Opnieuw inlezen" button bypassed CLAUDE_MODEL and quietly fell
//     over a 404. Worse, the owner read "try again later" while later was never going to work.
//
// The lesson from those two is not "pay more attention" but: NO model id belongs hard-coded in a
// route, and the app should RECOGNISE an unavailable model instead of treating it as an outage.
// That is exactly what this file does, in one place, with tests.
//
// ── THREE KINDS OF "NO" ──
// The sync reader already distinguished "this file's fault" from "an app-wide config error" — with
// one regex catching both. For the RE-READ that is not fine-grained enough, because there exists an
// action that only helps in the first case:
//
//   isModelUnavailableError  → the MODEL is the problem (404 / not_found / "model: ...").
//                              Another model may still work → falling back makes sense.
//   isAiCredentialError      → the KEY or the permissions are the problem (auth/permission).
//                              No model will work → falling back is a wasted paid call.
//   isAiConfigError          → either of the two. App-wide, never this one file's fault.
//
// isAiConfigError is deliberately the EXACT union of the two, and exactly equal to the regex
// email-integration.ts already used — there is a test for that, so the split above cannot quietly
// shift the sync's behaviour.

/**
 * The model this app demonstrably runs on.
 *
 * Do NOT change this to something newer without trying it on the real account first. To try a
 * stronger model, set CLAUDE_MODEL (or REREAD_MODEL) in the environment. If that id turns out to be
 * unavailable, clear the variable and everything is back on this value — without a deploy.
 */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001";

/**
 * A model id from the environment, with a proven fallback underneath.
 *
 * Empty, whitespace or absent counts as "not set" — not as an empty model id, because the API
 * would reject that and cause precisely the outage this file prevents.
 */
export function resolveModel(raw: string | null | undefined, fallback: string): string {
  const v = (raw ?? "").trim();
  return v || fallback;
}

/** An error's text, whether it is an Error, a string or something else. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

/**
 * Is the API saying THIS MODEL does not exist? (404 / not_found_error / a "model: ..." validation)
 *
 * This is the only error where redoing the same read with a DIFFERENT model makes sense.
 */
export function isModelUnavailableError(error: unknown): boolean {
  return /not_found_error|404|model:/i.test(messageOf(error));
}

/**
 * Is the API saying the KEY or the permissions are wrong?
 *
 * Another model does not help here: the same key fails again. A fallback would be a second paid
 * attempt with a guaranteed outcome.
 */
export function isAiCredentialError(error: unknown): boolean {
  return /authentication_error|permission_error|invalid[_ ]?api/i.test(messageOf(error));
}

/**
 * App-wide configuration error: model or key. Never the fault of whichever file happened to come
 * past, so never a reason to file that document as "unreadable".
 */
export function isAiConfigError(error: unknown): boolean {
  return isModelUnavailableError(error) || isAiCredentialError(error);
}

/**
 * What the owner gets told about this.
 *
 * Without the word "again". That is the whole point: this is a setting that is wrong, and pressing
 * the button once more cannot help by definition — the message that did suggest it is precisely
 * why this outage went unnoticed for so long.
 *
 * Dutch string: UI text shown to the owner, per the language rule in AGENTS.md.
 */
export const MODEL_UNAVAILABLE_MESSAGE =
  "Het leesmodel is niet beschikbaar op dit account. Opnieuw proberen helpt hier niet — dit moet in de instellingen van de app worden rechtgezet.";
