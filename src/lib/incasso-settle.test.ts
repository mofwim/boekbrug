// [AUTO-INCASSO] The two pure decisions in incasso-settle, under test at last.
// Run: npx tsx --test src/lib/incasso-settle.test.ts
//
// docs/MONEY_PATH_AUDIT_2026-08.md §6 item 4 names this file and cash-settle.ts as the largest
// money-carrying surface with no behavioural test — 829 lines between them. The I/O halves need a
// database to exercise; these two functions do not, and they are the two that decide MONEY:
//
//   belongsToIncassoSupplier  decides whether an invoice is auto-booked as paid at all. A wrong
//                             match books an invoice nobody paid.
//   incassoClientKey          is the idempotency lock. If it is not stable, the hourly cron and
//                             the owner flipping the switch in the same second book twice.
//
// Both are pure, so the excuse for leaving them untested was never a good one.

import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import path from "node:path";

import { belongsToIncassoSupplier, incassoClientKey, isExpectedBookingRefusal, type IncassoSupplier } from "./incasso-settle";

const marked = (id: string, name: string, nameKey: string | null): IncassoSupplier => ({ id, name, nameKey });

// ── incassoClientKey ────────────────────────────────────────────────────────

test("[AUTO-INCASSO] the same booking always produces the same key", () => {
  // The whole point: a re-run must collide with itself so the RPC reports "already booked"
  // instead of paying the invoice a second time.
  assert.equal(
    incassoClientKey("inv-1", "2026-08-28"),
    incassoClientKey("inv-1", "2026-08-28"),
  );
});

test("[AUTO-INCASSO] a different invoice or a different date is a different key", () => {
  const base = incassoClientKey("inv-1", "2026-08-28");
  assert.notEqual(base, incassoClientKey("inv-2", "2026-08-28"), "two invoices share one key");
  assert.notEqual(base, incassoClientKey("inv-1", "2026-08-29"), "two dates share one key");
});

test("[AUTO-INCASSO] the key is a syntactically valid uuid", () => {
  // Not cosmetic. The header says it plainly: "the RPC's parameter is a uuid and the route
  // validates the shape". Change the slicing by one character and EVERY automatic collection
  // fails at the door — silently, from a cron, for every owner at once.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const [inv, day] of [["inv-1", "2026-08-28"], ["x", "2026-01-01"], ["", ""]]) {
    assert.match(incassoClientKey(inv, day), uuid, `not a uuid for (${inv}, ${day})`);
  }
});

test("[AUTO-INCASSO] the key carries the version and variant nibbles a v5 uuid needs", () => {
  // The code shapes it "as a v5-style uuid" on purpose, skipping two hash characters to make room
  // for these. A stricter uuid validator than the current one would reject the key without them.
  const key = incassoClientKey("inv-1", "2026-08-28");
  assert.equal(key[14], "5", "version nibble is not 5");
  assert.equal(key[19], "a", "variant nibble is not a");
});

// ── belongsToIncassoSupplier ────────────────────────────────────────────────

test("[AUTO-INCASSO] nobody marked means nothing is ever booked", () => {
  // The guard that makes "this owner marked nobody" safe. readIncassoSuppliers throws rather than
  // returning [] on a failed read precisely so an empty list can be trusted to mean this.
  assert.equal(belongsToIncassoSupplier({ client_name: "Eneco", supplier_id: "s1" }, []), null);
});

test("[AUTO-INCASSO] a linked supplier is matched by id, not by its name", () => {
  const suppliers = [marked("s1", "Eneco", "eneco")];
  const hit = belongsToIncassoSupplier({ supplier_id: "s1", client_name: "totally different" }, suppliers);
  assert.equal(hit?.id, "s1", "the supplier_id link was ignored");
});

test("[AUTO-INCASSO] the id wins over a name that points at another supplier", () => {
  // Precedence matters for money: the id is the explicit link a human or the registry made, the
  // name is a guess. If the name won, an invoice would be booked against the wrong supplier.
  const suppliers = [marked("s1", "Eneco", "eneco"), marked("s2", "Vattenfall", "vattenfall")];
  const hit = belongsToIncassoSupplier({ supplier_id: "s2", client_name: "Eneco" }, suppliers);
  assert.equal(hit?.id, "s2", "the name key beat the explicit supplier_id link");
});

test("[AUTO-INCASSO] an unmarked supplier_id falls through to the name key", () => {
  // CURRENT BEHAVIOUR, pinned deliberately rather than blessed. The invoice is linked to a
  // supplier the owner did NOT mark, yet it can still be booked when its client_name keys to one
  // that IS marked.
  //
  // It is defensible: supplier-registry merges suppliers BY name key, so two rows carrying the
  // same key are the thing that registry exists to prevent, and the fall-through is what lets a
  // freshly-linked invoice still match the supplier the owner marked under the old row.
  //
  // It is also the shape a real mis-booking would take. This test exists so that if the
  // precedence is ever tightened to "an explicit link to an unmarked supplier means no", that is
  // a decision someone makes on purpose and not a silent change to who gets paid.
  const suppliers = [marked("s_marked", "Eneco", "eneco")];
  const hit = belongsToIncassoSupplier({ supplier_id: "s_unmarked", client_name: "Eneco" }, suppliers);
  assert.equal(hit?.id, "s_marked", "the fall-through to the name key changed");
});

test("[AUTO-INCASSO] no name and no usable link books nothing", () => {
  const suppliers = [marked("s1", "Eneco", "eneco")];
  for (const inv of [
    { client_name: null, supplier_id: null },
    { client_name: undefined, supplier_id: undefined },
    { client_name: "", supplier_id: null },
    { client_name: "   ", supplier_id: null },
  ]) {
    assert.equal(belongsToIncassoSupplier(inv, suppliers), null, `booked on ${JSON.stringify(inv)}`);
  }
});

test("[AUTO-INCASSO] a supplier with no name key never matches by name", () => {
  // nameKey is nullable. A null key must not collide with an invoice whose own key is null —
  // that would match every unnamed invoice to the first keyless supplier.
  const suppliers = [marked("s1", "Eneco", null)];
  assert.equal(belongsToIncassoSupplier({ client_name: null, supplier_id: null }, suppliers), null);
  assert.equal(belongsToIncassoSupplier({ client_name: "Eneco", supplier_id: null }, suppliers), null);
});

test("[AUTO-INCASSO] an unrelated invoice is left alone", () => {
  const suppliers = [marked("s1", "Eneco", "eneco")];
  assert.equal(belongsToIncassoSupplier({ client_name: "Albert Heijn", supplier_id: null }, suppliers), null);
});

// ── [AUTO-INCASSO] Which booking refusals are worth waking somebody for ──────
//
// A third decision, and the one with the longest reach: it does not change a euro by itself, it
// changes whether anyone HEARS about a euro. The strings it matches on live in SQL, in another
// file, so the test reads them from there — a reworded message must fail here rather than quietly
// flip an hourly race into an error, or a real failure into silence.

/**
 * Every refusal apply_manual_payment can raise, read per DEFINING FILE.
 *
 * Two migrations define this function — the original and the idempotency-scope rewrite — and both
 * carry the whole set of messages. Unioning them was the first thing this test did and it was
 * wrong: reword a refusal in the live definition and the superseded file still carries the old
 * spelling, so the check passed while the predicate had stopped matching anything real. A
 * mutation run is what found that; it is not a hypothetical.
 *
 * So the messages are read per file and required in ALL of them. Two spellings of one refusal
 * drifting apart is the same defect from the other side.
 */
const RPC_FILES = ["invoice_manual_payments.sql", "invoice_manual_payment_idempotency_scope.sql"];

function rpcRefusalsByFile(): Array<{ file: string; messages: string[] }> {
  return RPC_FILES.map((file) => {
    const sql = readFileSync(path.join(process.cwd(), "supabase", "migrations", file), "utf-8");
    const messages = [...sql.matchAll(/RAISE EXCEPTION '(\[MANUAL-PARTIAL-PAY\][^']*)'/g)].map((m) => m[1]);
    assert.ok(messages.length > 0, `${file} no longer defines apply_manual_payment's refusals`);
    return { file, messages };
  });
}

/** The union, for asking "could the RPC ever say this?" */
function rpcRefusals(): string[] {
  return [...new Set(rpcRefusalsByFile().flatMap((f) => f.messages))];
}

test("[AUTO-INCASSO] the refusals the RPC is right to make stay out of the log", () => {
  // Four states in which the invoice simply stays open and visible — the safe side of each. An
  // hourly cron logging these buries the ones that mean something.
  const expected = [
    "[MANUAL-PARTIAL-PAY] invoice already fully paid",
    "[MANUAL-PARTIAL-PAY] invoice already covered",
    "[MANUAL-PARTIAL-PAY] invoice locked by accountant (verwerkt)",
    "[MANUAL-PARTIAL-PAY] invoice status received is not payable",
  ];
  const byFile = rpcRefusalsByFile();
  for (const msg of expected) {
    assert.ok(isExpectedBookingRefusal(msg), `"${msg}" is now logged as a failure every hour`);
    // …and it is still a message the RPC can actually produce, in EVERY file that defines it. A
    // pattern kept alive for a refusal that no longer exists is how this predicate would rot
    // without anything failing.
    for (const { file, messages } of byFile) {
      assert.ok(
        messages.some((r) => r.replace(/%/g, "received") === msg),
        `${file} no longer raises "${msg}" — this pattern is matching nothing there`,
      );
    }
  }
});

test("[AUTO-INCASSO] every OTHER refusal the RPC can raise is shouted about", () => {
  // The sharpest one is the idempotency key belonging to a different booking: that is the
  // double-booking guard firing, on the pass that books payments nobody typed. Swallowing it
  // would hide the exact failure this module is most dangerous for.
  const benign = /already|verwerkt|not payable/i;
  for (const raw of rpcRefusals()) {
    const msg = raw.replace(/%/g, "received");
    if (benign.test(msg)) continue;
    assert.equal(isExpectedBookingRefusal(msg), false, `"${msg}" is now swallowed — nobody will hear it`);
  }
  // Named explicitly, so the guard has a test that fails by name rather than only in a loop.
  assert.equal(isExpectedBookingRefusal("[MANUAL-PARTIAL-PAY] idempotency key belongs to a different booking"), false);
  assert.equal(isExpectedBookingRefusal("[MANUAL-PARTIAL-PAY] invoice not found / not owned"), false);
  assert.equal(isExpectedBookingRefusal("[MANUAL-PARTIAL-PAY] invoice has no total to settle"), false);
});

test("[AUTO-INCASSO] a missing message is not evidence that a refusal was harmless", () => {
  // An error with no message at all is the least understood case there is, and defaulting it to
  // "expected" would silence exactly the failures nobody has seen before.
  for (const empty of [null, undefined, ""]) {
    assert.equal(isExpectedBookingRefusal(empty), false);
  }
});
