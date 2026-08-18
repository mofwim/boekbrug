// src/app/api/btw-reservation/route.ts
// [BTW-RESERVERING] What of the balance in the account is already the Belastingdienst's.
//
// The rule lives in src/lib/btw-reservation.ts and is tested there. This route only ASSEMBLES its
// inputs: the bank total, and one row per quarter saying what that quarter's 5g is and whether it
// was filed. Nothing is decided here — that separation is the reason the rule can be tested at all.
//
// ── WHY IT IS ITS OWN ROUTE AND NOT PART OF THE PAGE ──
// A quarter's 5g comes out of computeResultForRange, which pages through invoices, bank lines and
// daily turnover. Doing that inside the Vandaag server component would put the heaviest read in
// the app in front of the screen the owner opens most — undoing the [WATERVAL] work on the exact
// page it was done for. So the screen paints first and asks for this afterwards.
//
// Read-only. service_role, every query pinned to the authenticated user.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session-user";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { bankBalanceOf } from "@/lib/bank-balance";
import { computeResultForRange } from "@/lib/compute-result-range";
import { buildAangifte } from "@/lib/aangifte";
import { quarterStartDate, quarterEndDate } from "@/lib/quarterly";
import { amsterdamToday } from "@/lib/format-nl";
import {
  computeBtwReservation,
  quartersBefore,
  quarterOfDate,
  type QuarterPosition,
} from "@/lib/btw-reservation";

export const dynamic = "force-dynamic";

/**
 * How far back this route looks.
 *
 * Four quarters: the running one and the three before it. An owner further behind than a full year
 * of BTW has a problem a dashboard figure does not solve, and computing an unbounded history would
 * make a screen-side request that walks years of invoices.
 *
 * The bound is not silent — `oldestConsidered` goes out with the answer, so the screen can say which
 * period the figure covers instead of implying it covers everything.
 */
const LOOKBACK_QUARTERS = 4;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pipeline = createPipelineClient();
  const today = amsterdamToday();
  const nu = quarterOfDate(today);

  const vensters = Array.from({ length: LOOKBACK_QUARTERS }, (_, i) =>
    quartersBefore(nu.year, nu.quarter, i),
  );

  // ── The two reads that do not depend on a quarter ──────────────────────────────────
  //
  // The balance read MAY degrade: on a database where bank_statement_periods has not been
  // migrated yet, or on a plain read failure, bankBalanceOf answers null and the rule turns that
  // into 'onbekend' with no `free` at all. That is the honest outcome and it is already the
  // behaviour /api/daily-truth relies on — an unknown balance is never a reason to invent one.
  //
  // The filings read may NOT degrade, and the difference matters. A missing filing row reads as
  // "not filed", which makes a settled quarter look outstanding AND raises 'return-overdue' on
  // an owner who filed on time. Wrong in the alarming direction, about the tax office — so a
  // failed read stops the whole answer rather than producing a scary one.
  type PeriodRow = { iban: string | null; period_end: string | null; closing_balance: number | null };
  type FilingRow = { year: number; quarter: number; btw_saldo: number | null };

  const [periodRows, filingRows] = await Promise.all([
    (async (): Promise<PeriodRow[] | null> => {
      try {
        // bank_statement_periods comes from a separate migration and is not in the generated
        // types → relaxed client, as in /api/daily-truth.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (pipeline as any)
          .from("bank_statement_periods")
          .select("iban, period_end, closing_balance")
          .eq("user_id", user.id)
          .order("period_end", { ascending: false })
          .limit(400);
        return error ? null : ((data ?? []) as PeriodRow[]);
      } catch {
        return null;
      }
    })(),
    (async (): Promise<FilingRow[] | null> => {
      try {
        // btw_filings is likewise not in the generated types — the same cast /api/btw/file uses.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (pipeline as any)
          .from("btw_filings")
          .select("year, quarter, btw_saldo")
          .eq("user_id", user.id);
        return error ? null : ((data ?? []) as FilingRow[]);
      } catch {
        return null;
      }
    })(),
  ]);

  if (filingRows == null) {
    console.error("[BTW-RESERVERING] filings read failed — no answer rather than a wrong one", {
      userId: user.id,
    });
    return NextResponse.json({ error: "filings_unreadable" }, { status: 503 });
  }

  const balance = bankBalanceOf(
    (periodRows ?? []).map((r) => ({
      iban: r.iban,
      periodEnd: r.period_end,
      closingBalance: r.closing_balance,
    })),
  );

  const filedBy = new Map<string, FilingRow>();
  for (const f of filingRows) filedBy.set(`${f.year}-Q${f.quarter}`, f);

  // ── One row per quarter ────────────────────────────────────────────────────────────
  //
  // A FILED quarter uses the frozen btw_saldo from btw_filings — the figure as it stood when the
  // owner filed it, which is the figure the Belastingdienst is actually holding them to. Not a
  // recomputation: an invoice edited afterwards would otherwise silently change what the app says
  // is owed on a return that has already gone in.
  //
  // An UNFILED quarter has no frozen figure, so it is computed. Concurrently — these are the
  // heaviest reads in the app and running them one after another is the waterfall this route was
  // written to keep off the screen in the first place.
  type Uitkomst = { post: QuarterPosition } | { mislukt: string };

  const uitkomsten = await Promise.all(
    vensters.map(async ({ year, quarter }): Promise<Uitkomst> => {
      const key = `${year}-Q${quarter}`;
      const filed = filedBy.get(key);

      if (filed) {
        return {
          post: {
            key,
            year,
            quarter,
            balance: Math.round(Number(filed.btw_saldo) || 0),
            filed: true,
          },
        };
      }

      try {
        const range = await computeResultForRange({
          pipeline,
          ownerId: user.id,
          start: quarterStartDate(year, quarter),
          end: quarterEndDate(year, quarter),
        });
        // Only 5g is read, and 5g depends on salesByRate and voorbelasting alone — the
        // completeness argument shapes the concept's NOTES, which this route does not use. The
        // counts are still passed truthfully rather than zeroed, so that anyone who later reads
        // more out of this concept is not reading it out of a hollowed-out one.
        const concept = buildAangifte(
          range.result,
          {
            turnoverDays: 0,
            quarterDays: 0,
            incomingInvoiceCount: 0,
            outgoingInvoiceCount: 0,
            hasEuPurchase: false,
            datelessVerifiedCount: range.datelessVerifiedCount,
            scheme: range.scheme,
          },
          key,
        );
        return {
          post: {
            key,
            year,
            quarter,
            balance: concept.saldo,
            filed: false,
            unverifiedPurchases: range.unconfirmedIncomingCount,
          },
        };
      } catch (e) {
        // One unreadable quarter must not take the others down: the remaining quarters still
        // carry real money the owner needs to see. It is dropped from the sum and NAMED in
        // `uncomputed`, because a total that quietly left out a quarter is exactly the silent
        // under-report this figure exists to prevent.
        console.error("[BTW-RESERVERING] quarter could not be computed — left out and named", {
          userId: user.id,
          key,
          error: e instanceof Error ? e.message : String(e),
        });
        return { mislukt: key };
      }
    }),
  );

  const bruikbaar = uitkomsten.flatMap((u) => ("post" in u ? [u.post] : []));
  const uncomputed = uitkomsten.flatMap((u) => ("mislukt" in u ? [u.mislukt] : []));

  const reservation = computeBtwReservation({
    balance: balance.balance,
    balanceAsOf: balance.asOf,
    balanceIncomplete: balance.partial,
    quarters: bruikbaar,
    today,
  });

  const oudste = vensters[vensters.length - 1];

  return NextResponse.json({
    ...reservation,
    balance: balance.balance,
    balanceAsOf: balance.asOf,
    /** Which period this answer covers — so the screen never implies it covers everything. */
    oldestConsidered: `${oudste.year}-Q${oudste.quarter}`,
    /** Quarters whose figure could not be computed. Empty in the ordinary case. */
    uncomputed,
  });
}
