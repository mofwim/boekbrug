"use client";

// src/app/verificatie/VerificatieClient.tsx
// [2FA] The second step, as the owner types it.
//
// ── THE ONE THING THIS SCREEN MUST NEVER GET WRONG ──
//
// It must never tell someone that a correct code is invalid.
//
// The person reading this screen is holding a phone with six digits on it and cannot reach their
// own administration — records they are legally obliged to keep for seven years and may have to
// hand over this week. If we answer a 429, a dropped connection or a GoTrue hiccup with "that
// code is not right", they read it as a fact about their phone: the app and the authenticator
// disagree, the lock is broken, and there is nothing left to try. They stop retrying the one
// thing that would have worked in ten seconds, and start looking for a password reset that
// cannot help them, because the password was never the problem.
//
// So there are exactly THREE outcomes here and they never blur into one another:
//
//   verified            → onwards to where the middleware was taking them
//   the code was wrong  → mfa.fout.ongeldig, which points at the newest code in the app
//   anything else       → mfa.fout.mislukt, whose Dutch says in so many words that this does NOT
//                         mean the code was wrong
//
// The middle outcome is reached ONLY on a signal that actually means "wrong code" (see
// isWrongCode below). Everything unrecognised falls to the third, and that asymmetry is the
// point: "we could not check" is true of every failure, while "your code is wrong" is a claim
// about what the owner typed — and we may only make that claim when the server made it first.
//
// ── AND THE WAY OUT IS ALWAYS ON THE SCREEN ──
//
// mfa.kwijt.* and the sign-out button are not an error state and are not hidden behind a failed
// attempt: they render from the first paint. Someone whose phone is at the bottom of a canal
// cannot make this form succeed no matter how carefully they read it, and a lock with no visible
// way to step back from it is a trap. src/lib/mfa.ts keeps /login reachable at aal1 for exactly
// this reason; this is the button that uses it.

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { COLUMN, FONT, M3, R } from "@/lib/design/tokens";
import { LOCALE_META } from "@/lib/i18n/locale";
import { translator } from "@/lib/i18n/t";
import { useLocale } from "@/lib/i18n/use-locale";
import { isWrongCode, normaliseMfaCode } from "@/lib/mfa";
import { safeRedirect } from "@/lib/safe-redirect";
import { getBrowserClient } from "@/lib/supabase";

/**
 * Which of the two failure sentences this attempt earned. Kept as a reason, never as a finished
 * string: the component decides WHAT happened, and the catalogue decides how that reads in the
 * owner's language. A component that stores its own sentence is a component that stays Dutch
 * forever (see AGENTS.md — "a component holds no language of its own").
 */
type Failure = "wrongCode" | "couldNotCheck";


export default function VerificatieClient() {
  const locale = useLocale();
  const t = translator(locale);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // See the branch in verify(): the account has no verified factor, so this form has nothing to ask.
  const [nothingToVerify, setNothingToVerify] = useState(false);
  const codeField = useRef<HTMLInputElement>(null);

  // [SEC-REDIRECT] Where they were going when the middleware stopped them. Never used raw:
  // safeRedirect keeps it to a path on our own origin, because a `javascript:` URL handed to
  // router.replace is executed on our page — with the session that has just been promoted to
  // aal2. See src/lib/safe-redirect.ts.
  const destination = safeRedirect(searchParams.get("redirect"), "/dashboard");

  /**
   * Put the cursor back in the field with the digits selected, so the next keystroke replaces
   * them.
   *
   * Deliberately NOT clearing the field. A `couldNotCheck` code may well be correct and still
   * valid for another twenty seconds; wiping it would make the owner retype six digits to retry
   * something that was never their mistake. Selecting covers the other case just as well — a new
   * code overwrites the old one in one go.
   */
  function focusCode(): void {
    codeField.current?.focus();
    codeField.current?.select();
  }

  function fail(reason: Failure): void {
    setFailure(reason);
    setBusy(false);
    focusCode();
  }

  async function verify(): Promise<void> {
    // [DOUBLE-SUBMIT] Enter walks straight past a disabled button, and two challenges for one code
    // both count towards the rate limit that then blocks the CORRECT code. Same guard as /login.
    if (busy || signingOut) return;

    // Refuse anything that is not six digits before touching the network. A challenge spent on
    // four digits is a request that can only fail, and its failure is charged to the same limit
    // the real attempt needs. normaliseMfaCode also strips the space in "123 456" as the app
    // prints it and the one a password manager pastes — see src/lib/mfa.ts, which exists because
    // a code that is right on the screen and wrong in the request is a support ticket that reads
    // "it says my code is invalid" from someone holding a correct code.
    const normalised = normaliseMfaCode(code);
    if (normalised === null) {
      // Not "we could not check": nothing was checked and nothing went wrong on our side. What is
      // in the field is not a code, and mfa.fout.ongeldig is the sentence that says so and points
      // at the app for the current one.
      setFailure("wrongCode");
      focusCode();
      return;
    }

    setBusy(true);
    setFailure(null);

    try {
      const supabase = getBrowserClient();

      // Which factor to challenge. listFactors() reads the user, so this is a network call in its
      // own right and fails in its own way — none of which is evidence about the code.
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError || !data) return fail("couldNotCheck");

      // The first VERIFIED factor, looked for in `all` rather than in `totp`.
      //
      // That difference is a lockout. getAuthenticatorAssuranceLevel() sets nextLevel to 'aal2' for
      // ANY verified factor (auth-js counts session.user.factors without caring which kind), while
      // this app only ever ENROLS totp. So a factor of another type — added from the Supabase
      // dashboard, or by a version of this app that has learned passkeys — makes the middleware
      // challenge every page while a totp-only search here finds nothing, answers "we could not
      // check" to every correct code, and leaves Instellingen behind the same gate. Every screen
      // shut, forever, with no message that explains it. Reading `all` keeps the two definitions of
      // "there is a factor" the same one, and challengeAndVerify handles the other types.
      const verified = data.all.filter((f) => f.status === "verified");
      // totp first when there is a choice: it is what this app enrols and what the screen asks for.
      const factor = verified.find((f) => f.factor_type === "totp") ?? verified[0];
      // No verified factor at all. The middleware cannot have sent them here for one — mfaGate only
      // challenges when nextLevel is 'aal2', which means a verified factor exists — so this is a
      // stale bookmark, or a /login?redirect=%2Fverificatie that came from somewhere else.
      //
      // NOT "we could not check": there is nothing to check, and a screen that keeps asking for a
      // code from an app they never set up is a dead end with no message that explains it. Say what
      // is true and put the way forward on the screen. A LINK and not a redirect — this page never
      // sends anyone anywhere by itself (see page.tsx), and a link is something the owner does.
      if (!factor) {
        setNothingToVerify(true);
        setBusy(false);
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: normalised,
      });
      if (verifyError) return fail(isWrongCode(verifyError) ? "wrongCode" : "couldNotCheck");

      // Verified — the session is aal2 from here, and mfaGate() will let it through.
      //
      // replace(), not push(): the challenge is answered and belongs behind them. A Back tap
      // should return to whatever they came from, not to a form that has nothing left to ask.
      //
      // refresh() after it, because every server component above this point was rendered for an
      // aal1 session. Without it the router may hand back a payload built while the second step
      // was still owed.
      //
      // `busy` deliberately stays true. The navigation is in flight, and a button that springs
      // back to "Verifiëren" invites a second submit of a code that has just been spent — which
      // would fail, and would say so on the screen of someone who did everything right.
      router.replace(destination);
      router.refresh();
    } catch {
      // A thrown error is the network dropping mid-request. It says nothing about the digits.
      fail("couldNotCheck");
    }
  }

  async function signOut(): Promise<void> {
    if (busy || signingOut) return;
    setSigningOut(true);

    // We leave whatever comes back. supabase-js clears the local session on every path it can and
    // keeps it only when the network call itself failed — and this button is the exit for someone
    // who CANNOT finish the form. Refusing to move because sign-out returned an error would leave
    // them looking at the lock with nothing left to press, which is the exact trap the way out
    // exists to prevent. In that one case /login sees a session that is still valid and sends them
    // back here, where the button is still where they left it.
    try {
      await getBrowserClient().auth.signOut();
    } catch {
      // Deliberately swallowed — see above.
    }
    router.push("/login");
  }

  const dir = LOCALE_META[locale].dir;
  const card = {
    background: M3.surface,
    border: `1px solid ${M3.hairline}`,
    borderRadius: R.lg,
    padding: 24,
  } as const;

  return (
    <div
      dir={dir}
      style={{
        minHeight: "100vh",
        background: M3.bg,
        fontFamily: FONT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: COLUMN.hub,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <section style={card}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: M3.onSurface, margin: "0 0 8px" }}>
            {t("mfa.titel")}
          </h1>

          {nothingToVerify && (
            <p
              role="status"
              style={{
                fontSize: 14,
                color: M3.onSurfaceVariant,
                background: M3.surfaceVariant,
                borderRadius: R.sm,
                padding: "10px 12px",
                lineHeight: 1.5,
                margin: "0 0 14px",
              }}
            >
              {t("mfa.nietsTeVerifieren")}{" "}
              <a href={destination} style={{ color: M3.primary, fontWeight: 600 }}>
                {t("mfa.verder")}
              </a>
            </p>
          )}
          <p style={{ fontSize: 14.5, color: M3.neutral, lineHeight: 1.6, margin: "0 0 18px" }}>
            {t("mfa.verificatie.uitleg")}
          </p>

          {/* In a <form>: Enter submits from the field and a phone keyboard offers a "Ga" key
              instead of a line break. No `required` and no `pattern` — native validation would
              answer in the BROWSER's language, which is not the language this owner chose, and
              would replace our sentence with a bubble we do not control. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <label
              htmlFor="mfa-code"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: M3.onSurfaceVariant,
                marginBottom: 6,
              }}
            >
              {t("mfa.code.label")}
            </label>

            <input
              id="mfa-code"
              ref={codeField}
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              // A code is not language. `dir="ltr"` keeps the six digits reading left to right and
              // the caret at the end in Arabic too: the contents of this field are the one thing
              // on this screen that is identical in every locale.
              dir="ltr"
              // numeric, not `type="number"` — a spinner on something that is not a quantity, and
              // browsers that quietly drop a leading zero from it.
              inputMode="numeric"
              // The authenticator code an OS may offer to fill.
              autoComplete="one-time-code"
              enterKeyHint="go"
              // This screen exists to be typed into, and it is the only thing on it. The keyboard
              // should be up before the owner has to ask for it.
              autoFocus
              // The one thing the owner typed is only invalid when the SERVER said so. On
              // "couldNotCheck" the value may be perfectly correct, and telling a screen reader it
              // is invalid would make the same false claim the visible text carefully avoids.
              aria-invalid={failure === "wrongCode" ? true : undefined}
              aria-describedby={failure ? "mfa-failure" : undefined}
              style={{
                width: "100%",
                minHeight: 48,
                padding: "0 12px",
                textAlign: "center",
                letterSpacing: "0.35em",
                // No fontSize or fontFamily here: globals.css declares both on `input` with
                // !important, so an inline value would be dead code that reads as intent.
              }}
            />

            {failure && (
              // role="alert" so the sentence is announced when it appears — the owner's attention
              // is on the field, not on the space below it.
              <p
                id="mfa-failure"
                role="alert"
                style={{
                  fontSize: 14,
                  color: M3.error,
                  background: M3.errorContainer,
                  borderRadius: R.sm,
                  padding: "10px 12px",
                  lineHeight: 1.5,
                  margin: "12px 0 0",
                }}
              >
                {failure === "wrongCode" ? t("mfa.fout.ongeldig") : t("mfa.fout.mislukt")}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || signingOut}
              style={{
                width: "100%",
                marginTop: 16,
                minHeight: 48,
                background: busy || signingOut ? M3.outline : M3.primary,
                color: M3.onPrimary,
                border: "none",
                borderRadius: R.md,
                fontSize: 15,
                fontWeight: 600,
                fontFamily: FONT,
                cursor: busy || signingOut ? "default" : "pointer",
              }}
            >
              {busy ? t("mfa.bezig") : t("mfa.verifieer")}
            </button>
          </form>
        </section>

        {/* The way out. Always here, never behind a failed attempt: the person who needs it most
            is the one for whom the form above can never work. */}
        <section style={card}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, margin: "0 0 6px" }}>
            {t("mfa.kwijt.titel")}
          </h2>
          <p style={{ fontSize: 13.5, color: M3.neutral, lineHeight: 1.6, margin: "0 0 14px" }}>
            {t("mfa.kwijt.uitleg")}
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={busy || signingOut}
            style={{
              width: "100%",
              minHeight: 44,
              background: M3.surface,
              color: M3.onSurface,
              border: `1px solid ${M3.outline}`,
              borderRadius: R.md,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: busy || signingOut ? "default" : "pointer",
            }}
          >
            {signingOut ? t("mfa.bezig") : t("mfa.uitloggen")}
          </button>
        </section>
      </div>
    </div>
  );
}
