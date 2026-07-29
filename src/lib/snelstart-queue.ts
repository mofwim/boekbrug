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

/** Factuur-id's die al geslaagd geboekt zijn — de idempotentie-filter. */
export async function loadPushedInvoiceIds(supabase: Client, userId: string): Promise<Set<string>> {
  const rows = await fetchAllRows<{ invoice_id: string }>((from, to) =>
    supabase
      .from("snelstart_exports")
      .select("invoice_id")
      .eq("user_id", userId)
      .eq("status", "pushed")
      .order("invoice_id", { ascending: true })
      .range(from, to),
  );

  return new Set(rows.map((r) => r.invoice_id));
}
