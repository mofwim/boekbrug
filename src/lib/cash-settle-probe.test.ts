// [KAS-PROBE] The one read that decides whether a destructive pass runs in its safe model.
// Run: npx tsx --test src/lib/cash-settle-probe.test.ts
//
// cashInstalmentsSupported answers "does cash_entries carry settlement_id?". It looks like a
// deployment detail and is not one: a NO switches the whole reconcile into the pre-instalment
// model, where `existing` is read WITHOUT settlement_id — so every drawer entry of one invoice
// keys to the same AGGREGATE_KEY, the first survives and is healed to the aggregate amount and
// date, and every other one is hard-deleted as a duplicate.
//
// Until now ANY error produced that NO: a statement timeout, a pooler at its ceiling, a dropped
// connection and a genuinely absent column all arrive through the same `error` channel. The column
// exists in production, so the deploy window this guard was written for has closed and every
// remaining NO it could return is a wrong one.
//
// Two things are pinned here, and they are different in kind:
//   · what a wrong NO COSTS — pure, exact, and the reason any of this matters;
//   · that the probe now only says NO to an absent column.

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeCashSettlementSync, type SettleableInvoice, type ExistingSettlement } from "./cash";
import { cashInstalmentsSupported } from "./cash-settle";

// ── What a wrong NO costs, in the pure engine ───────────────────────────────

// One invoice, three till handovers on three days — the shape the per-instalment model exists for.
const THREE_HANDOVERS: SettleableInvoice = {
  id: "inv-1",
  direction: "incoming",
  total_inc_btw: 300,
  payment_date: "2026-07-14",
  invoice_number: "F-1",
  client_name: "Leverancier",
  cash_instalments: [
    { id: "t1", amount: 100, paid_on: "2026-06-28" },
    { id: "t2", amount: 100, paid_on: "2026-07-01" },
    { id: "t3", amount: 100, paid_on: "2026-07-14" },
  ],
} as unknown as SettleableInvoice;

/** The same invoice as the degraded read sees it: no instalments, dated by the LAST handover. */
const AS_DEGRADED: SettleableInvoice = {
  ...THREE_HANDOVERS,
  cash_instalments: undefined,
  payment_date: "2026-07-14",
} as unknown as SettleableInvoice;

/** The three entries that are really in the drawer, one per handover. */
const REAL_ENTRIES: ExistingSettlement[] = [
  { id: "e1", invoice_id: "inv-1", settlement_id: "t1", amount: 100, entry_date: "2026-06-28", direction: "out" },
  { id: "e2", invoice_id: "inv-1", settlement_id: "t2", amount: 100, entry_date: "2026-07-01", direction: "out" },
  { id: "e3", invoice_id: "inv-1", settlement_id: "t3", amount: 100, entry_date: "2026-07-14", direction: "out" },
];

test("[KAS-PROBE] with the column, three handovers are three entries and nothing is touched", () => {
  const { toCreate, toUpdate, toDeleteIds } = computeCashSettlementSync([THREE_HANDOVERS], REAL_ENTRIES);
  assert.deepEqual(toCreate, [], "an entry was created for a handover that already has one");
  assert.deepEqual(toUpdate, [], "a correct entry was healed");
  assert.deepEqual(toDeleteIds, [], "a real cash movement was deleted");
});

test("[KAS-PROBE] a wrong NO deletes two real cash movements and re-dates the third", () => {
  // This is the whole cost, stated once. The degraded read strips settlement_id from every row —
  // that is not a hypothetical, it is literally the other branch of the select — so the engine
  // sees three entries claiming to be the same aggregate.
  const blind = REAL_ENTRIES.map((e) => ({ ...e, settlement_id: undefined }));
  const { toUpdate, toDeleteIds } = computeCashSettlementSync([AS_DEGRADED], blind);

  assert.equal(toDeleteIds.length, 2, "two of the three handovers should be marked for deletion");
  assert.deepEqual(toDeleteIds.sort(), ["e2", "e3"], "a different pair was condemned than expected");

  // And the survivor does not merely stay: it is healed to the full €300 on the LAST handover's
  // day. The €100 that moved on 28 June leaves the drawer's June and reappears in July — which,
  // for an owner whose quarter ends on 30 June, is a BTW period.
  assert.equal(toUpdate.length, 1);
  assert.equal(toUpdate[0].id, "e1");
  assert.equal(toUpdate[0].row.amount, 300, "the survivor was not inflated to the aggregate");
  assert.equal(toUpdate[0].row.entry_date, "2026-07-14", "the survivor was not re-dated onto the last handover");
});

// ── That the probe only says NO to an absent column ─────────────────────────

/** The two calls the probe makes, and nothing else: .from(…).select(…).limit(1). */
function clientAnswering(answer: { error: { code?: string; message: string } | null } | Error) {
  return {
    from: () => ({
      select: () => ({
        limit: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ORDER MATTERS in this file. cashInstalmentsSupported caches a YES for the life of the process
// (deliberately — see the module), so the success case runs LAST. A test added above it that
// succeeds would make every assertion below it vacuous.

test("[KAS-PROBE] an absent column is still an absent column — by SQLSTATE", () => {
  // The case the fallback was written for, and the only one that may still reach it: a build
  // deployed ahead of cash_settlement_per_instalment.sql.
  return cashInstalmentsSupported(
    clientAnswering({ error: { code: "42703", message: 'column cash_entries.settlement_id does not exist' } }),
  ).then((ok) => assert.equal(ok, false, "a genuinely missing column no longer falls back"));
});

test("[KAS-PROBE] …and by what PostgREST says when the code is not 42703", () => {
  return Promise.all([
    cashInstalmentsSupported(clientAnswering({ error: { code: "PGRST204", message: "unhelpful" } })),
    cashInstalmentsSupported(clientAnswering({ error: { message: "column cash_entries.settlement_id does not exist" } })),
    cashInstalmentsSupported(clientAnswering({ error: { message: "Could not find the 'settlement_id' column of 'cash_entries' in the schema cache" } })),
  ]).then((answers) => assert.deepEqual(answers, [false, false, false], "an absent column was read as present"));
});

test("[KAS-PROBE] a failed read is NOT evidence that the column is gone", () => {
  // Every one of these used to return false and take the drawer apart. They are all the database
  // being unwell, which says nothing whatsoever about the schema.
  const transient = [
    { code: "57014", message: "canceling statement due to statement timeout" },
    { code: "53300", message: "remaining connection slots are reserved" },
    { code: "42501", message: "permission denied for table cash_entries" },
    { code: "PGRST301", message: "JWT expired" },
    { message: "TypeError: fetch failed" },
    { message: "" },
  ];
  return Promise.all(transient.map((error) => cashInstalmentsSupported(clientAnswering({ error }))))
    .then((answers) => {
      for (let i = 0; i < answers.length; i++) {
        assert.equal(answers[i], true, `"${transient[i].message}" was read as an absent column`);
      }
    });
});

test("[KAS-PROBE] a thrown read is the same class, not a schema answer", () => {
  return cashInstalmentsSupported(clientAnswering(new Error("socket hang up")))
    .then((ok) => assert.equal(ok, true, "a network failure was read as an absent column"));
});

test("[KAS-PROBE] and a clean read still says yes (runs last: this one caches)", () => {
  return cashInstalmentsSupported(clientAnswering({ error: null }))
    .then((ok) => assert.equal(ok, true));
});
