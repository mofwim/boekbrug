// [KASSA-VERS] Pure node test — run: npx tsx --test src/lib/till-book.test.ts
//
// rebuildTillDay reads a day's sales and then writes an ABSOLUTE total for that day. Between those
// two steps another request can ring up a ticket, and the write then lands with a total that was
// true a moment ago. The day's omzet is understated by a whole ticket — and so is the btw over it,
// into rubriek 1a/1b of the aangifte — while nothing looks wrong: the row exists, its arithmetic
// checks out, and the kassa screen reads its ticket list from till_sales, so it still shows both.
//
// The property under test is convergence, not locking. A rebuild is idempotent, so re-reading the
// day after writing it and running again on what is actually there is the correct repair.

import { test } from "node:test";
import assert from "node:assert/strict";

import { rebuildTillDay, salesFingerprint, REBUILD_MAX_ATTEMPTS, TILL_SOURCE } from "./till-book";

type Sale = {
  id: string; ticket_id: string; sale_date: string; description: string;
  quantity: number; unit_price_incl: number; btw_rate: number; method: string;
  article_id: string | null; created_at: string | null;
};

const sale = (id: string, price: number): Sale => ({
  id, ticket_id: `t-${id}`, sale_date: "2026-08-31", description: `artikel ${id}`,
  quantity: 1, unit_price_incl: price, btw_rate: 21, method: "cash",
  article_id: null, created_at: `2026-08-31T10:00:0${id}.000Z`,
});

/**
 * A supabase stand-in for one day.
 *
 * `onRead` fires immediately AFTER each till_sales read has taken its snapshot, and may mutate the
 * day — that is how "the other cashier's ticket commits just after we read" is expressed without
 * threads. The order matters: firing it BEFORE the snapshot puts the new sale inside the very read
 * it is supposed to arrive after, and the test then proves nothing about the race. It did that
 * first, and passed.
 *
 * Every daily_turnover write is recorded so the test can see WHICH total was the last one to land,
 * which is the whole question.
 */
function fakeDb(initial: Sale[], onRead?: (readNo: number, db: { sales: Sale[] }) => void) {
  const db = { sales: [...initial] };
  const writes: Array<{ kind: "upsert" | "delete"; total: number | null }> = [];
  let reads = 0;

  const client = {
    from(table: string) {
      if (table === "till_sales") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      order() {
                        return {
                          range() {
                            reads += 1;
                            const snapshot = [...db.sales];
                            onRead?.(reads, db);
                            return Promise.resolve({ data: snapshot, error: null });
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "daily_turnover") {
        return {
          // the source pre-check
          select() {
            return { eq() { return { eq() { return { maybeSingle: () => Promise.resolve({ data: null, error: null }) }; } }; } };
          },
          delete() {
            return { eq() { return { eq() { return { eq() { writes.push({ kind: "delete", total: null }); return Promise.resolve({ error: null }); } }; } }; } };
          },
          // bookTurnoverRows upserts through this
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          upsert(rows: any[]) {
            writes.push({ kind: "upsert", total: Number(rows[0]?.total_incl ?? 0) });
            return { select: () => Promise.resolve({ data: rows, error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, db, writes, readCount: () => reads };
}

test("salesFingerprint is about WHICH sales, not how many", () => {
  // A ticket rung up and another voided in the same instant leaves the count identical while the
  // day is a different day. A count-based check would call that unchanged.
  assert.notEqual(salesFingerprint([sale("1", 10)]), salesFingerprint([sale("2", 10)]));
  // Order must not matter: the read is sorted by created_at, and two sales can share a timestamp.
  assert.equal(
    salesFingerprint([sale("1", 10), sale("2", 5)]),
    salesFingerprint([sale("2", 5), sale("1", 10)]),
  );
  assert.equal(salesFingerprint([]), "");
});

test("a quiet day is written once and read back once — no extra rebuilds", async () => {
  const f = fakeDb([sale("1", 12.1)]);
  const r = await rebuildTillDay(f.client as never, "user-1", "2026-08-31");
  assert.equal(r.ok, true);
  assert.equal(f.writes.length, 1, "an unchanged day must not be rebuilt twice");
  assert.equal(f.readCount(), 2, "one read to compute, one to confirm");
});

test("[KASSA-VERS] a ticket rung up mid-rebuild is not lost from the day's turnover", async () => {
  // The interleaving from the module comment, expressed as: the day gains a sale between the
  // compute-read and the confirm-read. Before the loop, the last write was the stale one.
  const f = fakeDb([sale("1", 100)], (readNo, db) => {
    // Right after the compute-read took its snapshot, the other cashier's ticket commits.
    if (readNo === 1) db.sales.push(sale("2", 21));
  });

  const r = await rebuildTillDay(f.client as never, "user-1", "2026-08-31");
  assert.equal(r.ok, true);
  const lastTotal = [...f.writes].reverse().find((w) => w.kind === "upsert")?.total;
  assert.equal(lastTotal, 121, "the last total written must include the ticket that arrived mid-rebuild");
  assert.equal(r.total_incl, 121, "and the caller must be told the total that is actually stored");
  assert.equal(r.sales.length, 2);
});

test("[KASSA-VERS] the DELETE branch is verified too", async () => {
  // "The day is empty, remove the row" is the same race with the sign flipped: a ticket rung up
  // between the read and the delete leaves a sale with no turnover row at all.
  const f = fakeDb([], (readNo, db) => {
    if (readNo === 1) db.sales.push(sale("9", 50));
  });
  const r = await rebuildTillDay(f.client as never, "user-1", "2026-08-31");
  assert.equal(r.ok, true);
  assert.equal(f.writes[0].kind, "delete", "the first pass genuinely saw an empty day");
  const lastTotal = [...f.writes].reverse().find((w) => w.kind === "upsert")?.total;
  assert.equal(lastTotal, 50, "the sale that arrived must end up booked, not deleted away");
});

test("[KASSA-VERS] a day that never settles is bounded, and the attempts are spent", async () => {
  // A till that keeps changing is a busy shop, not a bug — but the loop must not run forever, and
  // the last write may then be stale. Bounded here; reported in the module.
  let n = 0;
  const f = fakeDb([sale("1", 10)], (_readNo, db) => {
    n += 1;
    db.sales.push(sale(`x${n}`, 1));
  });
  const r = await rebuildTillDay(f.client as never, "user-1", "2026-08-31");
  assert.equal(r.ok, true, "the owner still gets his day back, with what was last written");
  assert.equal(
    f.writes.length, REBUILD_MAX_ATTEMPTS,
    `a never-settling day must stop after ${REBUILD_MAX_ATTEMPTS} attempts, not spin`,
  );
});

test("an imported Z-report is still never overwritten by hand-rung figures", async () => {
  // The pre-existing guard, kept honest while the loop was added around it: the source check runs
  // BEFORE any read of the sales, so a day owned by an import writes nothing at all.
  const client = {
    from(table: string) {
      if (table === "daily_turnover") {
        return {
          select() {
            return { eq() { return { eq() { return { maybeSingle: () => Promise.resolve({ data: { source: "ai" }, error: null }) }; } }; } };
          },
        };
      }
      throw new Error(`must not touch ${table} once the day belongs to an import`);
    },
  };
  const r = await rebuildTillDay(client as never, "user-1", "2026-08-31");
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /ingelezen kassa-rapport/);
  assert.equal(TILL_SOURCE, "manual");
});
