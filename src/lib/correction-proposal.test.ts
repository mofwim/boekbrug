// [VOORSTEL] Run: npx tsx --test src/lib/correction-proposal.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProposal, isStale, proposalPatchBody, type ProposableValues } from "./correction-proposal";

const now: ProposableValues = { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121, invoice_date: "2026-08-01", due_date: "2026-08-31" };

test("[VOORSTEL] a changed btw split is a proposal with exactly the changed fields", () => {
  const v = buildProposal(now, { total_ex_btw: 111.01, btw_amount: 9.99, total_inc_btw: 121 });
  assert.ok(v.ok);
  assert.deepEqual(v.changes.map((c) => c.field), ["total_ex_btw", "btw_amount"]);
  assert.equal(v.proposed.total_inc_btw, 121);
  assert.equal(v.proposed.invoice_date, "2026-08-01", "untouched fields carry the current value");
});

test("[VOORSTEL] the client's door's arithmetic is enforced before the client ever sees it", () => {
  assert.equal(buildProposal(now, { total_ex_btw: 100 }).ok, false, "a partial trio");
  const sum = buildProposal(now, { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130 });
  assert.ok(!sum.ok && sum.code === "sum_mismatch");
  const base = buildProposal(now, { total_ex_btw: 0, btw_amount: 5, total_inc_btw: 5 });
  assert.ok(!base.ok && base.code === "no_base");
  const rate = buildProposal(now, { total_ex_btw: 100, btw_amount: 30, total_inc_btw: 130 });
  assert.ok(!rate.ok && rate.code === "impossible_rate");
  const date = buildProposal(now, { invoice_date: "01-08-2026" });
  assert.ok(!date.ok && date.code === "bad_date");
  const same = buildProposal(now, { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121 });
  assert.ok(!same.ok && same.code === "nothing_changed");
});

test("[VOORSTEL] a cleared due date is a change, and travels as the door's own spelling", () => {
  const v = buildProposal(now, { due_date: "" });
  assert.ok(v.ok);
  assert.deepEqual(v.changes, [{ field: "due_date", from: "2026-08-31", to: null }]);
  assert.deepEqual(proposalPatchBody(v.proposed, v.changes), { due_date: "" });
  const w = buildProposal(now, { invoice_date: "2026-07-31", total_ex_btw: 100, btw_amount: 9, total_inc_btw: 109 });
  assert.ok(w.ok);
  assert.deepEqual(proposalPatchBody(w.proposed, w.changes), { total_ex_btw: 100, btw_amount: 9, total_inc_btw: 109, invoice_date: "2026-07-31" });
});

test("[VOORSTEL] a proposal is stale the moment the invoice moved underneath it — on the fields it names", () => {
  const v = buildProposal(now, { total_ex_btw: 100, btw_amount: 9, total_inc_btw: 109 });
  assert.ok(v.ok);
  assert.equal(isStale(now, now, v.changes), false);
  assert.equal(isStale(now, { ...now, btw_amount: 20 }, v.changes), true, "someone changed the btw meanwhile");
  assert.equal(isStale(now, { ...now, due_date: "2026-09-15" }, v.changes), false, "a field the proposal does not name may move");
});
