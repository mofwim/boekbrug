// src/lib/own-invoice-lookup.ts
// [EIGEN-NUMMER] Find the owner's OWN outgoing invoice by the number a document claims to carry.
//
// The reader hands verifyInvoiceFromPdf a callback instead of a client: ai.ts stays free of
// database imports, and every intake door — session-scoped route or service-role sync — builds the
// callback from the client it already holds. The row this returns is compared by the PURE matcher
// in own-document.ts (matchesOwnInvoiceNumber); this file only fetches, it never judges.
//
// [RLS-UIT] The sync door runs on the service-role pipeline client, so ownership is in the QUERY,
// not the policy: sender_id is filtered explicitly and must stay that way.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnOutgoingInvoiceRef } from "./own-document";

export type OwnInvoiceLookup = (invoiceNumber: string) => Promise<OwnOutgoingInvoiceRef | null>;

/**
 * A lookup bound to one owner. A database error answers null — the reading must survive a
 * hiccup here; the identity guard in own-document.ts still stands on its own.
 */
export function makeOwnInvoiceLookup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
): OwnInvoiceLookup {
  return async (invoiceNumber: string) => {
    const nr = String(invoiceNumber ?? "").trim();
    if (nr.length < 3) return null;
    try {
      const { data, error } = await supabase
        .from("invoices")
        .select("invoice_number, total_inc_btw, client_name")
        .eq("sender_id", userId)
        .eq("direction", "outgoing")
        .eq("invoice_number", nr)
        .limit(1);
      if (error || !data?.length) return null;
      const row = data[0] as { invoice_number: string | null; total_inc_btw: number | null; client_name: string | null };
      return {
        invoiceNumber: row.invoice_number,
        totalIncBtw: row.total_inc_btw,
        clientName: row.client_name,
      };
    } catch {
      return null;
    }
  };
}
