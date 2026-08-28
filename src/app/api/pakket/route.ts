// src/app/api/pakket/route.ts
// [PAKKET-LINK] De publieke download: het kwartaalpakket voor een boekhouder ZONDER account.
//
// GET /api/pakket?token={uuid}
//
// ── WAAROM DEZE ROUTE BESTAAT ──
// De kernbelofte ("aan het eind van het kwartaal staat alles klaar voor je boekhouder") werd
// alleen waargemaakt als de boekhouder zich registreerde: de kwartaal-cron loopt over
// accountant_clients, en de downloadknop in die mail wijst naar een route die inloggen eist. Het
// meest voorkomende Nederlandse geval — een kantoor dat al tien jaar op Exact draait en zich
// nooit ergens registreert — viel dus volledig buiten de belofte, en de ondernemer moest zelf
// een ZIP downloaden en met de hand aan een mail hangen. Precies het handwerk dat dit product
// wegneemt, teruggegeven op de laatste meter.
//
// ── HET TOKEN IS DE SLEUTEL, EN VERDER NIETS ──
// Zelfde vorm als /api/pay/[token] en de offerte-pagina: onraadbaar (uuid v4, door de database
// gezet), per mail verstuurd, en het opent PRECIES het ene kwartaal waarvoor het is gemaakt. Wat
// er gebouwd wordt komt volledig uit de RIJ — user_id, jaar, kwartaal — en geen enkele parameter
// uit de URL kan daar iets aan verschuiven. Een gast die het token heeft, kan er dus niets anders
// mee dan wat zijn klant hem gaf.
//
// ── FAIL-CLOSED, EN MET ÉÉN GEZICHT ──
// Onbekend, verlopen, ingetrokken: alle drie hetzelfde antwoord. Niet uit geheimzinnigheid maar
// omdat het verschil de lezer niets oplevert (hij kan alleen zijn klant om een nieuwe link
// vragen) terwijl het een rater wél iets vertelt: welke tokens BESTAAN.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { checkRateLimitByKey, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { buildClosingPackageZip } from "@/lib/closing-package";
import { shareStatus } from "@/lib/package-share";
import { logAuditAction } from "@/lib/audit";
import type { Quarter } from "@/lib/closing-package";

/**
 * Eén gezicht voor elke weigering, in HTML — de lezer is een boekhouder die in zijn mailbox op
 * een knop klikte, niet een client die JSON verwerkt.
 */
function weiger(status: number, zin: string): NextResponse {
  const body = `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Deze link werkt niet meer — BoekBrug</title></head>
<body style="margin:0;background:#f8f9fa;font-family:system-ui,-apple-system,sans-serif">
<main style="max-width:460px;margin:14vh auto;padding:28px;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
<h1 style="font-size:18px;color:#202124;margin:0 0 10px">Deze link werkt niet meer</h1>
<p style="font-size:14.5px;color:#5F6368;line-height:1.6;margin:0">${zin}</p>
<p style="font-size:13px;color:#5F6368;line-height:1.6;margin:14px 0 0">Vraag je klant om een nieuwe link te sturen — dat kost hem één tik.</p>
<p style="font-size:12px;color:#9aa0a6;margin:26px 0 0">BoekBrug — De brug tussen jou en je boekhouder</p>
</main></body></html>`;
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Een bestandsnaam die elk besturingssysteem accepteert — zelfde regel als de ingelogde route. */
function veiligeNaam(waarde: string): string {
  return waarde.replace(/[^\w\-. ]+/g, "_").replace(/\s+/g, "_").slice(0, 60) || "klant";
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  // Vorm eerst: een niet-uuid raakt de database niet eens.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return weiger(400, "De link is onvolledig of verminkt geraakt — bijvoorbeeld doordat hij over twee regels werd geknipt in de mail.");
  }

  // Per TOKEN, niet per IP: één gedeelde link mag niet als bouwmachine gebruikt worden, terwijl
  // een kantoor achter één kantoor-IP nooit door de download van een ander wordt geblokkeerd.
  // Het samenstellen van een pakket is tientallen lezingen plus een ZIP — dit is de duurste
  // publieke handeling die dit product kent, dus hier NIET failOpen: kan de teller niet worden
  // geraadpleegd, dan gaat de dure handeling niet door.
  const limit = await checkRateLimitByKey({
    bucketKey: `pakket:${token}`,
    endpoint: "/api/pakket",
    ...RATE_LIMITS.HEAVY_EXPORT,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const pipeline = createPipelineClient();

  // [RLS-UIT] Service_role, en het TOKEN is de afscherming — uniek, onraadbaar, alleen per mail
  // verstuurd. Precies de vorm die de RLS-UIT-poort als "reden 4" kent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: share, error } = await (pipeline as any)
    .from("package_shares")
    .select("id, user_id, year, quarter, expires_at, revoked_at, download_count")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("[PAKKET-LINK] share lookup failed", { error: error.message });
    // Niet "onbekend": wij konden het niet nakijken, en dat is iets anders dan een dode link.
    return weiger(503, "We konden deze link nu even niet nakijken. Probeer het over een paar minuten opnieuw.");
  }
  // Onbekend, verlopen en ingetrokken krijgen bewust hetzelfde antwoord — zie de kop.
  if (!share || shareStatus(share, Date.now()) !== "live") {
    return weiger(404, "Hij is verlopen, ingetrokken, of heeft nooit bestaan.");
  }

  const jaar = Number(share.year);
  const kwartaal = Number(share.quarter);
  if (!Number.isInteger(jaar) || ![1, 2, 3, 4].includes(kwartaal)) {
    console.error("[PAKKET-LINK] share row names an impossible period", { id: share.id, jaar, kwartaal });
    return weiger(404, "Hij verwijst naar een periode die we niet kunnen samenstellen.");
  }

  let result;
  try {
    // Alles komt uit de RIJ. Geen URL-parameter raakt de inhoud — dat is de kern van deze route.
    result = await buildClosingPackageZip({
      ownerId: share.user_id,
      year: jaar,
      quarter: kwartaal as Quarter,
      supabase: pipeline,
    });
  } catch (err) {
    console.error("[PAKKET-LINK] build failed", { id: share.id, err });
    return weiger(500, "Het samenstellen van het pakket ging halverwege mis. Er is niets veranderd; opnieuw proberen kan direct.");
  }

  // [BEWIJS] Leg vast DAT het is opgehaald — de eigenaar hoort op zijn eigen scherm te kunnen
  // zien dat zijn boekhouder het pakket heeft. Zonder dit blijft "verstuurd" een aanname, en is
  // deze overdracht niet meer aantoonbaar dan een gedeelde map. Best effort en NA het bouwen:
  // een telfout mag een geslaagde download nooit tegenhouden.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (pipeline as any)
      .from("package_shares")
      .update({
        last_downloaded_at: new Date().toISOString(),
        download_count: (Number(share.download_count) || 0) + 1,
      })
      .eq("id", share.id);
    await logAuditAction({
      userId: share.user_id,
      action: "package.link_downloaded",
      entityType: "quarter",
      entityId: `${share.user_id}:${jaar}-Q${kwartaal}`,
    });
  } catch (logErr) {
    console.error("[PAKKET-LINK] download not recorded", { id: share.id, logErr });
  }

  // ── Bestandsnaam ── zelfde vorm als de ingelogde route: de boekhouder ontvangt tientallen van
  // deze bestanden en herkent ze aan de KLANTNAAM, niet aan het product.
  let klantLabel = "klant";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: eigenaar } = await (pipeline as any)
    .from("profiles")
    .select("company_name, full_name")
    .eq("id", share.user_id)
    .maybeSingle();
  if (eigenaar) klantLabel = eigenaar.company_name || eigenaar.full_name || "klant";
  const bestandsnaam = `${veiligeNaam(klantLabel)}_Q${kwartaal}_${jaar}.zip`;

  return new NextResponse(new Uint8Array(result.zipBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${bestandsnaam}"`,
      "Cache-Control": "no-store",
    },
  });
}
