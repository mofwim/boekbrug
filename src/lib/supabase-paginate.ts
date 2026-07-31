// src/lib/supabase-paginate.ts
// [PAGINATION] PostgREST returns at most ~1000 rows per request (Supabase default), and the
// truncation is SILENT — no error, no flag. A busy shop's quarter of bank_transactions,
// cash_entries or invoices can exceed 1000, so a single .select() would drop rows 1001+ and
// silently UNDERSTATE omzet / kosten / voorbelasting on the concept aangifte. This pages past
// the cap with a stable order so every row reaches the reconciliation engine.
//
// Usage: pass a factory that rebuilds the SAME filtered query for a given [from,to] window,
// ending in .order(<stable unique column>).range(from, to). A builder is single-use once
// awaited, so it must be rebuilt each page.
export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break; // a short page = the last page
    if (from > 5_000_000) break;   // hard backstop against an unbounded loop
  }
  return out;
}

// [IN-CHUNK] `.in("id", [...])` has TWO ceilings, and both are silent.
//
//   1. The response is capped at the same ~1000 rows as any other select. A join-table read
//      keyed on 3.000 transaction ids returns the first 1000 links and no error.
//   2. The list travels in the URL (`?id=in.(uuid,uuid,…)`), so ~39 bytes per uuid. Past a few
//      hundred ids the request line outgrows the proxy's header buffer and the whole call dies
//      with a 414 — which supabase-js reports as an ordinary `error`, not an exception, so a
//      caller that only destructures `data` sees "no rows" and carries on.
//
// Both are fatal in exactly the same way: the caller believes it read everything. This chunks
// the id list AND pages each chunk, so a caller gets every row or a thrown error — never a
// quiet subset. Order the query by a stable unique column, as fetchAllRows requires.
const ID_CHUNK = 200;

export function chunkIds<K>(ids: K[], size: number = ID_CHUNK): K[][] {
  const out: K[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Read every row matching an id list, chunked and paged. `makeQuery` rebuilds the SAME query
 * for one chunk and one [from,to] window — a builder is single-use once awaited.
 * Throws on the first error (like fetchAllRows) so a partial read can never pass as complete.
 */
export async function fetchAllRowsForIds<T, K>(
  ids: K[],
  makeQuery: (
    chunk: K[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const out: T[] = [];
  for (const chunk of chunkIds(unique)) {
    out.push(...(await fetchAllRows<T>((from, to) => makeQuery(chunk, from, to))));
  }
  return out;
}
