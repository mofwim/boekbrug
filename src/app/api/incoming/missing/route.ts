// src/app/api/incoming/missing/route.ts
// [RITME] "Welke factuur is er NIET gekomen?"
//
// De rest van de app kijkt naar wat binnenkomt. Dit is het enige eindpunt dat naar een AFWEZIGHEID
// kijkt — en dat is precies de fout die niemand opmerkt, want een lege wachtrij ziet er hetzelfde
// uit als een afgehandelde wachtrij. Pas bij de aangifte klopt de voorbelasting niet.
//
// Read-only, gebruikerscontext, geen AI: het groepeert de bestaande inkoopfacturen per leverancier
// en laat de pure rekenkunde in @/lib/supplier-cadence oordelen. Die zwijgt in verreweg de meeste
// gevallen, en dat is het ontwerp — zie de drie regels bovenaan dat bestand.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { assessSupplierCadence, cadenceReason, type CadenceVerdict } from "@/lib/supplier-cadence";
import { supplierNameKey } from "@/lib/supplier-registry";
// [TZ] The owner's day, not the server's — see amsterdamToday().
import { amsterdamToday } from "@/lib/format-nl";
// [RITME-AFKAP] Een afgekapte lezing is hier hetzelfde als "er ontbreekt niets".
import { fetchAllRows } from "@/lib/supabase-paginate";
import { reportHandledFailure } from "@/lib/report-handled";

export const dynamic = "force-dynamic";

export interface MissingInvoice {
  supplier: string;
  reason: string;
  cadence: CadenceVerdict["cadence"];
  lastSeen: string;
  daysLate: number;
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // Het ritme wordt afgeleid uit facturen die ECHT geteld hebben. Genegeerde facturen doen niet
  // mee: die heeft de eigenaar juist weggezet, en ze zouden een ritme suggereren dat hij zelf
  // heeft afgewezen. Facturen zonder datum kunnen per definitie geen ritme dragen.
  // [RITME-AFKAP] `.limit(2000)` was a promise PostgREST does not keep: a single response is capped
  // at ~1000 rows, so the limit read as "everything" and returned half. On an endpoint that looks
  // at an ABSENCE that is the worst possible truncation — it goes quiet on exactly the suppliers
  // with the longest history, which are the monthly rent, the accountant's fee and the abonnement:
  // the invoices whose rhythm is most regular and whose absence is most meaningful.
  //
  // The header of this file already names the failure it becomes: "een lege wachtrij ziet er
  // hetzelfde uit als een afgehandelde wachtrij". Paged, so the read is complete or it throws.
  type InvRow = { supplier_id: string | null; client_name: string | null; invoice_date: string | null };
  let rows: InvRow[];
  try {
    rows = await fetchAllRows<InvRow>((from, to) => supabase
      .from("invoices")
      .select("supplier_id, client_name, invoice_date")
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .in("status", ["processing", "received", "paid"])
      .not("invoice_date", "is", null)
      .order("id", { ascending: true })
      .range(from, to));
  } catch (e) {
    // [RITME-STIL] A failed read still answers with an empty list, because the caller renders a
    // list and there is nothing honest to put in it. But it must not be SILENT: "we could not look"
    // and "nothing is missing" render identically on screen, and this endpoint exists precisely
    // because those two are indistinguishable to the eye.
    reportHandledFailure({
      tag: "RITME",
      message: "the missing-invoice check could not read the invoices — the owner was shown 'niets ontbreekt' without anything having been checked",
      severity: "gate-unavailable",
      context: { userId: user.id, error: e instanceof Error ? e.message : String(e) },
    });
    return NextResponse.json({ missing: [] });
  }

  // Groeperen op de sterkste identiteit die de rij heeft: supplier_id wanneer de registratie hem
  // heeft opgelost, anders de genormaliseerde naamsleutel — zodat "KPN B.V." en "KPN" één ritme
  // vormen in plaats van twee halve.
  type Row = { supplier_id: string | null; client_name: string | null; invoice_date: string | null };
  const groups = new Map<string, { name: string; dates: string[] }>();
  for (const row of rows as Row[]) {
    const naam = (row.client_name ?? "").trim();
    const key = row.supplier_id ?? (naam ? `naam:${supplierNameKey(naam)}` : null);
    if (!key || !row.invoice_date) continue;
    const g = groups.get(key);
    if (g) g.dates.push(row.invoice_date);
    else groups.set(key, { name: naam, dates: [row.invoice_date] });
  }

  // [TZ] The owner's day: this date decides whether a supplier's monthly invoice is judged LATE,
  // and for the hour after midnight UTC still says yesterday.
  const today = amsterdamToday();
  const missing: MissingInvoice[] = [];
  for (const g of groups.values()) {
    const verdict = assessSupplierCadence(g.dates, today);
    if (!verdict) continue;
    missing.push({
      supplier: g.name,
      reason: cadenceReason(g.name, verdict),
      cadence: verdict.cadence,
      lastSeen: verdict.lastSeen,
      daysLate: verdict.daysLate,
    });
  }

  // Langst wachtend bovenaan — dat is de factuur waar de meeste tijd overheen is gegaan en die het
  // moeilijkst nog op te vragen is.
  missing.sort((a, b) => b.daysLate - a.daysLate);

  return NextResponse.json({ missing });
}
