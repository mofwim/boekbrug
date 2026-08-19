"use client";

// src/components/beveiliging/NummeringPaneel.tsx
// [DOORLOPEND] "Loopt mijn factuurnummering door?" — the answer, on the screen that asks whether
// this administration is in order.
//
// ── WHY THIS PANEL IS QUIET WHEN IT IS FINE ──
//
// Article 35 Wet OB requires an unbroken series, and it is among the first things an accountant
// checks. So the healthy answer belongs on the screen too — one line, no colour, no icon: an owner
// who has never seen this panel say anything would not know it was watching, and a check nobody
// knows about buys no confidence at all. But it stays ONE line. A green box the size of a warning
// is how people learn to skim the place a real warning will one day appear.
//
// ── AND WHY A GAP IS NOT AN ALARM ──
//
// A missing number is usually not fraud and usually not a bug: the counter moves before the invoice
// is written, so a send that failed halfway burns a number permanently. That is allowed — the
// Belastingdienst accepts a gap that can be EXPLAINED; what it does not accept is a gap nobody
// noticed. So this says which numbers, and says plainly that an explanation is what is wanted,
// rather than colouring the screen red about something the owner cannot undo.

import { useEffect, useState } from "react";

import { translator } from "@/lib/i18n/t";
import { useLocale } from "@/lib/i18n/use-locale";
import type { MessageKey } from "@/lib/i18n/messages";
import type { SeriesReport } from "@/lib/invoice-continuity";

type Report = {
  series: SeriesReport[];
  unreadable: string[];
  clean: boolean;
  unaccounted: number | null;
  countersRead: boolean;
};

/** Three states, never blurred — the same discipline as every other panel in this app. */
type Load = { state: "reading" } | { state: "unreadable" } | { state: "ok"; report: Report };

/** The series name an owner recognises: the document type plus its year. */
function seriesLabel(s: SeriesReport, t: (k: "doorlopend.reeks.factuur" | "doorlopend.reeks.creditnota") => string): string {
  const name = s.type === "creditnota" ? t("doorlopend.reeks.creditnota") : t("doorlopend.reeks.factuur");
  return s.year === null ? name : `${name} ${s.year}`;
}

export function NummeringPaneel() {
  const t = translator(useLocale());
  const [load, setLoad] = useState<Load>({ state: "reading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/invoice/continuity");
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !json?.ok || !Array.isArray(json.series)) {
          setLoad({ state: "unreadable" });
          return;
        }
        setLoad({
          state: "ok",
          report: {
            series: json.series as SeriesReport[],
            unreadable: Array.isArray(json.unreadable) ? json.unreadable : [],
            // Careful direction on both: an answer that did not say it was clean is not clean, and
            // a total that did not arrive is unknown rather than zero.
            clean: json.clean === true,
            unaccounted: typeof json.unaccounted === "number" ? json.unaccounted : null,
            countersRead: json.countersRead === true,
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

  if (load.state === "reading") return null; // nothing to say yet; a spinner here is a stutter
  if (load.state === "unreadable") return <NummeringUitslag report={null} t={t} />;
  return <NummeringUitslag report={load.report} t={t} />;
}

/**
 * The verdict, with no fetching of its own.
 *
 * Separate so tests/render/ can hand it a clean series, a series with a hole, one with a burned
 * number at the end and one with unreadable numbers, and assert what each produces. The rule in
 * invoice-continuity.ts is tested as VALUES; this is where those values become sentences, and a
 * component that computed the right verdict and rendered the wrong string would pass every test in
 * that file.
 *
 * `report: null` is "we could not check" — deliberately not a separate boolean, because a null
 * report and a clean one must never be reachable through the same branch.
 */
export function NummeringUitslag({
  report,
  t,
}: {
  report: Report | null;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}) {
  if (report === null) {
    return (
      <p role="alert" className="text-sm text-amber-700 leading-relaxed">
        {t("doorlopend.nietGelezen")}
      </p>
    );
  }

  const problems = report.series.filter(
    (s) => s.missing.length > 0 || s.duplicates.length > 0 || (s.burnedAtEnd ?? 0) > 0,
  );

  // Clean, and the whole check ran: one line, no box. The owner has now seen that it is watched.
  if (report.clean && problems.length === 0) {
    return (
      <p className="text-sm text-gray-500 leading-relaxed">
        {t("doorlopend.klopt")}
        {/* Half a check is never reported as a whole one. Without the counters the END of each
            series is unchecked, which is exactly where a burned number is likeliest to sit. */}
        {!report.countersRead && ` ${t("doorlopend.halfGecontroleerd")}`}
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
      <p className="text-sm font-semibold text-amber-900">{t("doorlopend.gatenTitel")}</p>

      {problems.map((s) => (
        <p key={`${s.type}-${s.year ?? "x"}`} className="text-sm text-amber-900 leading-relaxed">
          <span className="font-semibold">{seriesLabel(s, t)}</span>{" "}
          {s.missing.length > 0 && t("doorlopend.ontbreekt", { nummers: s.missing.join(", ") })}{" "}
          {(s.burnedAtEnd ?? 0) > 0 && t("doorlopend.eindeReeks", { aantal: s.burnedAtEnd as number })}{" "}
          {s.duplicates.length > 0 && t("doorlopend.dubbel", { nummers: s.duplicates.join(", ") })}
        </p>
      ))}

      {report.unreadable.length > 0 && (
        // Not a gap and not dropped: a number in a format we do not know. Naming them lets the owner
        // recognise his own imported history instead of wondering what we mean.
        <p className="text-sm text-amber-900 leading-relaxed">
          {t("doorlopend.onleesbaar", { nummers: report.unreadable.slice(0, 8).join(", ") })}
        </p>
      )}

      {/* What to DO. A finding with no next step is a screen that worries someone and leaves him
          there — and the next step here is genuinely not "fix it", because a burned number cannot
          be reused. It is: know about it before your accountant does. */}
      <p className="text-sm text-amber-900 leading-relaxed">{t("doorlopend.watNu")}</p>
    </div>
  );
}
