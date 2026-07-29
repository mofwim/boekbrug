// app/api/snelstart/status/route.ts
// [SNELSTART] Status van de koppeling + hoeveel er klaarstaat — juli 2026
//
// GET /api/snelstart/status
//   → { configured, connected, status, administrationLabel, grootboekenIngesteld,
//       lastPushAt, lastError, counts: { klaar, doorgestuurd, mislukt } }
//
// `configured` zegt of de SERVER de koppeling aankan (subscription key aanwezig).
// Zonder die sleutel heeft het geen zin de gebruiker om zijn maatwerksleutel te vragen —
// dan toont de UI meteen dat de koppeling nog niet beschikbaar is.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getSnelStartConnectionMeta } from "@/lib/snelstart-connection";
import { loadPushCandidates, loadPushedInvoiceIds } from "@/lib/snelstart-queue";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const configured = Boolean(process.env.SNELSTART_SUBSCRIPTION_KEY);
  const meta = await getSnelStartConnectionMeta(user.id);

  if (!meta) {
    return NextResponse.json({
      configured,
      connected: false,
      counts: { klaar: 0, doorgestuurd: 0, mislukt: 0 },
    });
  }

  // Tellers: exact dezelfde selectie als de push-route, anders belooft het scherm iets
  // anders dan de knop doet.
  const [candidates, pushedIds] = await Promise.all([
    loadPushCandidates(supabase, user.id),
    loadPushedInvoiceIds(supabase, user.id),
  ]);
  const klaar = candidates.filter((c) => !pushedIds.has(c.id)).length;

  const { count: mislukt } = await supabase
    .from("snelstart_exports")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "failed");

  return NextResponse.json({
    configured,
    connected: true,
    status: meta.status,
    administrationLabel: meta.administrationLabel,
    grootboekenIngesteld: Boolean(meta.inkoopGrootboekId && meta.verkoopGrootboekId),
    inkoopGrootboekId: meta.inkoopGrootboekId,
    verkoopGrootboekId: meta.verkoopGrootboekId,
    connectedAt: meta.connectedAt,
    lastPushAt: meta.lastPushAt,
    lastError: meta.lastError,
    counts: {
      klaar,
      doorgestuurd: pushedIds.size,
      mislukt: mislukt ?? 0,
    },
  });
}
