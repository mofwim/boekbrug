// [2FA] Run: npx tsx --test src/lib/mfa.test.ts
//
// This rule decides, on every navigation, whether someone may reach their own bookkeeping. Both
// ways of being wrong are severe and they are opposites, so every case below says which way its
// failure runs — a test that only checked the return value would pass just as happily on the
// version that locks everyone out.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isWrongCode, mfaGate, mfaIsOn, normaliseMfaCode, owesSecondStep, MFA_CHALLENGE_PATH } from "./mfa";

const at = (currentLevel: "aal1" | "aal2" | null, nextLevel: "aal1" | "aal2" | null, pathname = "/dashboard") =>
  mfaGate({ currentLevel, nextLevel, pathname }).action;

// ─── The one state that challenges ───────────────────────────────────────────────────

test("[2FA] a verified factor that this session has not used owes the second step", () => {
  // The whole point. If this ever returns 'allow', the lock is decorative: a stolen password walks
  // straight into an administration where it can mint permanent invoice numbers.
  assert.equal(at("aal1", "aal2"), "challenge");
});

// ─── Everything that must NOT challenge ──────────────────────────────────────────────

test("[2FA] nobody without a factor is ever asked for anything", () => {
  // On the day this ships that is EVERY account. A wrong answer here is not a security bug, it is
  // every user of the app locked out at once, with no screen left to turn the feature off from.
  assert.equal(at("aal1", "aal1"), "allow");
  assert.equal(at("aal2", "aal1"), "allow");
});

test("[2FA] a session that already proved the second step is not asked again", () => {
  // Asking again on every navigation is not strictness, it is a redirect loop.
  assert.equal(at("aal2", "aal2"), "allow");
});

test("[2FA] an unknown level allows, because the password already passed", () => {
  // The branch worth arguing about, argued in the module header. Answering 'challenge' on a level
  // we could not read turns any hiccup into a lockout from seven years of records — and it hands a
  // password thief nothing, because nothing about holding a password produces a null here.
  assert.equal(at(null, null), "allow");
  assert.equal(at(null, "aal2"), "allow");
  assert.equal(at("aal1", null), "allow");
  // An unrecognised string from a future Supabase is 'unknown' too, and leans the same way.
  assert.equal(mfaGate({ currentLevel: "aal3" as never, nextLevel: "aal2", pathname: "/dashboard" }).action, "allow");
});

// ─── The exits, which are what stop a lock being a trap ──────────────────────────────

test("[2FA] the challenge page never challenges itself", () => {
  // Without this the redirect points at a page that redirects to itself: the browser bounces
  // forever and there is no screen left to type the code into.
  assert.equal(at("aal1", "aal2", MFA_CHALLENGE_PATH), "allow");
  assert.equal(at("aal1", "aal2", `${MFA_CHALLENGE_PATH}/hulp`), "allow");
});

test("[2FA] someone who lost their phone can still reach the login", () => {
  // A lock with no way to step back from it is a trap, and the person in it is locked out of their
  // own tax records with a filing deadline running. Signing out itself is a button on the challenge
  // screen rather than a route — see the note on the list — so /login is the path that has to stay
  // open, and it is the one the button lands on.
  assert.equal(at("aal1", "aal2", "/login"), "allow");
});

test("[2FA] the four legal documents never disappear behind the lock", () => {
  // The same requirement [ENV-DEGRADE] in the middleware names by hand: AVG art. 13 wants these
  // reachable. Without this the owner of an administration could read the privacy statement of the
  // app holding his books only by signing OUT of it first — and they are static text that reads no
  // session, so challenging them protects nothing at all.
  for (const p of ["/privacy", "/voorwaarden", "/cookies", "/eerlijk-gebruik"]) {
    assert.equal(at("aal1", "aal2", p), "allow", `${p} must stay readable`);
  }
  // But NOT the whole public list: /wachtwoord-herstellen is public too, and exempting it would
  // hand the feature to whoever reads the owner's mailbox.
  assert.equal(at("aal1", "aal2", "/wachtwoord-herstellen"), "challenge");
});

test("[2FA] the privacy statement and the terms stay readable while the code is owed", () => {
  // Everything not exempt is behind the step, so without these four the owner of the administration
  // was bounced from /privacy to /verificatie and could only read the privacy statement of the app
  // that holds his books by signing OUT of it. AVG art. 13 makes that document part of the
  // lawfulness of the processing, and the terms call /eerlijk-gebruik "volledig openbaar" (§5.2).
  // They are static text that reads no session, so the step protects nothing here.
  for (const p of ["/privacy", "/voorwaarden", "/cookies", "/eerlijk-gebruik"]) {
    assert.equal(at("aal1", "aal2", p), "allow", `${p} must stay readable at aal1`);
  }
});

test("[2FA] the exemption is a path, not a prefix that opens the app", () => {
  // "/login" must not exempt "/loginachtige-pagina", and the challenge path must not exempt a
  // sibling that merely starts with the same letters — that would be a hole shaped like a typo.
  assert.equal(at("aal1", "aal2", "/loginachtig"), "challenge");
  assert.equal(at("aal1", "aal2", `${MFA_CHALLENGE_PATH}achtig`), "challenge");
});

test("[2FA] every other screen is behind the step, including the money ones", () => {
  for (const p of ["/dashboard", "/dashboard/facturen", "/dashboard/bank", "/onboarding", "/dashboard/logboek"]) {
    assert.equal(at("aal1", "aal2", p), "challenge", `${p} must be behind the second step`);
  }
});

// ─── The API, which is where a stolen password actually goes ─────────────────────────

test("[2FA] the routes that move money are behind the step, not just the screens that show it", () => {
  // A gate on pages alone is a lock on the shop door with the delivery entrance open: the attacker
  // holds a PASSWORD, so he holds a valid aal1 cookie, and one curl at /api/invoice/send issues an
  // invoice in the owner's name and permanent number series. If any of these ever answers 'allow',
  // the enrolment screen is making a promise the app does not keep.
  for (const p of [
    "/api/invoice/send",
    "/api/invoice/draft",
    "/api/invoice/123/reminder",
    "/api/bank/attach-invoice",
    "/api/company/members",
    "/api/clients",
    "/api/logboek",
  ]) {
    assert.equal(at("aal1", "aal2", p), "challenge", `${p} must be behind the second step`);
  }
});

test("[2FA] the customer's own pages are not locked behind the owner's second step", () => {
  // BoekBrug users invoice each other. One clicks a payment link in the browser where he is signed
  // in to his own administration; without these he gets a verification screen for an account that
  // has nothing to do with the invoice he was asked to pay, and reads it as a broken link.
  assert.equal(at("aal1", "aal2", "/pay/abc123"), "allow");
  assert.equal(at("aal1", "aal2", "/offerte/abc123"), "allow");
  assert.equal(at("aal1", "aal2", "/api/pay/abc123"), "allow");
  assert.equal(at("aal1", "aal2", "/api/offerte/abc123"), "allow");
});

test("[2FA] the routes no session authorises keep answering", () => {
  // A 403 here does not protect this administration — none of these reads its session. It just
  // stops a cron or blinds the diagnostic during an outage.
  assert.equal(at("aal1", "aal2", "/api/cron/reminders"), "allow");
  assert.equal(at("aal1", "aal2", "/api/health"), "allow");
});

test("[2FA] an OAuth callback is NOT exempt, and that is deliberate", () => {
  // It looks like a mistake, so it is pinned. A 403 on a callback would kill a bank or mailbox
  // connection half-made — but no honest session can arrive at one owing the second step: the flow
  // is started from Instellingen, which is behind the gate, so the session that lands here passed
  // /verificatie minutes ago and is at aal2 (the level does not decay). The only session that
  // reaches a callback at aal1 is one that never came through the settings screen.
  assert.equal(at("aal1", "aal2", "/api/email/callback/gmail"), "challenge");
  assert.equal(at("aal1", "aal2", "/api/bank/enablebanking/callback"), "challenge");
});

test("[2FA] an exempt API prefix does not open its neighbours", () => {
  // "/api/pay" must not exempt "/api/payment-something", and "/pay" must not exempt "/payroll".
  // The same typo-shaped hole the screen test above pins, on the side where it costs money.
  assert.equal(at("aal1", "aal2", "/api/payments"), "challenge");
  assert.equal(at("aal1", "aal2", "/payroll"), "challenge");
  assert.equal(at("aal1", "aal2", "/api/cronjobs"), "challenge");
});

// ─── The reset link, which is how a second factor is usually walked around ───────────

test("[2FA] choosing a new password is behind the second step", () => {
  // Take the mailbox, ask for a reset link, choose a new password, sign in. If /wachtwoord-
  // herstellen were exempt here, two-step would protect nothing against the one attacker who
  // already reads the owner's e-mail.
  assert.equal(at("aal1", "aal2", "/wachtwoord-herstellen"), "challenge");
  assert.equal(at("aal1", "aal2", "/wachtwoord-vergeten"), "challenge");
});

test("[2FA] the level rule stands on its own, for the caller that has no path to ask about", () => {
  // The recovery screen signs itself in with exchangeCodeForSession() and then changes the
  // password, without a navigation in between — so the middleware never sees a request and the
  // page has to ask the same question itself. Same answers as the gate, minus the exemptions.
  assert.equal(owesSecondStep("aal1", "aal2"), true);
  assert.equal(owesSecondStep("aal2", "aal2"), false);
  assert.equal(owesSecondStep("aal1", "aal1"), false);
  assert.equal(owesSecondStep(null, null), false);
  assert.equal(owesSecondStep(null, "aal2"), false);
});

// ─── Is it on at all ─────────────────────────────────────────────────────────────────

test("[2FA] a half-finished enrolment does not make the screen claim you are protected", () => {
  // nextLevel only reaches 'aal2' once a factor is VERIFIED. Someone who scanned the QR, never
  // typed the code and closed the tab has no protection, and must not be told they have.
  assert.equal(mfaIsOn("aal2"), true);
  assert.equal(mfaIsOn("aal1"), false);
  assert.equal(mfaIsOn(null), false);
});

// ─── The code as a person actually types it ──────────────────────────────────────────

test("[2FA] the code survives the way it is really entered", () => {
  // Authenticator apps print "123 456"; password managers paste a trailing space; phone keyboards
  // slip in a non-breaking one. Supabase compares the string it is handed, so without this the
  // support ticket reads "it says my code is invalid" from someone holding a correct code.
  assert.equal(normaliseMfaCode("123456"), "123456");
  assert.equal(normaliseMfaCode("123 456"), "123456");
  assert.equal(normaliseMfaCode(" 123456 "), "123456");
  assert.equal(normaliseMfaCode("123 456"), "123456");
  assert.equal(normaliseMfaCode("123-456"), "123456");
});

test("[2FA] anything that is not six digits is refused before a challenge is spent", () => {
  for (const bad of ["", "12345", "1234567", "abcdef", "12 34", "  "]) {
    assert.equal(normaliseMfaCode(bad), null, `"${bad}" must not pass as a code`);
  }
  assert.equal(normaliseMfaCode(undefined as never), null);
});

// ─── Whose fault the failure was ─────────────────────────────────────────────────────

test("[2FA] only the server saying so makes it the owner's code that was wrong", () => {
  assert.equal(isWrongCode({ code: "mfa_verification_failed", status: 400 }), true);
  // The fallback for older and self-hosted GoTrue builds, which send a message and no code.
  assert.equal(isWrongCode({ message: "Invalid TOTP code entered" }), true);
});

test("[2FA] a rate limit is never reported as a wrong code", () => {
  // This is the whole asymmetry. Every one of these is a statement about the REQUEST, and telling
  // someone holding a correct code that their code is wrong is how they conclude the lock is
  // broken and stop retrying the one thing that would have worked.
  for (const error of [
    { code: "over_request_rate_limit", status: 429 },
    { code: "mfa_challenge_expired", status: 401 },
    { code: "mfa_ip_address_mismatch", status: 401 },
    { status: 500, message: "Internal Server Error" },
    { message: "fetch failed" },
    {},
    null,
    undefined,
  ]) {
    assert.equal(isWrongCode(error), false, `${JSON.stringify(error)} says nothing about the digits`);
  }
});
