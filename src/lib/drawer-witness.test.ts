// [KAS-NEGATIEF] Pure node test — run: npx tsx src/lib/drawer-witness.test.ts
//
// loadDrawerWitness is the ONE answer to "did this drawer go below zero?", read by the readiness
// verdict AND by the filing gate. Two properties matter, and neither is about arithmetic:
//
//   1. The starting float is part of the answer. A €500 till float covering a €400 payout is a
//      perfectly healthy drawer; lose the float and it reads as −€400 — a fabricated blocker on
//      the screen that decides whether the quarter may be handed over, and now a fabricated
//      refusal to file.
//   2. A failed read must THROW, never quietly become €0. That is exactly how the float used to
//      be lost: `const { data: prof }` with the error dropped, in five separate places.

import { loadDrawerWitness } from "./drawer-witness";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

type Row = Record<string, unknown>;
/** A Supabase stand-in: serves each table's rows, and can be told to fail one of them. */
function fakeClient(opts: {
  turnover?: Row[];
  entries?: Row[];
  openingBalance?: number | null;
  failTable?: "daily_turnover" | "cash_entries" | "profiles";
}) {
  const rowsFor = (table: string): Row[] =>
    table === "daily_turnover" ? (opts.turnover ?? [])
    : table === "cash_entries" ? (opts.entries ?? [])
    : [{ kas_opening_balance: opts.openingBalance ?? null }];

  const make = (table: string) => {
    const failed = opts.failTable === table;
    const err = { message: `${table} unavailable` };
    // Every filter returns the same chainable; the terminal shapes are range() (paged reads)
    // and maybeSingle() (the profile).
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const m of ["select", "eq", "lte", "order"]) q[m] = self;
    q.range = (from: number, to: number) =>
      Promise.resolve(failed ? { data: null, error: err } : { data: rowsFor(table).slice(from, to + 1), error: null });
    q.maybeSingle = () =>
      Promise.resolve(failed ? { data: null, error: err } : { data: rowsFor(table)[0] ?? null, error: null });
    return q;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => make(table) } as any;
}

async function run() {
  const args = { ownerId: "u1", year: 2026, quarter: 1 };

  console.log("\n— the starting float is part of the verdict —");
  {
    // €500 in the till, €400 paid out on 5 Jan: healthy. Without the float it reads −€400.
    const entries = [{ entry_date: "2026-01-05", direction: "out", amount: 400, category: "kosten", description: null }];
    const withFloat = await loadDrawerWitness({ client: fakeClient({ entries, openingBalance: 500 }), ...args });
    check("float honoured → no negative day", withFloat.lowestPoint === null);
    check("opening balance carried through", withFloat.openingBalance === 500);

    const noFloat = await loadDrawerWitness({ client: fakeClient({ entries, openingBalance: 0 }), ...args });
    check("without the float the SAME drawer reads negative", noFloat.lowestPoint?.balance === -400);
  }

  console.log("\n— it sees the whole history, not just the quarter —");
  {
    // €900 taken in December (prior quarter) must open Q1; a €400 January payout is then fine.
    const turnover = [{ turnover_date: "2025-12-20", cash_amount: 900 }];
    const entries = [{ entry_date: "2026-01-05", direction: "out", amount: 400, category: "kosten", description: null }];
    const w = await loadDrawerWitness({ client: fakeClient({ turnover, entries, openingBalance: 0 }), ...args });
    check("prior-quarter takings carry into the opening balance", w.openingBalance === 900);
    check("…so the in-quarter payout is not a violation", w.lowestPoint === null);
  }

  console.log("\n— a real dip is caught even when the quarter closes positive —");
  {
    const entries = [
      { entry_date: "2026-02-10", direction: "out", amount: 300, category: "kosten", description: null },
      { entry_date: "2026-02-20", direction: "in", amount: 900, category: "omzet", description: null },
    ];
    const w = await loadDrawerWitness({ client: fakeClient({ entries, openingBalance: 100 }), ...args });
    check("the mid-quarter dip is the witness", w.lowestPoint?.date === "2026-02-10" && w.lowestPoint?.balance === -200);
  }

  console.log("\n— FAIL-CLOSED: an unreadable source is never a €0 answer —");
  {
    const entries = [{ entry_date: "2026-01-05", direction: "out", amount: 400, category: "kosten", description: null }];
    for (const table of ["profiles", "cash_entries", "daily_turnover"] as const) {
      let threw = false;
      try {
        await loadDrawerWitness({ client: fakeClient({ entries, openingBalance: 500, failTable: table }), ...args });
      } catch { threw = true; }
      // The profiles case is the one that used to pass silently — and it is the worst of the three,
      // because losing the float INVENTS a negative drawer rather than merely hiding one.
      check(`a failed ${table} read throws instead of guessing`, threw);
    }
  }

  console.log("\n— nothing booked at all —");
  {
    const w = await loadDrawerWitness({ client: fakeClient({ openingBalance: 0 }), ...args });
    check("empty drawer, no float → no negative day", w.lowestPoint === null && w.openingBalance === 0);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
run();
