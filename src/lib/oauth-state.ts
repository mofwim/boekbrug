// src/lib/oauth-state.ts
// [MH1] CSRF-safe OAuth state for the email-mailbox connect flow.
//
// The old flow put {userId, provider} in a base64 `state` param and, in the callback,
// trusted `state.userId` whenever the session cookie didn't survive the redirect. Because
// `state` is attacker-forgeable, anyone who knew a victim's user-id could complete an OAuth
// callback with THEIR OWN mailbox `code` and a state naming the victim — linking the
// attacker's mailbox into the victim's account (the victim's next sync then ingests the
// attacker's mail).
//
// The fix binds the flow to a random nonce that lives in an HttpOnly cookie the attacker
// cannot set:
//   • /connect   → mints a nonce, puts {nonce, provider} in `state`, and stores
//                  {nonce, userId, provider} in an HttpOnly cookie.
//   • /callback  → requires the cookie, requires cookie.nonce === state.nonce, and takes
//                  the userId from the COOKIE (never from the URL). A forged state has no
//                  matching cookie, so it is rejected.
import { randomUUID } from "crypto";

export const OAUTH_STATE_COOKIE = "bb_oauth_state";
// Short window: the whole OAuth round-trip is seconds. 10 minutes is generous slack.
export const OAUTH_STATE_MAX_AGE = 600;

export type OAuthProvider = "gmail" | "outlook";

function b64urlEncode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function b64urlDecode<T>(s: string): T {
  return JSON.parse(Buffer.from(s, "base64url").toString()) as T;
}

/** Build the `state` query param and the paired cookie value for a connect request. */
export function makeOAuthState(userId: string, provider: OAuthProvider): {
  state: string;
  cookieValue: string;
} {
  const nonce = randomUUID();
  return {
    state: b64urlEncode({ nonce, provider }),
    cookieValue: b64urlEncode({ nonce, userId, provider }),
  };
}

/**
 * Verify a callback: the `state` param must decode, a cookie must be present, the two
 * nonces must match, and the provider must line up. Returns the COOKIE's userId as the
 * authoritative identity — the state's userId is never trusted.
 */
export function verifyOAuthState(
  stateParam: string | null,
  cookieValue: string | undefined,
  provider: OAuthProvider,
): { ok: true; userId: string } | { ok: false; reason: string } {
  if (!stateParam) return { ok: false, reason: "missing_state" };
  if (!cookieValue) return { ok: false, reason: "missing_cookie" };
  let state: { nonce?: string; provider?: string };
  let cookie: { nonce?: string; userId?: string; provider?: string };
  try {
    state = b64urlDecode(stateParam);
    cookie = b64urlDecode(cookieValue);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!state.nonce || !cookie.nonce || state.nonce !== cookie.nonce) {
    return { ok: false, reason: "nonce_mismatch" };
  }
  if (cookie.provider !== provider || state.provider !== provider) {
    return { ok: false, reason: "provider_mismatch" };
  }
  if (!cookie.userId) return { ok: false, reason: "no_user" };
  return { ok: true, userId: cookie.userId };
}
