"use client";

// src/components/settings/TweestapsPaneel.tsx
// [2FA] Switching the second step on, and off, from Instellingen.
//
// The name of this file is Dutch because the feature ships under that word; everything inside it
// is English, as AGENTS.md requires.
//
// ── WHY THIS SCREEN IS NOT AN ORDINARY TOGGLE ──
//
// A mandated boekhouder and an invited medewerker both issue invoices in the owner's unbroken
// number series, under the owner's BTW number. A stolen password is therefore not access to a
// dashboard: it is the authority to create documents that cannot be withdrawn afterwards. That is
// what the second step closes off, and it is why the switch is worth its own panel rather than a
// checkbox in the profile form.
//
// It cuts the other way too, and harder. Turning this on hands the owner's access to a device they
// might drop in a canal, and behind that access are records the Belastingdienst can ask for over
// seven years. So the lockout sentence is said BEFORE the switch, next to the secret that is the
// only way back — not in a confirmation afterwards, when the QR is already gone.
//
// ── THE THREE STATES, AND THE FOURTH THAT MOST PANELS FORGET ──
//
//   off          no verified factor. The invitation, the reason, and one button.
//   enrolling    a factor exists but is UNVERIFIED — Supabase still reports the account as off,
//                and so does this panel. A half-finished enrolment never claims protection.
//   on           at least one verified factor. Devices, add another, remove one, switch off.
//   unreadable   we could not establish which of the three it is.
//
// The fourth is the one that matters. Rendering "Staat uit" when the READ failed invites someone
// to switch on a thing that is already on — and the enrol call would then fail with a conflict
// that reads like a bug, on a screen that has just told them a falsehood about their own account.
// [NO-SILENT-EMPTY]: an unreadable account says so and offers nothing to press.
//
// "Is it on" is mfaIsOn(nextLevel) from src/lib/mfa.ts — the SAME function the middleware gate
// uses. Two definitions of "on" is how a screen ends up claiming the lock is off while every
// navigation is being challenged for a code.

import { useEffect, useState } from "react";

import { LOCALE_META } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/messages";
import { translator } from "@/lib/i18n/t";
import { useLocale } from "@/lib/i18n/use-locale";
import { isWrongCode, mfaIsOn, normaliseMfaCode, type AalLevel } from "@/lib/mfa";
import { getBrowserClient } from "@/lib/supabase";

/** One verified TOTP factor, as much of it as this panel shows. */
type Device = { id: string; friendly_name?: string; created_at: string };

/**
 * What the last read of the account said.
 *
 * "unreadable" is a state of its own and never folds into "off" — see the header. "known" carries
 * both answers together because they come from the same read: a list of devices next to an "on"
 * that was decided somewhere else is a pair that can disagree.
 */
type Account =
  | { state: "reading" }
  | { state: "unreadable" }
  | { state: "known"; on: boolean; devices: Device[] };

/** An enrolment in flight: the factor exists on the account, unverified, until the code confirms it. */
type Enrolment = { factorId: string; qrCode: string; secret: string };


/**
 * A friendly name GoTrue will accept next to the ones already on the account.
 *
 * Factor names must be unique per user: enrolling a second device under a name that already exists
 * comes back as `mfa_factor_name_conflict`, which would surface as "aanzetten is niet gelukt" for a
 * reason that has nothing to do with the owner and that no retry can fix. The local timestamp makes
 * it unique per second, and doubles as the only useful thing to print next to a device in the list
 * — "which one is this" is answered by when it was added.
 *
 * Stored on the account, so it stays Dutch-neutral rather than translated (AGENTS.md: values that
 * live in a store are not screen text). It is a product name and a date; there is nothing to
 * translate in it.
 */
function newDeviceName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `BoekBrug ${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * The `src` for the QR image.
 *
 * GoTrue returns `qr_code` as an SVG. Current servers hand over a complete `data:` URI; supabase-js
 * still documents the other shape ("convert it to a URL by prepending data:image/svg+xml;utf-8,"),
 * and self-hosted builds lag. Handing bare markup to an <img> renders NOTHING — a blank square
 * where the one thing this panel exists to show should be, with no error in the console and no way
 * for the owner to know that scanning is not the problem. So both shapes are accepted.
 *
 * The markup is percent-encoded rather than pasted in raw: a `#` anywhere in the SVG would cut the
 * data URI off at that character and produce the same blank square.
 */
function qrSource(raw: string): string {
  const svg = raw.trimStart();
  return svg.startsWith("data:") ? svg : `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Read the account: which devices are verified, and whether the feature counts as on.
 *
 * Returns the answer instead of storing it, and lives outside the component for that reason: a
 * caller that has just CHANGED something needs the fresh answer in hand to say what the change
 * did, and the mount effect needs it without a setState the React compiler rule would (rightly)
 * refuse. "Staat uit" is a claim about the account, and it is only ever made after a read said so.
 *
 * ── [2FA-STALE] WHY THE ON/OFF BADGE IS NOT READ FROM getAuthenticatorAssuranceLevel() ──
 *
 * It used to be, alongside this list, and the two do NOT come from the same place — which is the
 * bug that taught us. listFactors() calls getUser(), so it asks the SERVER and answers with what is
 * true this second. getAuthenticatorAssuranceLevel() called without a jwt does not: it reads the
 * session that is already in the cookie and counts session.user.factors (its own doc comment says
 * it "rarely uses the network"), and NOTHING rewrites that stored user when a factor is removed —
 * _unenroll() fires a DELETE and saves no session, _getUser() saves nothing either (verified in
 * node_modules/@supabase/auth-js/dist/main/GoTrueClient.js). Only a token refresh or a fresh sign-in
 * replaces it, so for the rest of the access token's life — up to an hour — the cached user still
 * lists a factor the server deleted minutes ago.
 *
 * That is not a cosmetic lag. Switching two-step OFF then read as: every factor gone (`totp` empty)
 * AND nextLevel still 'aal2'. So switchOff() below saw `on` still true, said "het is niet gelukt"
 * over an account it had just successfully unlocked, and left the green "Staat aan" badge above an
 * empty device list. Every retry repeated it, because there was nothing left to unenroll. The
 * mirror case is worse: a factor that WAS verified while the cached user predates it renders
 * "Staat uit" over an account that is protected — the exact false claim about someone's own
 * security this panel exists to avoid.
 *
 * So the fresh read decides, and it is the only read. mfaIsOn() still says what "on" MEANS — one
 * definition, shared with the middleware gate — it is simply handed the level this list implies
 * rather than the cached one. `all` and not `totp`, because that is precisely how Supabase computes
 * nextLevel: ANY verified factor, of any type, is a factor this account can be challenged on.
 */
async function readAccount(): Promise<Account> {
  try {
    const { data, error } = await getBrowserClient().auth.mfa.listFactors();
    if (error || !data) {
      // Loud, because a panel that quietly shows the wrong state is a failure that looks exactly
      // like success from the outside.
      console.error("[2FA] Could not read the account — not rendering it as switched off", {
        factors: error?.message,
      });
      return { state: "unreadable" };
    }
    // ONE set decides both answers. `all` and not `totp`, because that is what Supabase counts for
    // nextLevel — and a badge computed from one list beside a device list built from another is a
    // pair that can disagree: "Staat aan" over an empty list, or a device shown under "Staat uit".
    // Filtered to verified, so an enrolment that was started and abandoned is neither.
    const verified = data.all.filter((f) => f.status === "verified");
    const level: AalLevel = verified.length > 0 ? "aal2" : "aal1";
    return { state: "known", on: mfaIsOn(level), devices: verified };
  } catch (thrown) {
    console.error("[2FA] Reading the account threw — not rendering it as switched off", {
      error: thrown instanceof Error ? thrown.message : String(thrown),
    });
    return { state: "unreadable" };
  }
}

export function TweestapsPaneel() {
  const locale = useLocale();
  const t = translator(locale);

  const [account, setAccount] = useState<Account>({ state: "reading" });
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // Messages are held as KEYS, never as finished sentences. A component that stores its own text
  // keeps rendering the language it was in when the owner switched — see AGENTS.md ("a component
  // holds no language of its own").
  const [noticeKey, setNoticeKey] = useState<MessageKey | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  /** Read the account and put the answer on the screen. The answer is handed back too — see below. */
  async function refresh(): Promise<Account> {
    const next = await readAccount();
    setAccount(next);
    return next;
  }

  useEffect(() => {
    // One read when the card opens. The await comes first on purpose: the state is set after the
    // round-trip and never synchronously inside the effect body, which is what the React compiler
    // rule about cascading renders is there to stop.
    //
    // `alive` because a settings page that is closed mid-read would otherwise write into a
    // component that is gone.
    let alive = true;
    void (async () => {
      const next = await readAccount();
      if (alive) setAccount(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Remove a factor without telling the owner about it.
   *
   * Only ever used to clean up an enrolment that was cancelled or that failed to verify. The owner
   * has already been told what happened in that case; a second sentence about the cleanup would
   * describe plumbing they never asked about. If the cleanup itself fails there is nothing they
   * could do with that fact either — the factor is unverified, so it protects nothing and blocks
   * nothing except its own name.
   */
  async function discard(factorId: string): Promise<void> {
    try {
      await getBrowserClient().auth.mfa.unenroll({ factorId });
    } catch {
      // Deliberately swallowed — see above.
    }
  }

  /** Start (or restart) an enrolment: a new factor, a new QR, a new secret. */
  async function startEnrolment(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErrorKey(null);
    setNoticeKey(null);
    try {
      const { data, error } = await getBrowserClient().auth.mfa.enroll({
        factorType: "totp",
        friendlyName: newDeviceName(),
      });
      if (error || !data) {
        setErrorKey("mfa.fout.aanzetten");
        return;
      }
      setCode("");
      setEnrolment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch {
      setErrorKey("mfa.fout.aanzetten");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Confirm the enrolment with a code from the app. This is the moment the factor becomes real.
   *
   * ON ANY FAILURE THE FACTOR IS UNENROLLED AGAIN. An abandoned unverified factor is invisible
   * everywhere — nextLevel stays aal1, so every screen keeps saying "staat uit" — while it still
   * counts against the account's factor limit and still holds its name. Left to pile up, the
   * failure it eventually causes lands on a LATER, serious enrolment, as a conflict nobody can
   * connect to the mistyped code from three weeks ago.
   *
   * The price is honest and worth naming: a mistyped code costs a fresh scan, because the secret
   * behind the old QR is gone with the factor. The panel therefore drops back to its base state on
   * failure rather than leaving a QR on screen whose factor no longer exists — a picture of a lock
   * that has been thrown away is worse than no picture.
   */
  async function confirmEnrolment(): Promise<void> {
    if (busy || !enrolment) return;

    // Six digits or nothing, before the network is touched: a challenge spent on four digits can
    // only fail, and its failure counts towards the rate limit the real attempt needs.
    // normaliseMfaCode also strips the space in "123 456" as the app prints it — see src/lib/mfa.ts.
    const normalised = normaliseMfaCode(code);
    if (normalised === null) {
      setErrorKey("mfa.fout.ongeldig");
      return;
    }

    setBusy(true);
    setErrorKey(null);
    setNoticeKey(null);
    const { factorId } = enrolment;
    try {
      const { error } = await getBrowserClient().auth.mfa.challengeAndVerify({ factorId, code: normalised });
      if (error) {
        await discard(factorId);
        setEnrolment(null);
        setCode("");
        setErrorKey(isWrongCode(error) ? "mfa.fout.ongeldig" : "mfa.fout.aanzetten");
        await refresh();
        return;
      }
      // Verified. The session is aal2 from here, and every OTHER session the owner had is now
      // signed out — which is why mfa.waarschuwing.sessies was on the screen before this button.
      setEnrolment(null);
      setCode("");
      setNoticeKey("mfa.gelukt");
      await refresh();
    } catch {
      // A throw is the network dropping mid-request. It says nothing about the digits, so it never
      // becomes "die code klopt niet".
      await discard(factorId);
      setEnrolment(null);
      setCode("");
      setErrorKey("mfa.fout.aanzetten");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  /** Walk away from an enrolment. The unverified factor goes with it, for the reason above. */
  async function cancelEnrolment(): Promise<void> {
    if (busy || !enrolment) return;
    const { factorId } = enrolment;
    setBusy(true);
    setEnrolment(null);
    setCode("");
    setErrorKey(null);
    setNoticeKey(null);
    await discard(factorId);
    await refresh();
    setBusy(false);
  }

  /**
   * Remove one device — and say what that DID.
   *
   * Removing the last verified factor is not "a device was removed", it is the feature being
   * switched off, and the owner has to read it as that. Which of the two it was is decided by the
   * read that follows, never by counting the list we happened to render.
   *
   * A verified factor may only be removed by an aal2 session. Anyone looking at the "on" state
   * here has passed /verificatie, so that holds — except when the gate leaned open on an unknown
   * level (see src/lib/mfa.ts), and then this fails and says so instead of pretending.
   */
  async function removeDevice(factorId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErrorKey(null);
    setNoticeKey(null);
    try {
      const { error } = await getBrowserClient().auth.mfa.unenroll({ factorId });
      const after = await refresh();
      if (error && after.state === "known" && after.devices.some((d) => d.id === factorId)) {
        // It is still there — say so. mfa.fout.mislukt is the one sentence in the vocabulary that
        // claims nothing about what the owner did and asks them to try again in a moment.
        setErrorKey("mfa.fout.lezen");
        return;
      }
      if (after.state === "known" && !after.on) setNoticeKey("mfa.uit.gelukt");
    } catch {
      setErrorKey("mfa.fout.lezen");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  /** Switch the feature off: every verified factor goes. */
  async function switchOff(): Promise<void> {
    if (busy || account.state !== "known") return;
    setBusy(true);
    setErrorKey(null);
    setNoticeKey(null);
    try {
      const supabase = getBrowserClient();
      // One at a time, deliberately. Each unenroll re-reads the session; firing them in parallel
      // races on the same refresh and can leave a factor standing while every call reported fine.
      for (const device of account.devices) {
        try {
          await supabase.auth.mfa.unenroll({ factorId: device.id });
        } catch {
          // Kept going on purpose: one device that refuses to go must not leave the others behind
          // it untouched. Whether it worked is decided by the read below, not by this loop.
        }
      }
      const after = await refresh();
      if (after.state === "known" && !after.on) setNoticeKey("mfa.uit.gelukt");
      else setErrorKey("mfa.fout.lezen");
    } finally {
      setBusy(false);
    }
  }

  const dir = LOCALE_META[locale].dir;
  const primaryButton =
    "bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50";
  const quietButton =
    "border border-gray-300 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50";

  return (
    <div dir={dir} className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t("mfa.titel")}</p>

      {account.state === "reading" && <p className="text-sm text-gray-500">{t("mfa.bezig")}</p>}

      {/* The read failed. No badge, no button: there is nothing here we know to be true. The colour
          is amber-700 rather than the brighter tailwind ambers for the contrast reason spelled out
          in src/lib/design/tokens.ts — a warning below the legibility floor is decoration. */}
      {account.state === "unreadable" && (
        // mfa.fout.lezen, not mfa.fout.mislukt. The latter says "we could not check your CODE — that
        // does not mean the code is wrong", which is exactly right on the challenge screen and a
        // small lie here: the owner opened a settings card and typed nothing. A sentence about a
        // code, shown to someone who entered none, makes them look for a mistake they did not make.
        <p role="alert" className="text-sm text-amber-700 leading-relaxed">
          {t("mfa.fout.lezen")}
        </p>
      )}

      {account.state === "known" && (
        <>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
              account.on ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${account.on ? "bg-green-600" : "bg-gray-400"}`}
            />
            {account.on ? t("mfa.staatAan") : t("mfa.staatUit")}
          </span>

          {/* Announced when it appears: after a confirm, the owner's attention is on the field. */}
          {noticeKey && (
            <p role="status" className="text-sm text-green-700 leading-relaxed">
              {t(noticeKey)}
            </p>
          )}
          {errorKey && (
            <p role="alert" className="text-sm text-red-600 leading-relaxed">
              {t(errorKey)}
            </p>
          )}

          {enrolment ? (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-sm text-gray-500 leading-relaxed">{t("mfa.scan.uitleg")}</p>

              {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI from
                  the auth server: there is no file for the image optimizer to fetch, and next/image
                  would only add a loader in front of something already in memory.
                  alt is empty on purpose. A QR code cannot be read aloud, and its text equivalent is
                  the secret printed directly below under mfa.scan.handmatig — which is the route a
                  screen-reader user takes anyway. An invented alt sentence would also be one more
                  hard-coded Dutch string in a component that must hold none. */}
              <img
                src={qrSource(enrolment.qrCode)}
                alt=""
                width={192}
                height={192}
                className="rounded-xl border border-gray-200 bg-white p-2"
              />

              <div className="space-y-1">
                <p className="text-sm text-gray-500">{t("mfa.scan.handmatig")}</p>
                {/* dir="ltr": a base32 secret is not language, and in Arabic it must not be laid out
                    from the right. select-all so one tap copies the whole thing. */}
                <code
                  dir="ltr"
                  className="block select-all break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900"
                >
                  {enrolment.secret}
                </code>
              </div>

              {/* BOTH warnings, and BEFORE the field. Losing the phone means losing the way into
                  records that have to be kept for seven years, and verifying signs every other
                  device out. Said after the switch, either sentence is an apology. */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                <p className="text-xs text-amber-800 leading-relaxed">{t("mfa.waarschuwing.telefoon")}</p>
                <p className="text-xs text-amber-800 leading-relaxed">{t("mfa.waarschuwing.sessies")}</p>
              </div>

              {/* In a <form> so Enter submits from the field. No `required`/`pattern`: native
                  validation answers in the BROWSER's language, not the one the owner chose. */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirmEnrolment();
                }}
                className="space-y-2"
              >
                <label htmlFor="mfa-enrol-code" className="block text-xs font-medium text-gray-500">
                  {t("mfa.code.label")}
                </label>
                <input
                  id="mfa-enrol-code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  // Six digits read the same in every locale — dir="ltr" keeps the caret at the end
                  // of them in Arabic too. inputMode over type="number": no spinner on something
                  // that is not a quantity, and no browser quietly dropping a leading zero.
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  enterKeyHint="done"
                  className="w-40 border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono tracking-widest"
                  placeholder="000000"
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={busy || normaliseMfaCode(code) === null}
                    className={primaryButton}
                  >
                    {busy ? t("mfa.bezig") : t("mfa.bevestig")}
                  </button>
                  <button type="button" onClick={() => void cancelEnrolment()} disabled={busy} className={quietButton}>
                    {t("mfa.annuleren")}
                  </button>
                </div>
              </form>
            </div>
          ) : account.on ? (
            <>
              {/* Only rendered when there is something in it: an "Apparaten" heading over an empty
                  space is a list that failed, dressed as a list that is finished. */}
              {account.devices.length > 0 && (
                <div className="border-t border-gray-100 pt-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {t("mfa.apparaten")}
                  </p>
                  {account.devices.map((device) => (
                    <div key={device.id} className="flex items-center justify-between gap-3">
                      {/* The friendly name we gave it at enrolment. A factor added outside this
                          panel may have none — then the date it was added, which is a fact rather
                          than an invented label. */}
                      <span className="text-sm text-gray-900 break-all">
                        {device.friendly_name || device.created_at.slice(0, 10)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void removeDevice(device.id)}
                        disabled={busy}
                        className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        {t("mfa.apparaatVerwijderen")}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={() => void startEnrolment()} disabled={busy} className={quietButton}>
                  {busy ? t("mfa.bezig") : t("mfa.apparaatToevoegen")}
                </button>
                <button
                  type="button"
                  onClick={() => void switchOff()}
                  disabled={busy}
                  className="border border-red-300 text-red-600 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
                >
                  {t("mfa.uitzetten")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500 leading-relaxed">{t("mfa.waarom")}</p>
              <button type="button" onClick={() => void startEnrolment()} disabled={busy} className={primaryButton}>
                {busy ? t("mfa.bezig") : t("mfa.aanzetten")}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
