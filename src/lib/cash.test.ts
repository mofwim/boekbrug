// [CASH-LEDGER] Pure node test — run: npx tsx src/lib/cash.test.ts
import { computeCashBalance, isCashCategory, buildCashSettlement, computeCashSettlementSync } from "./cash";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— computeCashBalance —");
check("empty ledger → 0", computeCashBalance([]) === 0);
check("in adds, out subtracts",
  computeCashBalance([
    { direction: "in", amount: 100 },   // cash sale
    { direction: "out", amount: 30 },    // cash expense
    { direction: "out", amount: 50 },    // storting (deposit to bank)
  ]) === 20);
check("withdrawal (opname) raises the drawer",
  computeCashBalance([
    { direction: "in", amount: 200 },    // opname from bank
    { direction: "out", amount: 75 },
  ]) === 125);
check("null amount treated as 0",
  computeCashBalance([{ direction: "in", amount: null }, { direction: "in", amount: 40 }]) === 40);
check("can go negative (over-recorded expenses surface a real error)",
  computeCashBalance([{ direction: "out", amount: 10 }]) === -10);

console.log("\n— isCashCategory —");
check("accepts a real category", isCashCategory("omzet") && isCashCategory("transfer"));
check("accepts the new 'betaling' settlement category", isCashCategory("betaling"));
check("rejects junk", !isCashCategory("pos_income") && !isCashCategory("x") && !isCashCategory(null));

console.log("\n— [CASH-SETTLE] buildCashSettlement (a cash-paid invoice → a balance-only entry) —");
{
  const s = buildCashSettlement({ id: "inv1", total_inc_btw: 121, payment_date: "2026-05-03", invoice_number: "F-9", client_name: "Sligro" });
  check("out-movement of the GROSS amount", s?.direction === "out" && s?.amount === 121);
  check("category 'betaling' — excluded from the P&L by construction", s?.category === "betaling");
  check("NO btw_rate — voorbelasting already came from the invoice", s?.btw_rate === null);
  check("linked to the invoice + dated on the payment day", s?.invoice_id === "inv1" && s?.entry_date === "2026-05-03");
  check("description names the invoice + vendor", (s?.description ?? "").includes("F-9") && (s?.description ?? "").includes("Sligro"));
  check("a negative printed total is still an out-movement of its absolute value",
    buildCashSettlement({ id: "x", total_inc_btw: -50 })?.amount === 50);
  check("no total → null (never a €0/garbage settlement)", buildCashSettlement({ id: "x", total_inc_btw: null }) === null);
  check("zero total → null", buildCashSettlement({ id: "x", total_inc_btw: 0 }) === null);
}

console.log("\n— [CASH-SETTLE] computeCashSettlementSync (self-healing, path-independent) —");
{
  const paid = [
    { id: "A", total_inc_btw: 100 },
    { id: "B", total_inc_btw: 200 },
  ];
  const existing = [
    { id: "e1", invoice_id: "A" },   // already settled
    { id: "e2", invoice_id: "Z" },   // orphan: Z is no longer paid-in-cash
    { id: "e3", invoice_id: null },  // a manual betaling entry, not invoice-linked → left alone
  ];
  const sync = computeCashSettlementSync(paid, existing);
  check("creates the missing settlement (B), not the already-settled one (A)",
    sync.toCreate.length === 1 && sync.toCreate[0].id === "B");
  check("deletes the orphaned settlement (Z un-paid) — the reversal",
    sync.toDeleteIds.length === 1 && sync.toDeleteIds[0] === "e2");
  check("a manual (unlinked) betaling entry is never touched",
    !sync.toDeleteIds.includes("e3"));
  const none = computeCashSettlementSync([], []);
  check("nothing paid, nothing existing → no-op", none.toCreate.length === 0 && none.toDeleteIds.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
