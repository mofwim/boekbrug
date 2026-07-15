// [BOEK-016] Pure node test for bank-import.ts — run: npx tsx bank-import.test.ts
import type { BankTransaction } from "./src/lib/bank-parser";
import {
  contentKey,
  dedupTransactions,
  mapToRows,
  dateRange,
  rowToTransaction,
  type ExistingTxKey,
} from "./src/lib/bank-import";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

function tx(p: Partial<BankTransaction>): BankTransaction {
  return {
    date: "2026-02-10", amount: 4.0, currency: "EUR", description: "Koffie",
    counterpartName: "Cafe X", counterpartIban: null, reference: null,
    transactionId: null, rawLine: "", ...p,
  };
}
function rowFromTx(t: BankTransaction): ExistingTxKey {
  return {
    date: t.date, amount: t.amount, description: t.description,
    counterpart_name: t.counterpartName, reference: t.reference,
  };
}

console.log("\n— contentKey (date, amount, counterpart, reference) —");
check("same content → same key (norm: trim/case/space)",
  contentKey("2026-02-10", 4, "Cafe X", "REF1") ===
  contentKey("2026-02-10", 4, "  cafe x ", "ref1"));
check("different amount → different key",
  contentKey("2026-02-10", 4, "Cafe X", null) !==
  contentKey("2026-02-10", 5, "Cafe X", null));
check("amount precision normalized (4 vs 4.00)",
  contentKey("2026-02-10", 4, "x", null) ===
  contentKey("2026-02-10", 4.0, "x", null));

console.log("\n— contentKey: format-stable counterpart (finding #1 fix) —");
// [BANK-DEDUP-CSV] The same real payment exported two ways: MT940 derives
// "Jansen Bouw B.V." from the REMI, the CSV reads "Jansen Bouw BV" from a column.
// Same date + amount + reference → must be ONE transaction, not two.
check("legal-form/punctuation variants share a key (B.V. == BV)",
  contentKey("2026-02-10", -1210, "Jansen Bouw B.V.", "29528") ===
  contentKey("2026-02-10", -1210, "Jansen Bouw BV", "29528"));
check("diacritics ignored (Café == Cafe)",
  contentKey("2026-02-10", 4, "Café Zürich", null) ===
  contentKey("2026-02-10", 4, "Cafe Zurich", null));
// SAFETY: digits are KEPT — two genuinely different same-day, same-amount,
// reference-less stores must stay DISTINCT so dedup never DROPS a real tx.
check("distinct numbered stores stay distinct (Shell 123 ≠ Shell 456)",
  contentKey("2026-02-10", -50, "Shell 123", null) !==
  contentKey("2026-02-10", -50, "Shell 456", null));

console.log("\n— dateRange —");
{
  const r = dateRange([tx({ date: "2026-02-10" }), tx({ date: "2026-01-05" }), tx({ date: "2026-03-01" })]);
  check("min/max correct", r.min === "2026-01-05" && r.max === "2026-03-01");
}

console.log("\n— dedup (multiset) —");
// 1. First upload — nothing existing → insert all (incl. legit in-file duplicates)
{
  const incoming = [tx({}), tx({}), tx({ description: "Huur", amount: -800, counterpartName: "Verhuur BV" })];
  const { toInsert, skipped } = dedupTransactions(incoming, []);
  check("first upload inserts all (2 coffees + rent)", toInsert.length === 3 && skipped === 0);
}
// 2. Re-upload identical file → insert 0
{
  const incoming = [tx({}), tx({})];
  const existing = incoming.map(rowFromTx);
  const { toInsert, skipped } = dedupTransactions(incoming, existing);
  check("re-upload identical → insert 0, skip 2", toInsert.length === 0 && skipped === 2);
}
// 3. In-file legit duplicates exceed existing → insert the surplus only
{
  const incoming = [tx({}), tx({}), tx({})]; // 3 identical coffees this file
  const existing = [rowFromTx(tx({}))];       // only 1 stored before
  const { toInsert, skipped } = dedupTransactions(incoming, existing);
  check("3 coffees vs 1 existing → insert 2, skip 1", toInsert.length === 2 && skipped === 1);
}
// 4. Overlapping upload — some new, some already stored
{
  const old = tx({ date: "2026-02-01", description: "Oud", amount: 100 });
  const fresh = tx({ date: "2026-02-15", description: "Nieuw", amount: 200 });
  const incoming = [old, fresh];
  const existing = [rowFromTx(old)];
  const { toInsert, skipped } = dedupTransactions(incoming, existing);
  check("overlap → insert only the new one", toInsert.length === 1 && toInsert[0].description === "Nieuw" && skipped === 1);
}

// 5. Cross-format re-upload: MT940 first, then the SAME period as CSV. The invoice
//    transfer must dedup; two distinct reference-less fuel stops must both survive.
{
  const mt940 = [
    tx({ date: "2026-02-10", amount: -1210, counterpartName: "Jansen Bouw B.V.", reference: "29528" }),
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 123", reference: null }),
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 456", reference: null }),
  ];
  const existing = mt940.map(rowFromTx);
  // CSV of the same period: same tx, column-sourced names (no dots / different noise).
  const csv = [
    tx({ date: "2026-02-10", amount: -1210, counterpartName: "Jansen Bouw BV", reference: "29528" }),
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 123", reference: null }),
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 456", reference: null }),
  ];
  const { toInsert, skipped } = dedupTransactions(csv, existing);
  check("cross-format re-upload dedups all 3 (no double-count of in/uit)", toInsert.length === 0 && skipped === 3);
}
// 6. Guard: the two distinct fuel stops are NOT collapsed on a first import.
{
  const incoming = [
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 123", reference: null }),
    tx({ date: "2026-02-11", amount: -50, counterpartName: "Shell 456", reference: null }),
  ];
  const { toInsert } = dedupTransactions(incoming, []);
  check("distinct numbered stores both import (no silent under-count)", toInsert.length === 2);
}

console.log("\n— mapToRows —");
{
  const rows = mapToRows([tx({ amount: -800, description: "Huur", counterpartName: "Verhuur BV", reference: "HUUR-02" })], "user-1");
  const r = rows[0];
  check("maps camel→snake + status pending + user pinned",
    r.user_id === "user-1" &&
    r.status === "pending" &&
    r.amount === -800 &&
    r.counterpart_name === "Verhuur BV" &&
    r.reference === "HUUR-02");
  check("empty strings → null", mapToRows([tx({ description: "" })], "u")[0].description === null);
}


console.log("\n— rowToTransaction —");
{
  const t = rowToTransaction({ id: "tx-9", date: "2026-02-10", amount: -800, description: "Huur", counterpart_name: "Verhuur BV", reference: "HUUR-02" });
  check("DB id carried into transactionId", t.transactionId === "tx-9");
  check("snake→camel + EUR + signed amount", t.counterpartName === "Verhuur BV" && t.currency === "EUR" && t.amount === -800);
  check("null date → empty string (matcher-safe)", rowToTransaction({ id: "x", date: null, amount: 1, description: null, counterpart_name: null, reference: null }).date === "");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);