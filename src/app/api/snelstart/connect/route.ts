// app/api/snelstart/connect/route.ts
// [SNELSTART] Koppelen met een maatwerksleutel + standaard grootboeken zetten — juli 2026
//
// POST  /api/snelstart/connect   { clientKey, administrationLabel? }
//   → controleert de sleutel LIVE bij SnelStart, bewaart hem in Vault en geeft de
//     grootboekrekeningen terug zodat de gebruiker meteen kan kiezen waarop geboekt wordt.
// PATCH /api/snelstart/connect   { inkoopGrootboekId?, verkoopGrootboekId?, administrationLabel? }
//   → alleen de standaardinstellingen bijwerken.
//
// De sleutel wordt NOOIT opgeslagen voordat hij bewezen werkt: een verkeerd geplakte
// sleutel zou anders als "gekoppeld" op het scherm staan en pas bij de eerste push falen.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { logAuditAction, getClientIP } from "@/lib/audit";
import {
  createSnelStartClient,
  dutchSnelStartError,
  SnelStartError,
} from "@/lib/snelstart-client";
import {
  getSnelStartConnectionMeta,
  saveSnelStartConnection,
  updateSnelStartDefaults,
} from "@/lib/snelstart-connection";

/** Een maatwerksleutel is een lange, ondoorzichtige string. We accepteren alles binnen
 *  redelijke grenzen (het formaat is van SnelStart, niet van ons) maar weigeren lege of
 *  absurd lange invoer voordat we er een netwerkverzoek aan wagen. */
function normalizeClientKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (key.length < 20 || key.length > 4096) return null;
  return key;
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/snelstart/connect",
    ...RATE_LIMITS.SNELSTART_CONNECT,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  let body: { clientKey?: unknown; administrationLabel?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }

  const clientKey = normalizeClientKey(body.clientKey);
  if (!clientKey) {
    return NextResponse.json(
      {
        error:
          "Plak je maatwerksleutel uit SnelStart (Onderhoud → Maatwerk). Dat is een lange reeks tekens.",
      },
      { status: 400 },
    );
  }
  const label =
    typeof body.administrationLabel === "string" && body.administrationLabel.trim()
      ? body.administrationLabel.trim().slice(0, 100)
      : null;

  // Bewijs eerst dat de sleutel werkt: token ruilen + één echte leesactie.
  let grootboeken: Array<{ id: string; nummer: number | null; omschrijving: string }> = [];
  try {
    const client = createSnelStartClient({ clientKey });
    await client.verify();
    grootboeken = await client.getGrootboeken();
  } catch (err) {
    if (err instanceof SnelStartError) {
      console.warn("[SNELSTART] koppelpoging afgewezen", { userId: user.id, code: err.code });
      return NextResponse.json(
        { error: dutchSnelStartError(err.code), code: err.code },
        { status: err.code === "NOT_CONFIGURED" ? 503 : 400 },
      );
    }
    console.error("[SNELSTART] onverwachte fout bij koppelen", err);
    return NextResponse.json({ error: "Koppelen mislukt" }, { status: 500 });
  }

  const saved = await saveSnelStartConnection({
    userId: user.id,
    clientKey,
    administrationLabel: label,
  });
  if (!saved.success) {
    return NextResponse.json({ error: "Koppeling opslaan mislukt" }, { status: 500 });
  }

  await logAuditAction({
    userId: user.id,
    action: "snelstart.connected",
    entityType: "snelstart_connection",
    entityId: saved.meta.id,
    // Nooit de sleutel zelf, ook niet afgekapt: het label en de telling zeggen genoeg.
    newValue: { administrationLabel: label, grootboekenGevonden: grootboeken.length },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    connected: true,
    status: saved.meta.status,
    administrationLabel: saved.meta.administrationLabel,
    grootboeken,
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const meta = await getSnelStartConnectionMeta(user.id);
  if (!meta) return NextResponse.json({ error: "Nog geen SnelStart-koppeling" }, { status: 404 });

  let body: {
    inkoopGrootboekId?: unknown;
    verkoopGrootboekId?: unknown;
    administrationLabel?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const readId = (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    if (typeof v === "string" && uuid.test(v)) return v;
    return undefined; // onbruikbare waarde → veld niet aanraken
  };

  const ok = await updateSnelStartDefaults({
    userId: user.id,
    inkoopGrootboekId: readId(body.inkoopGrootboekId),
    verkoopGrootboekId: readId(body.verkoopGrootboekId),
    administrationLabel:
      typeof body.administrationLabel === "string"
        ? body.administrationLabel.trim().slice(0, 100) || null
        : undefined,
  });
  if (!ok) return NextResponse.json({ error: "Opslaan mislukt" }, { status: 500 });

  const updated = await getSnelStartConnectionMeta(user.id);
  return NextResponse.json({
    saved: true,
    inkoopGrootboekId: updated?.inkoopGrootboekId ?? null,
    verkoopGrootboekId: updated?.verkoopGrootboekId ?? null,
    grootboekenIngesteld: Boolean(updated?.inkoopGrootboekId && updated?.verkoopGrootboekId),
  });
}
