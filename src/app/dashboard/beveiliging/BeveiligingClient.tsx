"use client";

// src/app/dashboard/beveiliging/BeveiligingClient.tsx
// [BEVEILIGING] The screen that answers "who can read my books", from the owner's own data.
//
// ── WHY THIS SCREEN EXISTS ──
//
// Handing seven years of books to an app nobody has heard of asks a zzp'er to take one thing purely
// on faith: that nobody else can open them. Every bookkeeping product answers that with a paragraph
// on a marketing page, which is a claim about the company. This answers it with a list of the actual
// people who can open THIS administration today, the state of the lock on it, and the trail of what
// has been recorded — three facts the owner can check rather than believe.
//
// So the one thing this screen must never do is reassure. "Alleen jij" is a promise, and a promise
// made on a read that half-failed is worse than no screen: the owner stops looking. Every panel
// below therefore has a third state, and the third state says so out loud.

import { useEffect, useState } from "react";

import { ToegangPaneel } from "@/components/beveiliging/ToegangPaneel";
import { TweestapsPaneel } from "@/components/settings/TweestapsPaneel";
import { COLUMN, FONT, M3 } from "@/lib/design/tokens";
import { LOCALE_META } from "@/lib/i18n/locale";
import { translator } from "@/lib/i18n/t";
import { useLocale } from "@/lib/i18n/use-locale";
import type { AccessHolder } from "@/lib/security-overview";

/** What /api/beveiliging answers. */
type Overview = {
  holders: AccessHolder[];
  complete: boolean;
  count: number | null;
  trailCount: number | null;
};

/**
 * Three states, never blurred: still asking, could not read, read it.
 *
 * "reading" is not "empty" and "unreadable" is not "nobody else" — the two conflations this whole
 * screen is built to avoid, in the type rather than in a comment.
 */
type Load = { state: "reading" } | { state: "unreadable" } | { state: "ok"; overview: Overview };

export default function BeveiligingClient() {
  const locale = useLocale();
  const t = translator(locale);
  const [load, setLoad] = useState<Load>({ state: "reading" });

  useEffect(() => {
    // `alive` because a screen closed mid-read would otherwise write into a component that is gone.
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/beveiliging");
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !json?.ok || !Array.isArray(json.holders)) {
          setLoad({ state: "unreadable" });
          return;
        }
        setLoad({
          state: "ok",
          overview: {
            holders: json.holders as AccessHolder[],
            // Defaults chosen in the careful direction: an answer that did not say it was complete
            // is treated as incomplete, and a count that did not arrive is null rather than 0.
            complete: json.complete === true,
            count: typeof json.count === "number" ? json.count : null,
            trailCount: typeof json.trailCount === "number" ? json.trailCount : null,
          },
        });
      } catch {
        if (alive) setLoad({ state: "unreadable" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const dir = LOCALE_META[locale].dir;

  return (
    <div
      dir={dir}
      style={{
        maxWidth: COLUMN.hub,
        margin: "0 auto",
        padding: "24px 16px 64px",
        fontFamily: FONT,
      }}
    >
      {/* No h1: the screen's name and the way back live in the shared sub-page bar. */}
      <header style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 14.5, color: M3.onSurfaceVariant, margin: 0, textAlign: "start", lineHeight: 1.6 }}>
          {t("bev.uitleg")}
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* The lock. Its own panel reads its own state and has its own third state — see
            TweestapsPaneel. It sits FIRST because it is the only thing on this screen the owner can
            change in ten seconds, and the rest of the screen is what makes him want to. */}
        <TweestapsPaneel />

        {load.state === "reading" && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-sm text-gray-500">{t("mfa.bezig")}</p>
          </div>
        )}

        {/* Not an empty list, and not "alleen jij". The read failed, and on this screen that is a
            statement worth its own box. */}
        {load.state === "unreadable" && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p role="alert" className="text-sm text-amber-700 leading-relaxed">
              {t("mfa.fout.lezen")}
            </p>
          </div>
        )}

        {load.state === "ok" && (
          <>
            <ToegangPaneel
              holders={load.overview.holders}
              complete={load.overview.complete}
              count={load.overview.count}
              t={t}
              // Revoking happens where it is explained, not on a summary — see the panel's own note.
              manageHref="/dashboard/settings/team"
            />

            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                {t("bev.log.titel")}
              </p>
              <p className="text-sm text-gray-500 leading-relaxed">{t("bev.log.uitleg")}</p>
              {/* A number we could not read is not zero. "0 handelingen vastgelegd" over a full
                  logbook would be this screen telling the owner that nothing is being recorded —
                  the exact opposite of what the logbook is for. */}
              <p className={`text-sm ${load.overview.trailCount === null ? "text-amber-700" : "text-gray-900 font-semibold"}`}>
                {load.overview.trailCount === null
                  ? t("bev.log.onbekend")
                  : t("bev.log.aantal", { aantal: load.overview.trailCount })}
              </p>
              <a
                href="/dashboard/logboek"
                className="inline-block border border-gray-300 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50"
              >
                {t("bev.log.bekijken")}
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
