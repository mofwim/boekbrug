// src/app/api/truth/route.ts
// [TRUTH-LENS] The living financial truth through a time lens. ONE truth, computed live from the
// raw tables (no stored daily_truth); a "period" is just which [start, end] window we feed the
// shared computeResultForRange — the exact same reconcile pipeline /api/result uses for a quarter.
// So the dashboard's living number and the quarterly aangifte can never disagree: they are the
// same function over a different window.
//
// ?lens = this-quarter (default) | last-quarter | ytd | year | all | custom
//   custom also needs ?from=YYYY-MM-DD&to=YYYY-MM-DD
// ?year is honoured for lens=year (else the current calendar year).
//
// Two invariants this route owes the screen, both of which it used to break:
//   · WINDOWS NEST — quarter ⊆ year ⊆ alles (see resolveWindow).
//   · NO SILENT GAP — every reason a figure is incomplete travels in the response, at parity with
//     /api/result and /api/readiness (see the completeness block at the bottom).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { computeResultForRange } from "@/lib/compute-result-range";
import { computeFilingDivergence } from "@/lib/btw-filing";
// [TZ] "Today" is the owner's Amsterdam day, never the server's UTC day — see below.
import { amsterdamToday } from "@/lib/format-nl";
import { resolveWindow, parseLens, type Lens } from "@/lib/truth-lens";
// [DEPLOY-SAFE] "btw_filings isn't there yet" vs "the read failed" — see pg-missing.ts
import { isMissingRelation } from "@/lib/pg-missing";

// [TRUTH-LENS] The lens → window rules live in a pure, tested module (truth-lens.ts). They used to
// sit here, where a Next route cannot export them and nothing could test them — while carrying the
// containment invariant (kwartaal ⊆ jaar ⊆ alles) that had quietly broken.

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const lens: Lens = parseLens(sp.get("lens"));

  // [TZ] The owner's Amsterdam day, never the server's UTC day. Vercel runs in UTC, so between
  // 00:00 and 02:00 Dutch time getUTCDate() still reports YESTERDAY — and this value decides which
  // QUARTER the owner is looking at. Opening the app at 00:30 on 1 July showed Kwartaal 2 as "dit
  // kwartaal" and flipped the loopt-nog / afgesloten badge with it. Every other date-sensitive
  // surface in the app already pins Europe/Amsterdam (format-nl.ts, the crons, Kas, Vandaag); this
  // route was the outlier. new Date() itself is fine here — it is a route, not a workflow script.
  // Read ONCE: the window and the quarterEnded flag below must agree about what day it is, even for
  // a request that happens to straddle midnight.
  const today = amsterdamToday();
  const win = resolveWindow(lens, today, sp);

  // [ACCOUNTANT-TRUTH] Same dual-path + authorization as /api/result.
  const owner = await resolveQuarterOwner(supabase, user.id, sp.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const pipeline = createPipelineClient();

  const {
    result, datelessVerifiedCount, reconciliation,
    // [HONESTY-PARITY] /api/result has always returned these; /api/truth dropped them on the floor.
    // They are exactly the signals that make a figure INCOMPLETE, and this is the screen that
    // promises no silent gaps — see the response note below.
    scheme, undatedPaidCount, estimatedPortionCount, unconfirmedIncomingCount,
    spansSchemeChange, schemeSince,
  } = await computeResultForRange({
    pipeline,
    ownerId: owner.ownerId,
    start: win.start,
    end: win.end,
  });

  // [TRUTH-FILED] When the lens is exactly one quarter, look up whether it was filed. If so, the
  // period is LOCKED (definitief) and we compare the frozen snapshot to the current live figures —
  // any divergence is a correction the owner must be told about (carry-forward vs suppletie).
  let filed: null | {
    filedAt: string;
    figures: { omzet: number; kosten: number; btwVerschuldigd: number; btwVoorbelasting: number; btwSaldo: number };
    divergence: ReturnType<typeof computeFilingDivergence>;
  } = null;
  // [FILING-NO-OVERWRITE] …and when we CANNOT look, say so. This read dropped its error, so a
  // hiccup answered `filed: null` — and on this screen that is not a missing badge, it is a chain:
  // the lock disappears, isLiveWindow flips back on, the divergence banner (the whole point of the
  // page) goes quiet, and the "Markeer als ingediend" button returns — which the client only shows
  // when `filed` is null. One tap then re-filed a quarter that was already filed, replacing the
  // frozen snapshot with today's figures. The route now refuses to guess, and the client hides the
  // button while the answer is unknown.
  let filedUnknown = false;
  if (win.quarter && win.year) {
    // btw_filings is not yet in the generated types (added by btw_filings.sql) → relaxed client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fRow, error: fErr } = await (pipeline as any)
      .from("btw_filings")
      .select("filed_at, omzet, kosten, btw_verschuldigd, btw_voorbelasting, btw_saldo")
      .eq("user_id", owner.ownerId)
      .eq("year", win.year)
      .eq("quarter", win.quarter)
      .maybeSingle();
    // A table that has not been migrated here yet holds no filings — that is an answer, not an
    // unknown (see pg-missing.ts). Anything else is an unknown.
    if (fErr && !isMissingRelation(fErr.message)) {
      filedUnknown = true;
      console.error("[FILING-NO-OVERWRITE] btw_filings read failed — reporting unknown, not 'not filed'", { ownerId: owner.ownerId, year: win.year, quarter: win.quarter, error: fErr.message });
    }
    const row = fRow as unknown as {
      filed_at: string; omzet: number; kosten: number;
      btw_verschuldigd: number; btw_voorbelasting: number; btw_saldo: number;
    } | null;
    if (row) {
      const figures = {
        omzet: Number(row.omzet) || 0,
        kosten: Number(row.kosten) || 0,
        btwVerschuldigd: Number(row.btw_verschuldigd) || 0,
        btwVoorbelasting: Number(row.btw_voorbelasting) || 0,
        btwSaldo: Number(row.btw_saldo) || 0,
      };
      filed = {
        filedAt: row.filed_at,
        figures,
        divergence: computeFilingDivergence(figures, {
          omzet: result.omzet,
          kosten: result.kosten,
          btwVerschuldigd: result.btwVerschuldigd,
          btwVoorbelasting: result.btwVoorbelasting,
          btwSaldo: result.btwSaldo,
        }),
      };
    }
  }

  return NextResponse.json({
    ok: true,
    lens,
    start: win.start,
    end: win.end,
    label: win.label,
    quarter: win.quarter ?? null,
    year: win.year ?? null,
    // [TRUTH-LENS] true when the window includes today AND it isn't a filed (locked) quarter: the
    // figures are LIVING, not a final period. A filed quarter is "definitief" even if it's current.
    isLiveWindow: win.isLiveWindow && !filed,
    // [TRUTH-FILED] present only for a single-quarter lens that has been filed.
    filed,
    // [FILING-NO-OVERWRITE] TRUE when we could not determine the filing state. `filed: null` then
    // means "unknown", never "not filed" — the client must not offer to file on top of it.
    filedUnknown,
    // [FILING-WINDOW] TRUE once the last day of this quarter has passed. A BTW-aangifte exists only
    // for a period that is OVER, so the client uses this to stop offering "markeer als ingediend"
    // for a quarter that is still running — freezing a mid-quarter snapshot would make every sale
    // that follows look like a divergence, and could even raise a suppletie warning for a period
    // the Belastingdienst has not asked for yet. Null when the lens is not a single quarter.
    quarterEnded: win.quarter && win.year ? win.end < today : null,
    result,
    datelessVerifiedCount,
    reconciliation,
    // [HONESTY-PARITY] The completeness signals, at parity with /api/result and /api/readiness.
    //   scheme                   — the client's "based on invoice date" line is a LIE under kas.
    //   undatedPaidCount         — kas: paid money that cannot be placed in a period.
    //   estimatedPortionCount    — kas: the pay date is a guess (marked_paid_at).
    //   unconfirmedIncomingCount — purchase invoices still in the verify queue; the filing gate
    //                              blocks on this, so the screen has to show it or the owner meets
    //                              a 409 about a problem nothing ever told them about.
    scheme,
    undatedPaidCount,
    estimatedPortionCount,
    unconfirmedIncomingCount,
    // [SCHEME-SPAN] The window straddles the owner's factuur→kas switch: no single basis is right
    // for it, so the client says so instead of presenting a one-basis figure as the truth.
    spansSchemeChange,
    schemeSince,
  });
}
