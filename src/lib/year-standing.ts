// src/lib/year-standing.ts
// [JAARSTAND] The four quarters of one year, side by side. Pure — no I/O, no clock.
// Run: npx tsx src/lib/year-standing.test.ts
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
//
// Every screen in this app that judges a quarter judges exactly ONE quarter. /dashboard/quarterly
// is literally called "Kwartaaloverzicht" and has a single-quarter selector; Waarheid has a
// single-quarter lens. So the only way to learn WHICH of the year's filings are in trouble is to
// open each one in turn and remember what the previous one said.
//
// Measured on the live administration at the time of writing:
//
//   Q1 2026 — 0 kassadagen, tegenover € 172.081,57 aan pinomzet die wél op de bank staat
//   Q2 2026 — 91 kassadagen, compleet
//   Q3 2026 — 0 kassadagen, tegenover € 81.358,01
//
// Two of the three cannot be filed. The app is RIGHT about both — the omzet-zonder-tarief gap
// blocks them and says why, with a link to Dagomzet. Nothing was broken. What was missing is that
// the owner had to go looking, quarter by quarter, to find out that two of their statutory returns
// were standing open. A deadline is not a good moment to discover that for the first time.
//
// ── AND WHY IT DECIDES NOTHING ───────────────────────────────────────────────────────────────
//
// This module contains no rule about whether a quarter is ready. It cannot: that rule is
// buildReadiness, it is long, it is argued, and a second copy of it here would be a second answer
// to the same question — which is how two screens start disagreeing about the same quarter.
//
// So the caller asks the EXISTING /api/readiness once per quarter and hands the four answers here.
// This file only turns four verdicts into four lines. When readiness changes, this changes with it,
// by construction.

/** What the caller got back for one quarter. `report` absent = that read did not succeed. */
export interface QuarterAnswer {
  quarter: 1 | 2 | 3 | 4;
  /** The readiness verdict, or null when the request failed / was refused. */
  report: {
    quarterLabel: string;
    status: "ready" | "almost" | "attention";
    ready: boolean;
    missing: { title: string; fix?: { label: string; href: string } }[];
  } | null;
  /** True when this quarter is already filed and frozen — it is finished, not "ready". */
  filed?: boolean;
  /** True when the quarter has not ended yet: it cannot be filed and that is not a fault. */
  running?: boolean;
}

export type StandingState =
  /** Filed and frozen. Nothing to do. */
  | "ingediend"
  /** Ended, and readiness says it can go. */
  | "klaar"
  /** Ended, and something blocks it. `reason` names the first gap. */
  | "blokkeert"
  /** Not over yet. Neither ready nor broken — the quarter is still collecting. */
  | "loopt"
  /**
   * We could not read it.
   *
   * [NO-SILENT-EMPTY] This is the whole reason the state is a union and not a boolean. A quarter
   * whose readiness call failed has NO verdict, and rendering it beside three green lines as
   * anything other than "unknown" would be the app answering a question it did not ask. The one
   * thing this row may never say is that the quarter is fine.
   */
  | "onbekend";

export interface QuarterStanding {
  quarter: 1 | 2 | 3 | 4;
  label: string;
  state: StandingState;
  /** The first blocking gap, verbatim from readiness. Null for every state but "blokkeert". */
  reason: string | null;
  /** Where that gap is fixed, when readiness knew. Null otherwise. */
  fix: { label: string; href: string } | null;
}

/**
 * Four answers → four lines, in quarter order.
 *
 * The order is Q1..Q4 and not "worst first" on purpose: this is a calendar, and an owner reads it
 * to find a specific quarter. A list that reorders itself by severity moves Q3 above Q1 the moment
 * something changes, and then the row you looked at yesterday is somewhere else today.
 */
export function yearStanding(answers: readonly QuarterAnswer[], year: number): QuarterStanding[] {
  const byQuarter = new Map<number, QuarterAnswer>();
  for (const a of answers) byQuarter.set(a.quarter, a);

  return ([1, 2, 3, 4] as const).map((q) => {
    const a = byQuarter.get(q);
    const label = a?.report?.quarterLabel ?? `Q${q} ${year}`;

    if (!a) {
      return { quarter: q, label, state: "onbekend" as const, reason: null, fix: null };
    }
    // Filed wins over everything: a frozen quarter is finished, and re-deriving gaps in it would
    // invite the owner to "fix" a return that has already gone to the Belastingdienst.
    if (a.filed) {
      return { quarter: q, label, state: "ingediend" as const, reason: null, fix: null };
    }
    // A quarter that has not ended is judged BEFORE the missing-verdict check, and deliberately:
    // it cannot be filed yet, so a failed read costs the owner nothing and "onbekend" would put a
    // question mark on the one row where there is no question. Order matters here — the first
    // version tested this after the unknown guard, and a running quarter with no report (the
    // normal case, since the caller does not bother asking about it) came out "onbekend".
    if (a.running) {
      return { quarter: q, label, state: "loopt" as const, reason: null, fix: null };
    }
    // Ended, not filed, and no verdict: we do not know. See StandingState.onbekend.
    if (!a.report) {
      return { quarter: q, label, state: "onbekend" as const, reason: null, fix: null };
    }

    const report = a.report;
    if (report.ready && report.missing.length === 0) {
      return { quarter: q, label, state: "klaar" as const, reason: null, fix: null };
    }

    // Not ready. Name the FIRST gap and nothing else: readiness already orders them, and a row
    // that lists five reasons is a row nobody reads. The quarter's own screen has the full list.
    const first = report.missing[0] ?? null;
    return {
      quarter: q,
      label,
      state: "blokkeert" as const,
      reason: first?.title ?? null,
      fix: first?.fix ?? null,
    };
  });
}

/** How many of the year's quarters are standing open with something blocking them. */
export function blockedCount(standing: readonly QuarterStanding[]): number {
  return standing.filter((s) => s.state === "blokkeert").length;
}

/**
 * Is this whole year worth showing a headline about?
 *
 * False when every quarter is filed, ready or still running — a year with nothing wrong should say
 * nothing at all rather than draw a box around good news. An "onbekend" row DOES count: not being
 * able to read a quarter is itself something the owner should see.
 */
export function yearNeedsAttention(standing: readonly QuarterStanding[]): boolean {
  return standing.some((s) => s.state === "blokkeert" || s.state === "onbekend");
}
