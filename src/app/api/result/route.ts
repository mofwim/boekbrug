// src/app/api/result/route.ts
// [RESULT] The true quarterly result across all channels — a thin wrapper over the shared
// computeResultForRange pipeline (also used by /api/truth's living-truth lens) so a quarter and
// any other window can never disagree. Read-only, user-scoped (accountant dual-path via owner).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { quarterFromParams } from "@/lib/quarter";
import { computeResultForRange } from "@/lib/compute-result-range";

function pad(n: number): string { return String(n).padStart(2, "0"); }

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  // [QUARTER] Honour ?year&quarter (bounded 2000–2100), else default to the LAST COMPLETED
  // quarter — the app-wide default (quarter.ts).
  const { year, quarter } = quarterFromParams((k) => sp.get(k));

  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;

  // [ACCOUNTANT-TRUTH] Dual-path: own result, OR a linked client's result for an accountant
  // (same authorization as /api/closing-package). Reads use the service-role pipeline scoped to
  // ownerId — an accountant cannot read a client's rows through RLS.
  const owner = await resolveQuarterOwner(supabase, user.id, sp.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const pipeline = createPipelineClient();

  const { result, datelessVerifiedCount, reconciliation } = await computeResultForRange({
    pipeline,
    ownerId: owner.ownerId,
    start,
    end,
  });

  return NextResponse.json({
    ok: true,
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    result,
    datelessVerifiedCount, // [DATELESS] verified invoices excluded for want of a date (warn upstream)
    reconciliation,
  });
}
