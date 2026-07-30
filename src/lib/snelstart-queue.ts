// src/lib/snelstart-queue.ts
// [SNELSTART] Welke facturen staan klaar om naar SnelStart te gaan — juli 2026
//
// Eén plek voor de vraag "wat moet er nog door?", zodat de teller op het scherm en de
// facturen die de push-route daadwerkelijk verstuurt NOOIT uiteenlopen. Zodra die twee
// uit elkaar lopen gaat de gebruiker tellen wat niet geboekt is — precies het soort stille
// afwijking waar een BTW-aangifte op strandt.
//
// Lezen gebeurt met de SESSIE-client (RLS): een gebruiker kan alleen zijn eigen facturen
// doorsturen. Het duw-logboek schrijft de route met de pipeline-client, omdat de browser
// daar bewust geen schrijfrecht op heeft (zie de migratie).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { isPushable, type SnelStartInvoice, type SnelStartInvoiceLine } from "@/lib/snelstart-mapping";
import { fetchAllRows } from "@/lib/supabase-paginate";
// [SNELSTART-CLAIM] pushed | unknown — beide claimen de factuur; zie snelstart-claim.ts.
import { CLAIMING_STATUSES } from "./snelstart-claim";

type Client = SupabaseClient<Database>;

export const SNELSTART_INVOICE_SELECT =
  "id, invoice_number, invoice_date, due_date, direction, invoice_type, status, total_ex_btw, btw_amount, total_inc_btw, client_name" as const;

/** Statussen die een boeking kunnen worden — moet gelijk lopen met isPushable(). Ze staan
 *  hier óók als DB-filter, zodat we niet duizenden concepten ophalen om ze daarna weg te
 *  gooien. */
const BOOKABLE_STATUSES = ["sent", "paid", "overdue", "received", "processed"];

export interface CandidateFilter {
  /** Alleen deze facturen (uit de selectie op het scherm). */
  invoiceIds?: string[];
  /** Venster op factuurdatum, 'YYYY-MM-DD' (bv. een kwartaal). */
  from?: string;
  to?: string;
}

/** Datumvenster van een kwartaal, inclusief begin- en einddatum. */
export function quarterRange(year: number, quarter: number): { from: string; to: string } {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  // Dag 0 van de VOLGENDE maand = laatste dag van deze maand (dekt schrikkeljaren).
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${year}-${pad(startMonth)}-01`,
    to: `${year}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

/**
 * Facturen van deze gebruiker die een boeking kunnen worden, nieuwste eerst.
 *
 * Het DB-filter is de grove zeef; isPushable() blijft de definitieve toets, zodat er maar
 * één waarheid is over "mag dit geboekt worden".
 */
export async function loadPushCandidates(
  supabase: Client,
  userId: string,
  filter: CandidateFilter = {},
): Promise<SnelStartInvoice[]> {
  const rows = await fetchAllRows<SnelStartInvoice>((from, to) => {
    let q = supabase
      .from("invoices")
      .select(SNELSTART_INVOICE_SELECT)
      // Uitgaand hangt aan sender_id, inkomend aan receiver_id — beide zijn "van deze
      // gebruiker" (dezelfde or-filter als /api/aangifte).
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .in("status", BOOKABLE_STATUSES)
      .in("invoice_type", ["factuur", "creditnota"]);

    if (filter.invoiceIds?.length) q = q.in("id", filter.invoiceIds);
    if (filter.from) q = q.gte("invoice_date", filter.from);
    if (filter.to) q = q.lte("invoice_date", filter.to);

    // Stabiele volgorde (datum + id) — verplicht bij paginatie, anders kan een rij op de
    // paginagrens twee keer of nooit langskomen.
    return q
      .order("invoice_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
  });

  return rows.filter((row) => isPushable(row).ok);
}

/** Factuurregels van een set facturen, gegroepeerd per factuur. */
export async function loadInvoiceLines(
  supabase: Client,
  invoiceIds: string[],
): Promise<Map<string, SnelStartInvoiceLine[]>> {
  const byInvoice = new Map<string, SnelStartInvoiceLine[]>();
  if (invoiceIds.length === 0) return byInvoice;

  const rows = await fetchAllRows<{
    invoice_id: string | null;
    description: string | null;
    quantity: number | null;
    unit_price: number | null;
    btw_rate: number | null;
    line_total: number | null;
  }>((from, to) =>
    supabase
      .from("invoice_lines")
      .select("invoice_id, description, quantity, unit_price, btw_rate, line_total")
      .in("invoice_id", invoiceIds)
      .order("id", { ascending: true })
      .range(from, to),
  );

  for (const row of rows) {
    if (!row.invoice_id) continue;
    const list = byInvoice.get(row.invoice_id) ?? [];
    list.push({
      description: row.description,
      quantity: row.quantity,
      unit_price: row.unit_price,
      btw_rate: row.btw_rate,
      line_total: row.line_total,
    });
    byInvoice.set(row.invoice_id, list);
  }
  return byInvoice;
}

/**
 * Factuur-id's die niet (opnieuw) geboekt mogen worden — de idempotentie-filter.
 *
 * [SNELSTART-CLAIM] Dit was `.eq("status", "pushed")`. Sinds de claim VÓÓR de POST wordt gezet,
 * bestaat er een derde staat: 'unknown' — de boeking is verstuurd maar we kregen geen antwoord,
 * dus hij kán geboekt zijn. Die MOET hier meetellen. Zou de wachtrij hem opnieuw aanbieden, dan
 * boekt de volgende ronde dezelfde inkoopfactuur een tweede keer in het wettelijke inkoopboek van
 * de boekhouder — precies wat de claim moest voorkomen.
 *
 * 'failed' blijft er bewust buiten: dat is bewezen niet-geboekt en mag gewoon opnieuw mee.
 */
export async function loadPushedInvoiceIds(supabase: Client, userId: string): Promise<Set<string>> {
  return loadClaimedInvoiceIds(supabase, userId);
}

/**
 * Factuur-id's per claimende status APART.
 *
 * [SNELSTART-EERLIJK] Waarom dit los moet van de filter hierboven: die filter mag 'unknown'
 * meerekenen — dat is precies zijn taak. Maar een TELLER op het scherm mag dat niet. Toen de
 * statuspagina dezelfde verzameling gebruikte om "doorgestuurd" te tellen, kreeg een factuur
 * waarvan wij niet WETEN of hij geboekt is het label "doorgestuurd" — de ene onderscheiding die
 * de hele claim-vóór-de-POST-machinerie bestaat om te bewaren, ingeklapt naar valse voorspoed.
 * Dat is dezelfde stille onwaarheid die deze hele ronde eruit haalde, en hij is er per ongeluk
 * mee ingekomen. Vandaar: één query, twee verzamelingen, en de teller kiest zelf.
 */
export async function loadExportIdsByStatus(
  supabase: Client,
  userId: string,
): Promise<{ pushed: Set<string>; unknown: Set<string> }> {
  const rows = await fetchAllRows<{ invoice_id: string; status: string }>((from, to) =>
    supabase
      .from("snelstart_exports")
      .select("invoice_id, status")
      .eq("user_id", userId)
      .in("status", CLAIMING_STATUSES as string[])
      .order("invoice_id", { ascending: true })
      .range(from, to),
  );

  const pushed = new Set<string>();
  const unknown = new Set<string>();
  for (const r of rows) {
    if (r.status === "unknown") unknown.add(r.invoice_id);
    else pushed.add(r.invoice_id);
  }
  return { pushed, unknown };
}

/** Alles wat de factuur claimt — pushed én unknown. De idempotentie-filter. */
export async function loadClaimedInvoiceIds(supabase: Client, userId: string): Promise<Set<string>> {
  const { pushed, unknown } = await loadExportIdsByStatus(supabase, userId);
  return new Set([...pushed, ...unknown]);
}
