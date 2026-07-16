// [PAGINATION] Pure node test — run: npx tsx src/lib/supabase-paginate.test.ts
// Proves fetchAllRows pages past the 1000-row cap and returns EVERY row (no silent truncation).
import { fetchAllRows } from "./supabase-paginate";

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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run();
