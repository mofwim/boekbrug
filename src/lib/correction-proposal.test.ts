// [VOORSTEL] Run: npx tsx --test src/lib/correction-proposal.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProposal, isStale, isAlreadyApplied, isChangeList, proposalEndsOn, fieldsWritten, proposalPatchBody, type ProposableValues } from "./correction-proposal";

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

test("[VOORSTEL] naming one amount writes the trio, so the stale check watches all three — the 2-cent hole", () => {
  const v = buildProposal(now, { total_ex_btw: 111.01, btw_amount: 9.99, total_inc_btw: 121 });
  assert.ok(v.ok);
  assert.deepEqual(v.changes.map((c) => c.field), ["total_ex_btw", "btw_amount"], "the total itself did not change");
  assert.deepEqual(fieldsWritten(v.changes), ["total_ex_btw", "btw_amount", "total_inc_btw"]);
  assert.equal(isStale(now, { ...now, total_inc_btw: 121.01 }, v.changes), true,
    "a concurrent 1-cent move of the total — inside SUM_TOLERANCE, on a field the proposal did not name — is still a move");
  assert.equal(isStale(now, { ...now, due_date: "2026-09-15" }, v.changes), false, "a field the door will not write may move");
});

test("[VOORSTEL] an invoice already carrying the proposal is 'applied', never 'stale'", () => {
  const v = buildProposal(now, { total_ex_btw: 100, btw_amount: 9, total_inc_btw: 109, due_date: "" });
  assert.ok(v.ok);
  const after: ProposableValues = { ...now, btw_amount: 9, total_inc_btw: 109, due_date: null };
  assert.equal(isStale(now, after, v.changes), true, "it moved since the snapshot…");
  assert.equal(isAlreadyApplied(v.proposed, after, v.changes), true, "…because the door already applied it");
  assert.equal(isAlreadyApplied(v.proposed, { ...after, due_date: "2026-08-31" }, v.changes), false, "half-applied is not applied");
  assert.equal(isAlreadyApplied(v.proposed, now, v.changes), false);
  assert.equal(isAlreadyApplied(v.proposed, after, []), false, "no fields written → nothing can be applied");
});

test("[VOORSTEL] the creditnota sign rule runs when the proposal is built: what the card shows is what is stored", () => {
  const credit: ProposableValues = { ...now, total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 };
  // The accountant retypes the trio positive — a fresh keystroke loses the minus.
  const v = buildProposal(credit, { total_ex_btw: 100, btw_amount: 9, total_inc_btw: 109 }, { invoiceType: "creditnota" });
  assert.ok(v.ok);
  assert.deepEqual([v.proposed.total_ex_btw, v.proposed.btw_amount, v.proposed.total_inc_btw], [-100, -9, -109], "stored negative, like the door would");
  assert.deepEqual(v.changes.map((c) => [c.field, c.to]), [["btw_amount", -9], ["total_inc_btw", -109]], "the card shows the signed values");
  const same = buildProposal(credit, { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121 }, { invoiceType: "creditnota" });
  assert.ok(!same.ok && same.code === "nothing_changed", "retyping the same magnitudes positive changes nothing");
  // On a factuur a negative amount is not a sign slip to repair — it is a different document.
  const neg = buildProposal(now, { total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 }, { invoiceType: "factuur" });
  assert.ok(!neg.ok && neg.code === "negative_amounts");
  const negDefault = buildProposal(now, { total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 });
  assert.ok(!negDefault.ok && negDefault.code === "negative_amounts", "no type given reads as factuur");
});

test("[VOORSTEL] the door's terminal refusals end a proposal; a stored change list is validated", () => {
  assert.equal(proposalEndsOn("wrong_status"), true);
  assert.equal(proposalEndsOn("money_settled"), true);
  assert.equal(proposalEndsOn("verwerkt"), true);
  assert.equal(proposalEndsOn("sum_mismatch"), false, "an arithmetic refusal leaves it open for a second try");
  assert.equal(proposalEndsOn(undefined), false);
  assert.equal(isChangeList([{ field: "btw_amount", from: 1, to: 2 }]), true);
  assert.equal(isChangeList([{ field: "client_name", from: "a", to: "b" }]), false, "a field the door would not write");
  assert.equal(isChangeList("btw_amount"), false);
  assert.equal(isChangeList(null), false);
});
