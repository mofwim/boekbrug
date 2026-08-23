// src/app/api/closing-package/route.ts
// [CLOSING-PACKAGE] Download one quarterly ZIP for the accountant.
//
// GET /api/closing-package?year=2026&quarter=1[&clientId={uuid}]
//   → ZIP (Content-Disposition: attachment)
//
// Authorization (dual-path, same as export/UBL routes):
//   - owner (ZZP'er) exports their OWN quarter, OR
//   - a linked accountant exports a client's quarter (accountant_clients link).
// Auth on the SESSION client; the actual build uses the service_role pipeline
// client scoped explicitly to ownerId (service_role bypasses RLS).
//
// [RUNTIME] Deze route had GEEN maxDuration en geen runtime-config, terwijl elke zware
// buurman die wel heeft (snelstart/push:56, alle vijf crons op 300). Zij haalt élke
// factuur-PDF uit Storage, herschrijft elke betaalde door pdf-lib en DEFLATE't de hele
// stapel — zonder plafond. Bij een druk kwartaal loopt dat tegen de standaard-timeout van
// het platform aan, en de gebruiker ziet een afgebroken download zonder uitleg.
//
// 300 seconden, gelijk aan de crons. Het CONTENT-plafond dat kluis/export hanteert
// (MAX_FILES / MAX_TOTAL_BYTES) wordt hier bewust NIET overgenomen: vier gepubliceerde
// zinnen beloven dat een export altijd compleet is (fair-use.ts ALWAYS_FREE, AV §5.2
// belofte 3, AV §5.7.1, bewaarkluis.ts KLUIS_WEL). Begrens de looptijd, niet de inhoud.
export const maxDuration = 300

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { buildClosingPackageZip, type Quarter } from "@/lib/closing-package";
import { logAuditAction } from "@/lib/audit";

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ── [PAKKET-DEUR] A refusal must land where the click came from ─────────────────────────────────
//
// Five screens reach this route through a plain <a href> — a browser NAVIGATION — because that is
// the only way to hand the browser a download it can stream to disk. The happy path is fine; every
// refusal was JSON. So a failed build, an expired session or a broken link dropped the accountant
// on a raw {"error":"Pakket genereren mislukt"} page: no way back, no sentence, and it reads as
// "the product is broken" at the exact moment he came to collect a quarter.
//
// Content negotiation, not a redirect: a navigation says `text/html` in its Accept header, a
// fetch() caller (the Brug) says */* and keeps getting the JSON it already handles. The page is
// static Dutch — nothing from the request is interpolated into it, so there is nothing to escape.
function refuse(req: NextRequest, status: number, zin: string): NextResponse {
  if (!(req.headers.get("accept") ?? "").includes("text/html")) {
    return NextResponse.json({ error: zin }, { status });
  }
  const body = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Pakket niet opgehaald</title></head>
<body style="font-family:system-ui,sans-serif;background:#F8F9FA;margin:0;display:grid;place-items:center;min-height:100vh">
<main style="background:#fff;border:1px solid #E0E0E0;border-radius:12px;padding:28px 32px;max-width:420px">
<h1 style="font-size:16px;margin:0 0 8px">Het pakket is niet opgehaald</h1>
<p style="font-size:14px;color:#5F6368;line-height:1.6;margin:0">${zin}</p>
<p style="font-size:13px;color:#5F6368;line-height:1.6;margin:12px 0 0">Ga terug naar het vorige scherm en probeer het opnieuw. Blijft dit gebeuren, meld het ons dan.</p>
</main></body></html>`;
  return new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return refuse(req, 401, "Je bent niet (meer) ingelogd. Log opnieuw in en haal het pakket dan op.");
  }

  // ── Params ──
  const now = new Date();
  const year = Number(req.nextUrl.searchParams.get("year") ?? now.getFullYear());
  const quarterRaw = Number(req.nextUrl.searchParams.get("quarter"));
  const clientId = req.nextUrl.searchParams.get("clientId");

  if (!Number.isInteger(year) || year < 2020 || year > 2030) {
    return refuse(req, 400, "Deze link noemt een jaar dat we niet kennen.");
  }
  if (![1, 2, 3, 4].includes(quarterRaw)) {
    return refuse(req, 400, "Deze link noemt geen geldig kwartaal.");
  }
  const quarter = quarterRaw as Quarter;

  // ── Resolve ownerId + dual-path authorization ──
  let ownerId = user.id;

  if (clientId && clientId !== user.id) {
    // Only a linked accountant may export someone else's quarter.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "accountant") {
      return refuse(req, 403, "Dit pakket hoort bij een andere administratie dan de jouwe.");
    }
    const { data: link } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .maybeSingle();
    if (!link) {
      return refuse(req, 403, "Je bent niet (meer) aan deze klant gekoppeld, dus dit pakket is niet van jou op te halen.");
    }
    ownerId = clientId;

    // [BEWIJS] Leg vast dát de boekhouder dit kwartaal heeft opgehaald.
    //
    // Deze route logde niets, net als /api/readiness, /api/export en /api/quarterly — alleen
    // het verbreken van een koppeling werd bijgehouden. De klant kon dus nergens zien wat
    // zijn boekhouder had gedownload, terwijl "een ontworpen overdracht in plaats van een
    // gedeelde map" precies is wat dit product verkoopt. Een gedeelde map laat óók niets
    // zien; het verschil bestaat pas als het aantoonbaar is.
    //
    // Best effort en NA de autorisatie: een logfout mag een geautoriseerde download nooit
    // tegenhouden, en een geweigerde poging hoort hier niet als "opgehaald" te landen.
    void logAuditAction({
      userId: user.id,
      action: 'accountant.package_downloaded',
      entityType: 'quarter',
      entityId: `${ownerId}:${year}-Q${quarter}`,
    })
  }

  // ── Build (service_role, scoped to ownerId) ──
  let result;
  try {
    const pipeline = createPipelineClient();
    result = await buildClosingPackageZip({ ownerId, year, quarter, supabase: pipeline });
  } catch (err) {
    console.error("[CLOSING-PACKAGE] build failed", err);
    return refuse(req, 500, "Het samenstellen van het pakket is halverwege misgegaan. Er is niets verstuurd of veranderd; opnieuw proberen kan direct.");
  }

  // ── Filename ──
  let clientLabel = "klant";
  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("company_name, full_name")
    .eq("id", ownerId)
    .maybeSingle();
  if (ownerProfile) clientLabel = ownerProfile.company_name || ownerProfile.full_name || "klant";

  const filename = `${safe(clientLabel)}_Q${quarter}_${year}.zip`;

  return new NextResponse(new Uint8Array(result.zipBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Package-Warnings": String(result.summary.warnings.length),
    },
  });
}