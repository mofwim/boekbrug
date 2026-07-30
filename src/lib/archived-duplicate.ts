// src/lib/archived-duplicate.ts
// [DUP-ARCHIVED] "Deze factuur bestaat al" — maar WAAR dan?
//
// Een upload wordt geweigerd als duplicaat op twee manieren: de byte-hash (exact hetzelfde
// bestand) en de semantische check (dezelfde factuur, ander bestand). Beide kijken bewust NIET
// naar de status van de bestaande factuur — dat is precies goed, want een genegeerde factuur is
// wél degelijk al geïmporteerd en mag niet nog een keer als kosten binnenkomen.
//
// Maar het maakt de melding oneerlijk. Wie een factuur negeert en hem daarna handmatig uploadt,
// kreeg te horen "die staat er al" terwijl hij in GEEN ENKELE gewone lijst te zien is: hij zit in
// het tabblad Genegeerd. Bij de byte-hash is dat extra pijnlijk, want die poort is met opzet niet
// te forceren (identieke bytes zijn hetzelfde bestand) — er was dus geen weg vooruit én geen weg
// terug, alleen een melding die niet klopte met wat de eigenaar zag.
//
// Dus: als de factuur waarmee de upload botst gearchiveerd is, zeggen we dat, en we noemen de
// juiste handeling — terugzetten, niet opnieuw toevoegen. Eén functie voor de zin, zodat de route
// en beide upload-schermen nooit iets anders kunnen beweren (zelfde patroon als invoice-removal).
//
// Dit verandert NIETS aan wie geblokkeerd wordt: dezelfde uploads worden geweigerd als eerst,
// met dezelfde 409. Alleen de tekst — en de knop die erbij hoort — worden waar.

import type { SupabaseClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

/** De genegeerde factuur waar een geweigerde upload op botste. */
export interface ArchivedDuplicate {
  invoice_id: string;
  invoice_number: string | null;
  client_name: string | null;
}

/**
 * De zin die de eigenaar leest. Altijd dezelfde, uit één bron — de 409 van /api/intake, die van
 * /api/email/upload en de knoptekst in beide schermen mogen elkaar niet tegenspreken.
 */
export function archivedDuplicateMessage(t: ArchivedDuplicate): string {
  const nr = (t.invoice_number ?? "").trim();
  const vendor = (t.client_name ?? "").trim();
  const what = nr
    ? `Factuur ${nr}${vendor ? ` van ${vendor}` : ""}`
    : vendor
      ? `Deze factuur van ${vendor}`
      : "Deze factuur";
  return `${what} staat in Genegeerd — je hebt hem eerder genegeerd. Zet hem daar terug in plaats van hem opnieuw toe te voegen.`;
}

/**
 * Is DEZE factuur een genegeerde (gearchiveerde) inkoopfactuur van deze gebruiker?
 * Geeft null terug zodra iets niet klopt — de aanroeper valt dan terug op de gewone
 * duplicaat-melding. Best-effort: een leesfout mag een correcte 409 nooit in een 500 veranderen.
 */
export async function archivedInvoiceById(
  supabase: Client,
  userId: string,
  invoiceId: string
): Promise<ArchivedDuplicate | null> {
  try {
    const { data } = await supabase
      .from("invoices")
      .select("id, status, direction, invoice_number, client_name")
      .eq("id", invoiceId)
      .eq("receiver_id", userId)
      .maybeSingle();
    if (!data) return null;
    const row = data as {
      id: string;
      status: string | null;
      direction: string | null;
      invoice_number: string | null;
      client_name: string | null;
    };
    // Alleen een genegeerde INKOOPfactuur kan via de Genegeerd-lijst teruggezet worden
    // (PATCH /api/email/confirm/[id] eist allebei). Al het andere → gewone melding.
    if (row.status !== "archived" || row.direction !== "incoming") return null;
    return {
      invoice_id: row.id,
      invoice_number: row.invoice_number,
      client_name: row.client_name,
    };
  } catch {
    return null;
  }
}

/**
 * Hoort er bij dit bestand een genegeerde factuur? Twee stappen, omdat de koppeling in beide
 * richtingen gelegd wordt: documents.invoice_id (gezet na de invoice-insert) en, voor rijen waar
 * dat nooit gebeurde, invoices.document_id.
 */
export async function archivedInvoiceForDocument(
  supabase: Client,
  userId: string,
  doc: { id: string; invoice_id?: string | null }
): Promise<ArchivedDuplicate | null> {
  try {
    if (doc.invoice_id) {
      const direct = await archivedInvoiceById(supabase, userId, doc.invoice_id);
      if (direct) return direct;
    }
    const { data } = await supabase
      .from("invoices")
      .select("id, status, direction, invoice_number, client_name")
      .eq("receiver_id", userId)
      .eq("document_id", doc.id)
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as {
      id: string;
      status: string | null;
      direction: string | null;
      invoice_number: string | null;
      client_name: string | null;
    };
    if (row.status !== "archived" || row.direction !== "incoming") return null;
    return {
      invoice_id: row.id,
      invoice_number: row.invoice_number,
      client_name: row.client_name,
    };
  } catch {
    return null;
  }
}
