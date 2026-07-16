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
