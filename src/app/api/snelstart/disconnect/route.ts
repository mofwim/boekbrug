// app/api/snelstart/disconnect/route.ts
// [SNELSTART] Koppeling verbreken — juli 2026
//
// POST /api/snelstart/disconnect
//   → verwijdert de maatwerksleutel uit Vault en de koppelrij uit de database.
//
// Het duw-logboek (snelstart_exports) blijft staan: dat is de administratieve
// geschiedenis. Zou het meegewist worden, dan boekt een latere hernieuwde koppeling alles
// nóg een keer in de administratie.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { logAuditAction, getClientIP } from "@/lib/audit";
import {
  deleteSnelStartConnection,
  getSnelStartConnectionMeta,
} from "@/lib/snelstart-connection";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const meta = await getSnelStartConnectionMeta(user.id);
  // Al ontkoppeld: geen fout. Twee keer op de knop drukken hoort niets te breken.
  if (!meta) return NextResponse.json({ disconnected: true });

  const ok = await deleteSnelStartConnection(user.id);
  if (!ok) return NextResponse.json({ error: "Ontkoppelen mislukt" }, { status: 500 });

  await logAuditAction({
    userId: user.id,
    action: "snelstart.disconnected",
    entityType: "snelstart_connection",
    entityId: meta.id,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ disconnected: true });
}
