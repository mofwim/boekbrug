// src/app/api/xaf/route.ts
// [XAF] GET ?year=2026[&clientId=…] — the year as an XML Auditfile Financieel 3.2 download.
//
// Dual-path like /api/ib-jaar: the owner exports their own year, a linked accountant exports a
// client's (resolveQuarterOwner + the service-role pipeline). This route is authorize-fetch-refuse
// only: every booking rule lives in xaf-export.ts, and [XAF-BRON] every READ lives in xaf-fetch.ts,
// which the quarterly package calls too — one answer to "what books into the auditfile", not two.
//
// [NO-SILENT-EMPTY] Any failed read refuses with 503. An auditfile missing a table's rows is not
// a smaller administration — it is a WRONG administration that an accountant would import whole.

import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { buildXafFile } from "@/lib/xaf-export";
import { buildXafInputForOwner } from "@/lib/xaf-fetch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "Ongeldig jaar" }, { status: 400 });
  }

  // [DIEP-2] Year-scale read path — bounded like every other heavy surface.
  const limited = await checkRateLimit({ userId: user.id, endpoint: "xaf-export", ...RATE_LIMITS.HEAVY_EXPORT });
  if (!limited.allowed) return rateLimitResponse(limited);

  const owner = await resolveQuarterOwner(supabase, user.id, req.nextUrl.searchParams.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const pipeline = createPipelineClient();
  const ownerId = owner.ownerId;

  try {
    // [XAF-BRON] The reads live in xaf-fetch.ts now, because the quarterly package needs the same
    // ones and two copies of "what books into the auditfile" is one copy too many. This route keeps
    // what is its own: who is asking, how often, and what comes back over the wire.
    const input = await buildXafInputForOwner({ pipeline, ownerId, year });

    const built = buildXafFile(input);
    const safeName = (input.company.name || "administratie").replace(/[^a-zA-Z0-9._-]/g, "_");
    return new NextResponse(built.xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditfile-${year}-${safeName}.xaf"`,
        // The counts travel in headers too, so a caller CAN show them without parsing XML.
        "X-Xaf-Entries": String(built.entryCount),
        "X-Xaf-Skipped": String(built.skipped.length),
      },
    });
  } catch (e) {
    console.error("[XAF] export failed", { ownerId, year, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json(
      { error: "We konden het auditbestand nu niet samenstellen. Er ontbrak een gegevensbron — probeer het zo opnieuw." },
      { status: 503 },
    );
  }
}
