// src/lib/intake-supplier.test.ts
// [LEVERANCIER-INTAKE] The order, the flags, and the promise never to throw.

import test from "node:test";
import assert from "node:assert/strict";
import { ibanChangeSafecore, mergeSafecore, resolveSupplierAtIntake } from "./intake-supplier";

test("[LEVERANCIER-INTAKE] a clean check says nothing, so nothing lands on the invoice", () => {
  // A REAL comparison: we held this supplier's number and it is the same one. The only case that
  // earns the tick, and the only one that may leave nothing behind.
  assert.deepEqual(ibanChangeSafecore({ status: "ok", change: null, firstSeen: false }), {});
});

test("[EERSTE-KEER] nothing to compare with is not the same as nothing changed", () => {
  // The first invoice from a supplier. Both cases used to leave here as {}, and an empty safecore
  // is read downstream as a completed comparison — so invoice-checks.ts printed a green tick and
  // "ongewijzigd ten opzichte van eerdere facturen" about earlier invoices that do not exist.
  // Measured on one account: 72 invoices, EUR 63,128.41, reassured at the one moment nothing in
  // the system could catch a misread digit or a redirected payment.
  assert.deepEqual(
    ibanChangeSafecore({ status: "ok", change: null, firstSeen: true }),
    { iban_first_seen: true },
    "a first sighting leaves nothing behind, so it reads as a comparison that happened",
  );

  // A CHANGE outranks it: both cannot be true, and the change is the sentence that matters.
  const changed = ibanChangeSafecore({
    status: "ok", firstSeen: true,
    change: { from: "NL91ABNA0417164300", to: "NL02RABO0123456789" },
  });
  assert.equal(changed.iban_changed, true);
  assert.equal(changed.iban_first_seen, undefined, "a first sighting must not dilute a real change");
});

test("[LEVERANCIER-INTAKE] a changed account number lands with both numbers", () => {
  const flags = ibanChangeSafecore({
    status: "ok", firstSeen: false,
    change: { from: "NL91ABNA0417164300", to: "NL02RABO0123456789" },
  });
  assert.equal(flags.iban_changed, true);
  assert.equal(flags.iban_changed_from, "NL91ABNA0417164300");
  assert.equal(flags.iban_changed_to, "NL02RABO0123456789");
});

test("[LEVERANCIER-INTAKE] a check that could not run says so — silence would read as clean", () => {
  assert.deepEqual(ibanChangeSafecore({ status: "unavailable" }), { iban_check_unavailable: true });
});

test("[LEVERANCIER-INTAKE] merging keeps the flags an earlier step already set", () => {
  const fc = { _safecore: { possible_duplicate: true, arithmetic_ok: false } };
  const merged = mergeSafecore(fc, { iban_changed: true });
  assert.equal(merged.possible_duplicate, true, "a duplicate flag decides whether a human looks");
  assert.equal(merged.arithmetic_ok, false);
  assert.equal(merged.iban_changed, true);
});

test("[LEVERANCIER-INTAKE] merging nothing returns what was already there, not an empty object", () => {
  const fc = { _safecore: { possible_duplicate: true } };
  assert.deepEqual(mergeSafecore(fc, {}), { possible_duplicate: true });
  assert.deepEqual(mergeSafecore({}, {}), {});
});

// ── The order, proved by watching it ────────────────────────────────────────────
//
// The registry is asked for the IBAN AFTER the check has already read it. Reverse the two and a
// forged number is compared against a row written from that same forged number, which always
// agrees — the failure this test exists to make impossible.

/**
 * A stand-in registry that records WHICH of the two steps touched it.
 *
 * The two are told apart by what they ask for: the IBAN check selects the single column `iban`
 * (knownIbanForVendor), while resolution selects the supplier's identity columns. Logging "a read
 * happened" would not separate them — and a test that cannot separate them passes with the two
 * steps in either order, which is the one thing this file must never allow.
 */
function fakeSupabase(log: string[]) {
  const maak = (tabel: string) => {
    let kolommen = "";
    const q: Record<string, unknown> = {
      select(cols: string) {
        kolommen = cols;
        return q;
      },
      eq: () => q,
      is: () => q,
      not: () => q,
      limit: () => q,
      order: () => q,
      maybeSingle: async () => {
        // [LES-TELT-MEE] Both steps now resolve the owner's own spelling→supplier lessons first,
        // and that read carries neither step's signature. Logged as its own thing rather than
        // guessed at: attributing it to "resolve" made this gate fail on correct code, and
        // attributing it to "check" would have made it pass on the code the gate exists to catch.
        if (tabel === "supplier_aliases") { log.push("alias"); return { data: null, error: null }; }
        log.push(kolommen.trim() === "iban" ? "check" : "resolve");
        return { data: null, error: null };
      },
      update() {
        log.push("write");
        return { eq: async () => ({ data: null, error: null }) };
      },
      insert() {
        log.push("write");
        return {
          select: () => ({ single: async () => ({ data: { id: "sup-new", name: "Hano" }, error: null }) }),
        };
      },
    };
    return q;
  };
  return { from: (tabel: string) => maak(tabel) };
}

test("[LEVERANCIER-INTAKE] the account number is checked BEFORE the registry is touched", async () => {
  const log: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await resolveSupplierAtIntake(fakeSupabase(log) as any, "user-1", {
    name: "Hano Groothandel",
    iban: "NL02RABO0123456789",
  });
  assert.ok(log.length > 0, "both steps must actually consult the registry, or this proves nothing");
  // The claim is about the SUPPLIERS table: an alias lookup reads a lesson the owner wrote down and
  // can neither create nor rename a supplier, so it cannot answer the check with its own work.
  const opLeveranciers = log.filter((s) => s !== "alias");
  assert.ok(opLeveranciers.length > 0, "no read reached the suppliers table — this proves nothing");
  assert.equal(opLeveranciers[0], "check",
    "the IBAN check must be the FIRST thing to touch the registry. Resolution may create a row " +
    "keyed on the very number under suspicion, and the check would then be answered by that row");
  assert.ok(!log.slice(0, log.indexOf("check") + 1).includes("write"),
    "nothing may be written before the check has run");
  assert.ok(log.includes("alias"),
    "the lesson the owner taught is not consulted at all — see [LES-TELT-MEE]");
});

test("[LEVERANCIER-INTAKE] an unreachable registry costs a supplier, never the invoice", async () => {
  const exploding = {
    from() {
      throw new Error("registry down");
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await resolveSupplierAtIntake(exploding as any, "user-1", {
    name: "Hano",
    iban: "NL02RABO0123456789",
  });
  assert.equal(out.supplierId, null, "no supplier, and the import continues");
  assert.equal(out.safecore.iban_check_unavailable, true,
    "…but the failed IBAN check is said out loud, because that one is not enrichment");
});
