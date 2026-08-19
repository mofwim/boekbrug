// [WACHTRIJ-VERS] Pure node test — run: npx tsx --test src/lib/queue-sync.test.ts
//
// The invariant is a pair, and only the pair is safe:
//   · CONTENT must travel, or a corrected amount never reaches the card the owner reviews;
//   · MEMBERSHIP must not, or a refresh landing inside an optimistic removal puts a confirmed
//     invoice back in the queue.
// Every test below is one half of that pair.

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyServerRefresh } from "./queue-sync";

interface Row {
  id: string;
  total_inc_btw: number;
  client_name?: string;
}

const row = (id: string, total: number, client_name = "Groothandel"): Row => ({ id, total_inc_btw: total, client_name });

test("[WACHTRIJ-VERS] a corrected amount reaches the row the screen is holding", () => {
  // The case that made this exist: "Opnieuw inlezen" fixed 1078.46 → 1087.46 on the server, and
  // the card kept showing the old number because useState had already taken its initial value.
  const held = [row("a", 1078.46), row("b", 872)];
  const fromServer = [row("a", 1087.46), row("b", 872)];
  const next = applyServerRefresh(held, fromServer);
  assert.equal(next.length, 2);
  assert.equal(next[0].total_inc_btw, 1087.46, "the correction arrived");
  assert.equal(next[1].total_inc_btw, 872, "and the untouched row is untouched");
});

test("[WACHTRIJ-VERS] a refresh cannot resurrect an optimistically removed invoice", () => {
  // The confirm removed 'b' from the list; the server had not written it yet, so the refresh still
  // carries it. Putting it back would show a confirmed invoice as still waiting — and an invoice
  // confirmed twice is the harm this asymmetry exists to prevent.
  const held = [row("a", 100)];
  const fromServer = [row("a", 100), row("b", 872)];
  const next = applyServerRefresh(held, fromServer);
  assert.deepEqual(next.map((r) => r.id), ["a"], "membership belongs to the screen");
});

test("[WACHTRIJ-VERS] a row the server no longer has is left alone, not dropped", () => {
  // Mirror image: the screen re-added a row after a failed confirm, or holds one the server's
  // window has moved past. Removing it here would make a refresh do the thing the test above
  // forbids, in the other direction.
  const held = [row("a", 100), row("b", 872)];
  const next = applyServerRefresh(held, [row("a", 100)]);
  assert.deepEqual(next.map((r) => r.id), ["a", "b"]);
  assert.equal(next[1].total_inc_btw, 872);
});

test("[WACHTRIJ-VERS] the screen's order survives the refresh", () => {
  // The server sorts by invoice_date; the screen may be showing the result of an optimistic
  // re-add, which puts a row at the front. Reordering under a reading finger is its own defect.
  const held = [row("b", 872), row("a", 100)];
  const next = applyServerRefresh(held, [row("a", 101), row("b", 873)]);
  assert.deepEqual(next.map((r) => r.id), ["b", "a"], "order is the screen's");
  assert.deepEqual(next.map((r) => r.total_inc_btw), [873, 101], "content is the server's");
});

test("[WACHTRIJ-VERS] an unchanged refresh returns the SAME array", () => {
  // Not cosmetic. This runs on every router.refresh(), and a new array identity re-renders the
  // whole queue and re-runs every effect keyed on the list — for a refresh that changed nothing.
  const held = [row("a", 100), row("b", 872)];
  const same = applyServerRefresh(held, held);
  assert.equal(same, held, "identical input gives identical output, by reference");
  // …and the same holds when the server sends equal-but-not-identical rows for OTHER ids only.
  const untouched = applyServerRefresh(held, [row("c", 5)]);
  assert.equal(untouched, held);
});

test("[WACHTRIJ-VERS] an empty screen stays empty, whatever the server sends", () => {
  // "Alles verwerkt" is a state the queue reaches by confirming everything. A refresh that filled
  // it back up from a server render taken a second earlier would undo the owner's whole session.
  assert.deepEqual(applyServerRefresh([], [row("a", 100), row("b", 872)]), []);
});

test("[WACHTRIJ-VERS] a duplicated id in the payload is resolved the same way every time", () => {
  // PostgREST windows can repeat a row across pages. Last-wins would make the result depend on
  // pagination, which is how two identical refreshes come back with different money on the screen.
  const held = [row("a", 0)];
  const next = applyServerRefresh(held, [row("a", 100), row("a", 999)]);
  assert.equal(next[0].total_inc_btw, 100, "first occurrence wins, deterministically");
});

test("[WACHTRIJ-VERS] a row without a usable id cannot displace a real one", () => {
  // Defensive rather than observed: the payload crosses a server boundary, and a row whose id did
  // not survive the trip must be ignored instead of matching `undefined` against a real row.
  const held = [row("a", 100)];
  const junk = [{ id: undefined as unknown as string, total_inc_btw: 9 }, row("a", 250)];
  const next = applyServerRefresh(held, junk as Row[]);
  assert.equal(next[0].total_inc_btw, 250);
});
