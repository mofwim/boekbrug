// src/lib/mfa.ts
// [2FA] When does a session still owe a second step? The whole rule, and nothing that talks to a
// network. Run: npx tsx --test src/lib/mfa.test.ts
//
// ── WHY THIS IS A SEPARATE, TESTED FILE AND NOT THREE LINES IN THE MIDDLEWARE ──
//
// This decision runs on every navigation, and it is the only one in the app that can lock an
// entrepreneur out of records they are legally obliged to keep for seven years. Getting it wrong in
// one direction leaves the second step optional, which makes the lock decorative. Getting it wrong
// in the other direction bricks the account of someone who did exactly what we asked them to do.
//
// The middleware is the worst possible place to discover either. It has no tests of its own, it
// runs before anything else, and a redirect loop there is not a bug report — it is a user who
// cannot reach any page at all, including the one that would let them turn the feature off. So the
// rule lives here, in a function with no I/O, and the middleware only applies it.
//
// ── WHAT SUPABASE GIVES US ──
//
// getAuthenticatorAssuranceLevel() answers two things, and the pair is the whole signal:
//
//   currentLevel  what this session has ALREADY proved: 'aal1' password only, 'aal2' password + code
//   nextLevel     what it COULD prove — 'aal2' exactly when this user has a VERIFIED factor
//
// So `nextLevel === 'aal2' && currentLevel === 'aal1'` means: this person has switched two-step on,
// and this session has not done the second step yet. That is the only state that owes a challenge.
// A user with no factor has nextLevel 'aal1' and is never asked for anything — which is what makes
// this safe to ship before a single account has enrolled.
//
// It reads the session that is already in hand — verified at
// node_modules/@supabase/auth-js/dist/main/GoTrueClient.js: with no jwt argument it calls
// getSession(), decodes the `aal` claim out of the access token and counts session.user.factors
// with status 'verified'. No extra database round-trip on every navigation.
//
// ── AND IT COVERS /api, WHICH IS THE HALF THAT MATTERS ──
//
// A gate on pages alone is a lock on the shop door with the delivery entrance open. The attacker
// this feature exists to stop holds a stolen PASSWORD; signing in with it yields a perfectly valid
// session cookie at aal1, and every route under /api answers that cookie. He never needs a screen:
//   curl -H 'Cookie: sb-...' -X POST /api/invoice/send
// issues an invoice in the owner's name, in his doorlopende nummerreeks, which cannot afterwards be
// withdrawn — the exact harm the enrolment screen promises to prevent. So this rule takes the FULL
// path, /api included, and the middleware turns one answer into two shapes: a redirect for a page,
// a 403 for a fetch() caller that is expecting JSON.

/** The two levels Supabase reports, plus null for "we could not establish it". */
export type AalLevel = "aal1" | "aal2" | null;

/**
 * The assurance level as this app is willing to read it.
 *
 * Supabase types the level as its two values OR any other string (`AuthenticatorAssuranceLevels`
 * is `"aal1" | "aal2" | (string & {})`), so a level we have never heard of — a future "aal3",
 * anything a newer auth server starts sending — passes the type checker untouched. Everything
 * outside the two becomes null, which is this module's "unknown" and leans to allow. Guessing what
 * an unfamiliar level means is how a server-side upgrade we did not ask for locks an owner out of
 * his own books.
 *
 * Here rather than in each caller: the middleware and the password-recovery screen both read the
 * same two values from the same API, and two copies of "which strings do we recognise" is how one
 * of them quietly starts recognising a third.
 */
export function asAalLevel(level: string | null | undefined): AalLevel {
  return level === "aal1" || level === "aal2" ? level : null;
}

/**
 * Where the second step is asked for. One constant: the rule exempts this path, the middleware
 * redirects to it, and the screen lives at it. Three copies of a path string is how a redirect
 * loop is built — the exemption and the destination drift apart and the browser bounces forever.
 */
export const MFA_CHALLENGE_PATH = "/verificatie";

/**
 * Paths that must stay reachable while a session is stuck at aal1.
 *
 * Everything NOT on this list is behind the second step — pages and API routes alike. The list is
 * short on purpose: each entry is a hole, and each one below names the failure that keeping it
 * closed would cause.
 *
 * ── THE WAY OUT ──
 *
 * The challenge page itself, obviously. But also the door OUT: someone who has lost their phone on
 * a business trip must still be able to get back to the login. A lock with no way to step back from
 * it is not a security feature, it is a trap — and the person in it is locked out of their own tax
 * records with a filing deadline running.
 *
 * "/uitloggen" was on this list, and it is not any more: no such route exists in src/app. Signing
 * out is a BUTTON on the challenge screen — supabase.auth.signOut() and then /login — so the exit
 * is real, but it is not a path and this list must not claim it is. An exemption for a route that
 * does not exist reads as a door in the plan of a building that has none, and the next person to
 * check whether the way out is covered will find it and stop looking.
 *
 * ── THE CUSTOMER'S OWN PAGES ──
 *
 * /pay and /offerte are read by the OWNER'S CUSTOMER, and the token in the link is the access — the
 * session plays no part in what they show. They are on this list because of a case that is not
 * hypothetical in a Dutch zzp app: BoekBrug's users invoice each other. One of them clicks a
 * payment link in his e-mail, in the browser where he is signed in to his own administration with
 * two-step on, and without this line he lands on a verification screen for an account that has
 * nothing to do with the invoice he was asked to pay. He would conclude the link is broken.
 *
 * ── API ROUTES THE SESSION DOES NOT AUTHORISE ──
 *
 * The principle, and the only one that keeps this list from growing by guesswork: a route that does
 * not read THIS user's session cannot be protecting this user's administration, so challenging it
 * buys nothing and breaks a flow. /api/cron carries CRON_SECRET and runs with no user at all;
 * /api/health is the diagnostic that has to answer during an outage; /api/well-known is fetched by
 * Android's link verifier.
 *
 * The OAuth callbacks (Google, Outlook, Enable Banking) were on this list and are NOT any more,
 * and the reasoning is worth keeping because it looks like a mistake. A 403 there would kill a
 * connection half-made — but no honest session can arrive at one owing the second step: the flow is
 * STARTED from Instellingen, which is behind the gate, so anyone landing on a callback passed
 * /verificatie minutes earlier and is at aal2 (the level does not decay). The only session that can
 * reach a callback at aal1 is one that never came through the settings screen, which is the stolen
 * one. Same for /api/tools: the scanner's own page is gated, and a visitor with no session at all
 * never reaches this rule.
 *
 * ── THE DOCUMENTS THAT MAY NOT DISAPPEAR BEHIND A LOCK ──
 *
 * The privacy statement, the terms, the cookie policy and the eerlijk-gebruik policy. They were not
 * on this list, and everything not on this list is behind the step — so a signed-in owner who had
 * not yet typed a code was bounced from /privacy to /verificatie, and could only read the privacy
 * statement of the app holding his administration by signing OUT of it first.
 *
 * That is the same failure the [ENV-DEGRADE] block in src/middleware.ts names by hand: /privacy and
 * /voorwaarden have to stay reachable, because AVG art. 13 makes the privacy statement part of the
 * lawfulness of processing, and /eerlijk-gebruik is called "volledig openbaar" in the terms it is
 * part of (§5.2). A document that is legally required to be available is not something to hold
 * hostage to a second factor.
 *
 * It also costs nothing by this list's own principle: these four are static text, they read no
 * session, and challenging a page that shows the same words to a stranger protects nothing.
 *
 * Deliberately these four and NOT isPublic(): that list also holds /wachtwoord-herstellen, and
 * exempting THAT would hand the whole feature to whoever can read the owner's e-mail — reset link,
 * new password, straight in. See the test named for it.
 *
 * Everything else — every screen, and every route that reads the session — is behind the step. That
 * includes /api/invoice/send, /api/invoice/draft and the whole bank surface, which is the point.
 */
const REACHABLE_AT_AAL1 = [
  // The challenge, and the way back out of it.
  MFA_CHALLENGE_PATH,
  "/login",

  // The documents that may not disappear behind a lock. Static text, no session read.
  "/privacy",
  "/voorwaarden",
  "/cookies",
  "/eerlijk-gebruik",

  // The customer's own pages: the token is the access, not the session.
  "/pay",
  "/offerte",
  "/api/pay",
  "/api/offerte",

  // Routes no session authorises.
  "/api/cron",
  "/api/health",
  "/api/well-known",
] as const;

export type MfaGate =
  /** Nothing owed. Either no factor exists, or this session already proved it. */
  | { action: "allow" }
  /** This session owes the second step before it may see anything else. */
  | { action: "challenge" };

const ALLOW: MfaGate = { action: "allow" };
const CHALLENGE: MfaGate = { action: "challenge" };

/**
 * Does this request owe a second step?
 *
 * ── THE DIRECTION EVERY BRANCH LEANS, AND WHY ──
 *
 * There is exactly ONE state that challenges: a verified factor exists AND this session has not
 * used it. Everything else allows, and that is deliberate rather than lazy:
 *
 *   · No factor (nextLevel 'aal1'). Nothing to ask for. Asking anyway would lock out every user who
 *     has never enrolled — which, on the day this ships, is all of them.
 *   · Already aal2. The step is done. Asking again on every navigation is a loop.
 *   · UNKNOWN (either level null). This is the branch worth arguing about, so: it allows.
 *
 *     Failing open on a security control is normally wrong, and it is right here for one reason —
 *     the password check has ALREADY passed before this function is ever called. The question is
 *     not "may this stranger in", it is "has this authenticated person also proved the second
 *     factor", and null means we could not tell. Answering "no, and therefore out" turns any
 *     hiccup in reading a session into a lockout from seven years of records that the
 *     Belastingdienst can ask for tomorrow.
 *
 *     The attacker this feature exists to stop holds a stolen password. Nothing about holding a
 *     password lets them make getAuthenticatorAssuranceLevel() return null — that value comes from
 *     the session token our own server just read. So the open branch does not hand them anything;
 *     it only refuses to punish the owner for our own uncertainty.
 *
 *     If that reasoning ever stops holding — if a null becomes something a caller can induce — this
 *     is the line to change, and the test named for it is the one that will need rewriting.
 */
export function mfaGate(args: {
  currentLevel: AalLevel;
  nextLevel: AalLevel;
  pathname: string;
}): MfaGate {
  const { currentLevel, nextLevel, pathname } = args;

  // The exemptions come first, before any reasoning about levels. A challenge page that is itself
  // challenged is an infinite redirect, and it would take the sign-out with it.
  if (REACHABLE_AT_AAL1.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return ALLOW;

  return owesSecondStep(currentLevel, nextLevel) ? CHALLENGE : ALLOW;
}

/**
 * The level half of the rule, without the paths: has this person switched two-step on, and has
 * THIS session not done it yet?
 *
 * Separate from mfaGate because one caller has no pathname to ask about. The password-recovery
 * screen establishes its session in the BROWSER — exchangeCodeForSession() on a page that was
 * loaded before any session existed — so no navigation happens between "this person is now signed
 * in" and "this person is now changing the password", and the middleware never gets a request to
 * judge. That is the classic way a second factor is walked around: take the mailbox, ask for a
 * reset link, choose a new password, sign in. Every branch and its direction is documented at
 * mfaGate above; this is the same reasoning with the exemption list left out.
 */
export function owesSecondStep(currentLevel: AalLevel, nextLevel: AalLevel): boolean {
  if (nextLevel !== "aal2") return false; // no verified factor: nothing is owed
  if (currentLevel === "aal2") return false; // already proved this session
  if (currentLevel !== "aal1") return false; // unknown — see the note at mfaGate
  return true;
}

/**
 * Has this person switched two-step on at all?
 *
 * Read off the same pair, so the settings screen and the gate can never disagree about whether the
 * feature is on. `nextLevel === 'aal2'` is Supabase's own way of saying "a VERIFIED factor exists"
 * — an enrolment that was started and never confirmed does not count, which is exactly right: a
 * half-finished enrolment must not make the screen claim the account is protected.
 */
export function mfaIsOn(nextLevel: AalLevel): boolean {
  return nextLevel === "aal2";
}

/**
 * The six digits, as a person actually types them.
 *
 * Authenticator apps show "123 456", people paste from a password manager with a trailing space,
 * and phone keyboards insert a non-breaking space. Supabase compares the string it is given, so a
 * code that is right on the screen and wrong in the request is a support ticket that reads "it says
 * my code is invalid" from someone holding a correct code. Every non-digit goes, and the result is
 * only accepted at exactly six.
 *
 * Returns null when it is not six digits, so the caller can refuse before spending a challenge.
 */
export function normaliseMfaCode(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

/** The shape of a Supabase AuthError, without importing the class — as in src/lib/auth-errors.ts. */
interface RawAuthError {
  code?: string;
  status?: number;
  message?: string;
}

/**
 * Did the SERVER say that these six digits are not the right six digits?
 *
 * ── THE ASYMMETRY THIS FUNCTION EXISTS FOR ──
 *
 * "We could not check your code" is true of every failure. "Your code is wrong" is a claim about
 * what the owner just typed, and we may only make it when the server made it first. Get that
 * backwards and someone holding a CORRECT code is told their authenticator disagrees with us —
 * they read it as a fact about their phone, stop retrying the one thing that would have worked in
 * ten seconds, and go looking for a password reset that cannot help, because the password was
 * never the problem. On the challenge screen that person is locked out of seven years of records
 * with a filing deadline running.
 *
 * So: only `mfa_verification_failed` means the code was wrong. `mfa_challenge_expired`,
 * `over_request_rate_limit`, `mfa_ip_address_mismatch`, a 500, a timeout, a factor that vanished
 * between two calls — every one of those is a statement about the REQUEST.
 *
 * The HTTP status is deliberately not consulted. A wrong code, an expired challenge, a rate limit
 * and a stale JWT all come back as 4xx, so a status test folds three "try again in a moment" cases
 * into the one sentence that tells the owner to stop trusting their app.
 *
 * The message match is a fallback for the same reason auth-errors.ts keeps one: older and
 * self-hosted GoTrue builds send a message and no code. Narrow on purpose — a substring of an
 * English server string, never something a translation would move.
 *
 * Here rather than in each screen: the challenge and the enrolment panel both have to answer this
 * question, and two copies of "which failure is the owner's fault" is how one of them starts
 * blaming people for a rate limit.
 */
export function isWrongCode(error: unknown): boolean {
  const e = (error ?? {}) as RawAuthError;
  if (e.code === "mfa_verification_failed") return true;
  const text = e.message?.toLowerCase() ?? "";
  return text.includes("invalid totp") || text.includes("invalid mfa") || text.includes("invalid code");
}
