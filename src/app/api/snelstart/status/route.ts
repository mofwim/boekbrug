// app/api/snelstart/status/route.ts
// [SNELSTART] Status van de koppeling + hoeveel er klaarstaat — juli 2026
//
// GET /api/snelstart/status
//   → { configured, connected, status, administrationLabel, grootboekenIngesteld,
//       lastPushAt, lastError, counts: { klaar, doorgestuurd, onbekend, mislukt } }
//
// `configured` zegt of de SERVER de koppeling aankan (subscription key aanwezig).
// Zonder die sleutel heeft het geen zin de gebruiker om zijn maatwerksleutel te vragen —
// dan toont de UI meteen dat de koppeling nog niet beschikbaar is.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getSnelStartConnectionMeta } from "@/lib/snelstart-connection";
import { loadPushCandidates, loadHeldCandidates, loadExportIdsByStatus } from "@/lib/snelstart-queue";
import { pushHoldReason } from "@/lib/snelstart-mapping";

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
      counts: { klaar: 0, doorgestuurd: 0, onbekend: 0, mislukt: 0 },
    });
  }

  // Tellers: exact dezelfde selectie als de push-route, anders belooft het scherm iets
  // anders dan de knop doet.
  // [SNELSTART-EERLIJK] pushed en unknown APART opgehaald. De wachtrij-filter mag ze samen
  // nemen — een onbekende afloop moet de factuur blijven claimen — maar een TELLER mag dat niet:
  // "doorgestuurd" over een factuur waarvan wij niet weten of hij geboekt is, klapt precies het
  // onderscheid in dat de hele claim-vóór-de-POST-machinerie bestaat om te bewaren.
  // [PUSH-ACK] "klaar" en "tegengehouden" komen uit dezelfde kandidatenset, zodat er geen factuur
  // tussen de twee tellers kan wegvallen. Zonder de tweede lijst zou een tegengehouden factuur
  // NERGENS meer opduiken — en een factuur die nergens staat is er voor de ondernemer niet, tot de
  // boekhouder erom vraagt.
  const [candidates, held, ids] = await Promise.all([
    loadPushCandidates(supabase, user.id),
    loadHeldCandidates(supabase, user.id),
    loadExportIdsByStatus(supabase, user.id),
  ]);
  const geclaimd = new Set([...ids.pushed, ...ids.unknown]);
  const klaar = candidates.filter((c) => !geclaimd.has(c.id)).length;

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
      doorgestuurd: ids.pushed.size,
      // Niet "doorgestuurd" en niet "mislukt": verstuurd, maar zonder bevestiging. Een mens
      // controleert het in SnelStart; de app boekt hem niet vanzelf opnieuw.
      onbekend: ids.unknown.size,
      mislukt: mislukt ?? 0,
      // Wachten op een akkoord van de eigenaar. Apart geteld van "klaar": die twee optellen zou de
      // teller weer laten zeggen dat er meer klaarstaat dan de poort doorlaat.
      tegengehouden: held.filter((h) => !geclaimd.has(h.invoice.id)).length,
    },
    // De lijst zelf, want een aantal zonder namen is geen actie. Alleen wat nog niet geclaimd is.
    held: held
      .filter((h) => !geclaimd.has(h.invoice.id))
      .map((h) => ({
        id: h.invoice.id,
        invoiceNumber: h.invoice.invoice_number,
        clientName: h.invoice.client_name,
        totalIncBtw: h.invoice.total_inc_btw,
        invoiceDate: h.invoice.invoice_date,
        reasons: h.flags.map((f) => pushHoldReason(f)),
      })),
  });
}
