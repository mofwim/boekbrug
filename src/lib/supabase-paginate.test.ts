// [PAGINATION] Pure node test — run: npx tsx src/lib/supabase-paginate.test.ts
// Proves fetchAllRows pages past the 1000-row cap and returns EVERY row (no silent truncation),
// and that fetchAllRowsForIds does the same for an id list — which has a SECOND, earlier ceiling:
// the ids travel in the URL, so a few hundred of them outgrow the request line and the whole call
// fails. supabase-js reports both as an ordinary `error` rather than throwing, so a caller that
// reads only `data` cannot tell a truncated answer from a complete one. These helpers sit under
// the reversal paths (bank/unlink, bank/delete-statement), where that difference decides whether
// an invoice is put back to unpaid or left paid by a payment that no longer exists.
import { fetchAllRows, chunkIds, fetchAllRowsForIds } from "./supabase-paginate";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A fake table with N rows; the factory returns the [from,to] slice like PostgREST would.
function fakeTable(n: number) {
  const all = Array.from({ length: n }, (_, i) => ({ id: i }));
  let calls = 0;
  const query = (from: number, to: number) => {
    calls++;
    return Promise.resolve({ data: all.slice(from, to + 1), error: null });
  };
  return { query, calls: () => calls };
}

async function run() {
  console.log("\n— returns every row across pages —");
  {
    const t = fakeTable(2500); // > 2 full pages
    const rows = await fetchAllRows<{ id: number }>((f, to) => t.query(f, to));
    check("all 2500 rows returned", rows.length === 2500);
    check("rows are in order, none dropped", rows[0].id === 0 && rows[2499].id === 2499);
    check("took 3 pages (1000+1000+500)", t.calls() === 3);
  }

  console.log("\n— an exact multiple of the page size still terminates —");
  {
    const t = fakeTable(2000);
    const rows = await fetchAllRows<{ id: number }>((f, to) => t.query(f, to));
    check("all 2000 rows returned", rows.length === 2000);
    // 2 full pages then a 3rd empty page confirms the end (short page = stop).
    check("terminates (3 calls: 1000,1000,0)", t.calls() === 3);
  }

  console.log("\n— a single short page returns immediately —");
  {
    const t = fakeTable(42);
    const rows = await fetchAllRows<{ id: number }>((f, to) => t.query(f, to));
    check("42 rows, one call", rows.length === 42 && t.calls() === 1);
  }

  console.log("\n— an error is surfaced, not swallowed —");
  {
    let threw = false;
    try {
      await fetchAllRows<{ id: number }>(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    } catch (e) { threw = e instanceof Error && e.message === "boom"; }
    check("error propagates (never silently returns partial data)", threw);
  }

  console.log("\n— an error on a LATER page discards the pages that worked —");
  {
    // The dangerous shape: page 1 succeeds, page 2 fails. Returning the 1000 rows already in hand
    // would look exactly like a complete small table.
    let n = 0, threw = false;
    try {
      await fetchAllRows<{ id: number }>(() => {
        n++;
        return n === 1
          ? Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null })
          : Promise.resolve({ data: null, error: { message: "page 2 failed" } });
      });
    } catch { threw = true; }
    check("throws rather than returning the first page as the whole answer", threw);
  }

  console.log("\n— chunkIds —");
  {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids);
    check("450 ids → 200 / 200 / 50", chunks.length === 3 && chunks[0].length === 200 && chunks[2].length === 50);
    check("nothing lost, order preserved", chunks.flat().join() === ids.join());
    check("empty in → empty out", chunkIds([]).length === 0);
    check("fewer than one chunk → one chunk", chunkIds(["a", "b"]).length === 1);
  }

  console.log("\n— fetchAllRowsForIds: chunked AND paged —");
  {
    // 3000 ids is the real shape: every matched bank line of a busy account. Sent whole, that id
    // list alone is ~115 KB of URL — the request dies before the row cap is even reached.
    const sentSizes: number[] = [];
    const rows = await fetchAllRowsForIds<{ id: string }, string>(
      Array.from({ length: 3000 }, (_, i) => `tx-${i}`),
      (chunk, from) => {
        if (from === 0) sentSizes.push(chunk.length);
        return Promise.resolve({ data: chunk.map((c) => ({ id: c })), error: null });
      },
    );
    check("all 3000 rows come back", rows.length === 3000);
    check("split into 15 chunks", sentSizes.length === 15);
    check("no id list is ever sent whole", sentSizes.every((n) => n <= 200));
  }
  {
    // A single chunk can still hold more than one page of rows — one batch transaction can have
    // many links — so the chunking must not replace the paging.
    const pages: number[] = [];
    const all = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    const rows = await fetchAllRowsForIds<{ id: number }, string>(["a"], (_chunk, from, to) => {
      pages.push(from);
      return Promise.resolve({ data: all.slice(from, to + 1), error: null });
    });
    check("a chunk of 1500 rows is paged, not truncated", rows.length === 1500 && pages.length === 2);
  }
  {
    const seen: string[][] = [];
    await fetchAllRowsForIds<{ id: string }, string>(["a", "a", "b", "b"], (chunk) => {
      seen.push(chunk);
      return Promise.resolve({ data: [], error: null });
    });
    check("duplicate ids are collapsed before querying", seen[0].length === 2);
  }
  {
    let queried = false;
    const rows = await fetchAllRowsForIds<{ id: string }, string>([], () => {
      queried = true;
      return Promise.resolve({ data: [], error: null });
    });
    check("empty id list → no query at all", rows.length === 0 && !queried);
  }
  {
    let threw = false;
    try {
      await fetchAllRowsForIds<{ id: string }, string>(["a"], () =>
        Promise.resolve({ data: null, error: { message: "414" } }),
      );
    } catch (e) { threw = e instanceof Error && e.message === "414"; }
    check("an error inside a chunk throws — never a quiet subset", threw);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run();
