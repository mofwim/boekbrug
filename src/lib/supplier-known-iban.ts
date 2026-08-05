// src/lib/supplier-known-iban.ts
// [SUPPLIER-IBAN] Hand the matcher the account each supplier is known to bill from.
//
// The matcher's IBAN tier reads `invoices.vendor_iban` — the account printed on THAT document. It
// is null far more often than the supplier is unknown: the number sits in a PDF footer the
// extractor did not reach, the invoice arrived before that supplier had ever been seen, or the
// supplier simply prints it only on the payment slip. Meanwhile `suppliers.iban` has held the
// answer since the registry resolved that vendor for the first time, and no matcher ever asked.
//
// The result is a bank line carrying a counterpart IBAN, no invoice number and (on MT940) no
// counterparty name: unbookable by construction, sitting in the manual pile next to an invoice
// whose supplier the app can name.
//
// This is the read half only — it fetches, it does not decide. What the signal is WORTH is argued
// in bank-matching.ts, which deliberately scores it below the document's own IBAN and books it at
// the flagged tier: the registry can attach an account to a supplier via a normalised NAME key,
// and two real companies can normalise to the same key.
//
// Best-effort by the same contract as the registry itself: a failed or not-yet-migrated read
// returns an empty map, and an empty map means the matcher behaves exactly as it did before. That
// degradation is safe in the only direction that matters — it removes evidence, never invents it.

import { fetchAllRowsForIds } from "./supabase-paginate";

/** The invoice fields this needs. A structural subset of every matcher caller's select. */
export interface InvoiceSupplierRef {
  supplier_id?: string | null;
  vendor_iban?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * supplier_id → iban, for the suppliers referenced by invoices that do NOT already carry their own
 * vendor_iban.
 *
 * Scoped to those on purpose: when the document named the account, that is the stronger claim and
 * the registry adds nothing — so it is not worth a row in the query, and it keeps the map from
 * carrying entries whose only possible effect would be to duplicate a signal that already fired.
 */
export async function fetchSupplierIbans(
  client: AnyClient,
  userId: string,
  invoices: readonly InvoiceSupplierRef[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      invoices
        .filter((i) => !(i.vendor_iban ?? "").trim())
        .map((i) => (i.supplier_id ?? "").trim())
        .filter((s) => s.length > 0),
    ),
  ];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  try {
    // [IN-CHUNK] Chunked and paged like every other id-keyed read here: a silent truncation would
    // remove the signal from the invoices that fell off the end, which reads as "this supplier has
    // no known account" — a wrong answer that looks exactly like a right one.
    const rows = await fetchAllRowsForIds<{ id: string; iban: string | null }, string>(
      ids,
      (chunk, from, to) =>
        client
          .from("suppliers")
          .select("id, iban")
          .eq("user_id", userId)
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<{ data: { id: string; iban: string | null }[] | null; error: { message: string } | null }>,
    );
    for (const r of rows) {
      const iban = (r.iban ?? "").replace(/\s+/g, "").toUpperCase();
      // The matcher's own ibanMatches ignores anything shorter than a real IBAN; filtering here too
      // keeps a junk value from occupying the map and reading as knowledge.
      if (iban.length >= 15) out.set(r.id, iban);
    }
  } catch (e) {
    // The registry migration may not have landed, or the read failed. Either way: no map, no
    // signal, and the matcher is exactly what it was before this file existed.
    console.warn("[SUPPLIER-IBAN] supplier account lookup unavailable — matching without it", {
      userId, error: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}

/** Attach the known account to each invoice row, leaving one that names its own untouched. */
export function withSupplierIbans<T extends InvoiceSupplierRef>(
  invoices: readonly T[],
  ibanBySupplierId: ReadonlyMap<string, string>,
): Array<T & { supplier_known_iban: string | null }> {
  return invoices.map((i) => ({
    ...i,
    supplier_known_iban: (i.vendor_iban ?? "").trim()
      ? null // the document answered; the registry has nothing to add
      : ibanBySupplierId.get((i.supplier_id ?? "").trim()) ?? null,
  }));
}
