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
  const { data, error } = await supabase
    .from("invoices")
    .select("supplier_id, client_name, invoice_date")
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .in("status", ["processing", "received", "paid"])
    .not("invoice_date", "is", null)
    .order("invoice_date", { ascending: false })
    .limit(2000);

  if (error) return NextResponse.json({ missing: [] });

  // Groeperen op de sterkste identiteit die de rij heeft: supplier_id wanneer de registratie hem
  // heeft opgelost, anders de genormaliseerde naamsleutel — zodat "KPN B.V." en "KPN" één ritme
  // vormen in plaats van twee halve.
  type Row = { supplier_id: string | null; client_name: string | null; invoice_date: string | null };
  const groups = new Map<string, { name: string; dates: string[] }>();
  for (const row of (data ?? []) as Row[]) {
    const naam = (row.client_name ?? "").trim();
    const key = row.supplier_id ?? (naam ? `naam:${supplierNameKey(naam)}` : null);
    if (!key || !row.invoice_date) continue;
    const g = groups.get(key);
    if (g) g.dates.push(row.invoice_date);
    else groups.set(key, { name: naam, dates: [row.invoice_date] });
  }

  const today = new Date().toISOString().slice(0, 10);
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
