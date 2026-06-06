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

console.log("\n— contentKey —");
check("same content → same key",
  contentKey("2026-02-10", 4, "Koffie", "Cafe X", null) ===
  contentKey("2026-02-10", 4, "  koffie ", "cafe x", null)); // norm: trim/case/space
check("different amount → different key",
  contentKey("2026-02-10", 4, "Koffie", "Cafe X", null) !==
  contentKey("2026-02-10", 5, "Koffie", "Cafe X", null));
check("amount precision normalized (4 vs 4.00)",
  contentKey("2026-02-10", 4, "x", null, null) ===
  contentKey("2026-02-10", 4.0, "x", null, null));

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