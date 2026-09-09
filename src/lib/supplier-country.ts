// src/lib/supplier-country.ts
// [LEVERANCIER-LAND] The country the owner recorded per supplier, read on its own.
//
// suppliers.country (supplier_country.sql) is newer than the generated types and than some
// installations. Every reader that needs it — the supplier list, the aangifte route, the closing
// package — reads it HERE, apart from its main query, so a column that is not there yet costs the
// country and never the list, the concept or the ZIP. The rule that turns a country into rubriek
// 4a or 4b is pure and lives in foreign-purchase-vat.ts; this file is only the read.
//
// [NO-SILENT-EMPTY] Two different empties, kept apart: a column that does not exist means nobody
// could have recorded a country (the Netherlands for everyone, which every row was before); a read
// that FAILED means the countries are unknown, and a caller that puts figures on a tax return says
// so rather than declaring 4a/4b from btw-nummers alone as if that were the whole picture.

import { isUnknownColumn } from "./created-by";
import { fetchAllRows } from "./supabase-paginate";

export interface SupplierCountries {
  /** supplier id → ISO code, or null where the owner recorded nothing. */
  byId: Map<string, string | null>;
  /** The column is not on this installation: no country could have been recorded. */
  columnMissing: boolean;
  /** The read failed for another reason: the countries are UNKNOWN, not absent. */
  failed: boolean;
}

/**
 * Any Supabase client — the session client on a screen, the pipeline client in a route. The
 * column is newer than the generated types, so the query below is untyped on purpose.
 */
export type SupplierCountryClient = { from: (relation: never) => unknown };

/** The recorded country of every supplier of this owner. Never throws. */
export async function readSupplierCountries(client: SupplierCountryClient, ownerId: string): Promise<SupplierCountries> {
  const byId = new Map<string, string | null>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relaxed = client as unknown as { from: (relation: string) => any };
  try {
    const rows = await fetchAllRows<{ id: string; country: string | null }>((from, to) =>
      relaxed.from("suppliers").select("id, country").eq("user_id", ownerId).order("id", { ascending: true }).range(from, to),
    );
    for (const r of rows) byId.set(r.id, r.country ?? null);
    return { byId, columnMissing: false, failed: false };
  } catch (e) {
    // fetchAllRows rethrows the PostgREST message; the column check reads that message.
    const err = e instanceof Error ? { message: e.message } : e;
    if (isUnknownColumn(err, "country")) return { byId, columnMissing: true, failed: false };
    console.warn("[LEVERANCIER-LAND] supplier countries could not be read", { ownerId, error: e instanceof Error ? e.message : String(e) });
    return { byId, columnMissing: false, failed: true };
  }
}

/** The one sentence a concept carries when the countries could not be read. */
export const SUPPLIER_COUNTRY_READ_FAILED_NOTE =
  "De landen van je leveranciers konden niet worden gelezen. Rubriek 4a en 4b zijn daarom alleen afgeleid uit " +
  "de btw-nummers van je leveranciers; een leverancier met alleen een vastgelegd land ontbreekt. Genereer het concept opnieuw.";
