"use client";

// src/components/beveiliging/ApparatenPaneel.tsx
// [BEVEILIGING] Log every OTHER device out, in one press.
//
// ── WHY THIS BUTTON AND NOT A LIST OF DEVICES ──
//
// The screen everyone expects here is "je bent ingelogd op: iPhone, Chrome op Windows, …". We
// cannot build that honestly: Supabase does not hand a session list to the client, and inventing
// one out of what we happen to know would be a list that is wrong in exactly the case it exists
// for — a session we never saw. A security screen that guesses is worse than one that does less.
//
// So this panel does the one thing that is both true and useful. The moment an owner suspects his
// password has leaked, the question is not "which devices" but "get everything else out, now" —
// and that is one call, immediate, with no ambiguity about whether it worked.
//
// It pairs with the two-step panel above it deliberately: change the password, switch the second
// step on, throw every other session out. Three presses and a stolen password is worth nothing,
// which is the whole point of putting them on one screen.
//
// ── AND IT SAYS WHAT IT CANNOT DO ──
//
// The explanation names the missing device list rather than leaving a hole where an owner expects
// one. "Wij kunnen je niet laten zien waar je bent ingelogd" is a sentence a competitor would never
// write, and it is the reason the sentence next to it can be believed.

import { useState } from "react";

import { translator } from "@/lib/i18n/t";
import { useLocale } from "@/lib/i18n/use-locale";
import { getBrowserClient } from "@/lib/supabase";

/** Three outcomes, never blurred: nothing pressed yet, it worked, it did not. */
type Outcome = null | "done" | "failed";

export function ApparatenPaneel() {
  const t = translator(useLocale());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function signOutOthers(): Promise<void> {
    // [DOUBLE-SUBMIT] A second press mid-flight would race the first and could report a failure for
    // a call that succeeded.
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      // scope 'others', never 'global'. Global would sign THIS session out too — the owner presses
      // a button on his security screen and lands on the login, which reads as the app breaking
      // rather than as the thing he asked for. auth-js fires no SIGNED_OUT event for 'others', so
      // this session is left exactly as it was.
      const { error } = await getBrowserClient().auth.signOut({ scope: "others" });
      setOutcome(error ? "failed" : "done");
    } catch {
      // A throw is the network dropping. It says nothing about whether the sessions went, so the
      // honest answer is the same one: we could not confirm it. Never a success on a call we did
      // not see finish — "alle andere apparaten zijn uitgelogd" is a claim, and this is the screen
      // where a wrong one costs the most.
      setOutcome("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        {t("bev.apparaten.titel")}
      </p>
      <p className="text-sm text-gray-500 leading-relaxed">{t("bev.apparaten.uitleg")}</p>

      {outcome === "done" && (
        <p role="status" className="text-sm text-green-700 leading-relaxed">
          {t("bev.apparaten.gelukt")}
        </p>
      )}
      {outcome === "failed" && (
        <p role="alert" className="text-sm text-red-600 leading-relaxed">
          {t("bev.apparaten.mislukt")}
        </p>
      )}

      <button
        type="button"
        onClick={() => void signOutOthers()}
        disabled={busy}
        className="border border-gray-300 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? t("mfa.bezig") : t("bev.apparaten.knop")}
      </button>
    </div>
  );
}
