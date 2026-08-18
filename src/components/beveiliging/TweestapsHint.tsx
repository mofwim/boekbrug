"use client";

// src/components/beveiliging/TweestapsHint.tsx
// [BEVEILIGING] One line on the home screen while the second step is off, and nothing once it is on.
//
// ── WHY THIS IS NOT A DISMISSIBLE BANNER ──
//
// An owner who never opens the Beveiliging tile never learns that two-step verification exists — a
// lock nobody is told about protects nobody. The usual answer is a banner with a cross, which needs
// somewhere to remember the cross, and then either nags people who already said no or goes quiet
// forever after one careless tap.
//
// This is not that. It renders LIVE STATE: it is on the screen exactly while the account has no
// verified factor, and it disappears by itself the moment one exists. Nothing to dismiss, nothing
// to remember, and no way for it to outlive the thing it is about. If the owner decides against it,
// the line stays — and that is the honest outcome, because the fact it states stays true too.
//
// ── AND IT SAYS NOTHING WHEN IT DOES NOT KNOW ──
//
// A failed read renders nothing at all. "Zet twee stappen aan" shown to someone who switched it on
// last week is the app being wrong about his own account on the screen he trusts most for numbers —
// and it would teach him that this kind of message is noise. Silence costs one owner one prompt;
// crying wolf costs every message on this screen its credibility.

import { useEffect, useState } from "react";

import { M3, R } from "@/lib/design/tokens";
import { translator } from "@/lib/i18n/t";
import { useLocale } from "@/lib/i18n/use-locale";
import { asAalLevel, mfaIsOn } from "@/lib/mfa";
import { getBrowserClient } from "@/lib/supabase";

/**
 * Read straight from the auth session in the browser, not through a route of our own.
 *
 * getAuthenticatorAssuranceLevel() answers from the session already in hand, so this costs no
 * server work and cannot disagree with the gate in the middleware — both read the same claim
 * through the same function (see src/lib/mfa.ts). A field bolted onto /api/daily-truth would have
 * been a second answer to a question that already has one.
 */
async function readSecondStep(): Promise<boolean | null> {
  try {
    const { data, error } = await getBrowserClient().auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return null;
    return mfaIsOn(asAalLevel(data.nextLevel));
  } catch {
    return null;
  }
}

export function TweestapsHint() {
  const t = translator(useLocale());
  // null = we do not know, and that is not "off". Starts there so the first paint says nothing.
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const answer = await readSecondStep();
      if (alive) setOn(answer);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Only a definite "off" puts anything on the screen. `null` and `true` both render nothing, for
  // two different reasons that happen to look the same here — see the header.
  if (on !== false) return null;

  return (
    <a
      href="/dashboard/beveiliging"
      style={{
        display: "block",
        textDecoration: "none",
        background: M3.surfaceVariant,
        border: `1px solid ${M3.hairline}`,
        borderRadius: R.md,
        padding: "12px 14px",
        marginBottom: 20,
      }}
    >
      <p style={{ fontSize: 13.5, fontWeight: 600, color: M3.onSurface, margin: "0 0 2px", textAlign: "start" }}>
        {t("bev.hint.titel")}
      </p>
      {/* The reason, not the instruction. "Zet 2FA aan" is a chore; "wie jouw wachtwoord heeft kan
          facturen uitreiken in jouw nummerreeks" is a fact about this owner's own liability, and it
          is the sentence the enrolment screen opens with too — one argument, said the same way in
          both places. */}
      <p style={{ fontSize: 13, color: M3.onSurfaceVariant, margin: 0, lineHeight: 1.55, textAlign: "start" }}>
        {t("mfa.waarom")}
      </p>
    </a>
  );
}
