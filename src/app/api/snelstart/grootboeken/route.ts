// app/api/snelstart/grootboeken/route.ts
// [SNELSTART] Grootboekrekeningen ophalen voor de keuzelijsten — juli 2026
//
// GET /api/snelstart/grootboeken
//   → { grootboeken: [{ id, nummer, omschrijving }] }
//
// Een boekingsregel MOET een grootboek hebben. De gebruiker kiest één rekening voor
// inkoop (kosten) en één voor verkoop (omzet); die lijst komt live uit zijn eigen
// administratie, want elk rekeningschema is anders.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getSnelStartConnection, markSnelStartNeedsReauth } from "@/lib/snelstart-connection";
import { createSnelStartClient, dutchSnelStartError, SnelStartError } from "@/lib/snelstart-client";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const conn = await getSnelStartConnection(user.id);
  if (!conn) return NextResponse.json({ error: "Nog geen SnelStart-koppeling" }, { status: 404 });

  try {
    const client = createSnelStartClient({ clientKey: conn.clientKey });
    const grootboeken = await client.getGrootboeken();
    return NextResponse.json({ grootboeken });
  } catch (err) {
    if (err instanceof SnelStartError) {
      // Sleutel afgewezen → koppeling markeren, zodat de UI om een nieuwe sleutel vraagt
      // in plaats van elke volgende actie stil te laten mislukken.
      if (err.code === "INVALID_KEY" || err.code === "FORBIDDEN") {
        await markSnelStartNeedsReauth(user.id, err.message);
      }
      return NextResponse.json(
        { error: dutchSnelStartError(err.code), code: err.code },
        { status: err.code === "NOT_CONFIGURED" ? 503 : 502 },
      );
    }
    console.error("[SNELSTART] grootboeken ophalen mislukt", err);
    return NextResponse.json({ error: "Grootboeken ophalen mislukt" }, { status: 500 });
  }
}
