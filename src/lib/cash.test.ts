// [CASH-LEDGER] Pure node test — run: npx tsx src/lib/cash.test.ts
import { computeCashBalance, isCashCategory, buildCashSettlement, computeCashSettlementSync, settlementGross } from "./cash";

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
  check("[F2] null total but ex+btw present → gross = ex+btw (kas still moves)",
    buildCashSettlement({ id: "x", total_inc_btw: null, total_ex_btw: 100, btw_amount: 21 })?.amount === 121);
  check("[F2] settlementGross prefers the stored gross over ex+btw",
    settlementGross({ id: "x", total_inc_btw: 121, total_ex_btw: 100, btw_amount: 21 }) === 121);
  check("a credit/refund (negative gross) → null (never a wrong-direction 'out' settlement)",
    buildCashSettlement({ id: "x", total_inc_btw: -50 }) === null);
  check("no total, no ex/btw → null (never a €0/garbage settlement)", buildCashSettlement({ id: "x", total_inc_btw: null }) === null);
  check("zero total → null", buildCashSettlement({ id: "x", total_inc_btw: 0 }) === null);
  // [CASH-SETTLE-BIDIR] an OUTGOING (sales) invoice paid in cash raises the drawer ('in'),
  // still category 'betaling' (P&L-neutral — the omzet already came from the invoice).
  {
    const out = buildCashSettlement({ id: "s1", direction: "outgoing", total_inc_btw: 500, invoice_number: "2026-020", client_name: "Klant BV" });
    check("outgoing cash sale → direction 'in' (drawer up)", out?.direction === "in" && out?.amount === 500);
    check("outgoing cash sale stays P&L-neutral (category 'betaling')", out?.category === "betaling" && out?.btw_rate === null);
    check("outgoing description reads 'Ontvangen (contant)'", (out?.description ?? "").includes("Ontvangen (contant)"));
    const inc = buildCashSettlement({ id: "p1", direction: "incoming", total_inc_btw: 121 });
    check("incoming cash purchase → direction 'out' (drawer down)", inc?.direction === "out" && inc?.amount === 121);
    check("default direction (unset) → 'out' (incoming, back-compat)", buildCashSettlement({ id: "z", total_inc_btw: 10 })?.direction === "out");
  }
}

console.log("\n— [CASH-SETTLE] computeCashSettlementSync (self-healing: create / heal / reverse) —");
{
  const paid = [
    { id: "A", total_inc_btw: 100 },
    { id: "B", total_inc_btw: 200 },
  ];
  const existing = [
    { id: "e1", invoice_id: "A", amount: 100, entry_date: "2026-05-01" }, // already settled, in sync
    { id: "e2", invoice_id: "Z", amount: 50 },                             // orphan: Z no longer paid-cash
    { id: "e3", invoice_id: null, amount: 9 },                             // manual betaling entry → untouched
  ];
  const sync = computeCashSettlementSync(paid, existing);
  check("creates the missing settlement (B), not the already-settled one (A)",
    sync.toCreate.length === 1 && sync.toCreate[0].id === "B");
  check("no spurious update when the amount already matches", sync.toUpdate.length === 0);
  check("deletes the orphaned settlement (Z un-paid) — the reversal",
    sync.toDeleteIds.length === 1 && sync.toDeleteIds[0] === "e2");
  check("a manual (unlinked) betaling entry is never touched",
    !sync.toDeleteIds.includes("e3") && !sync.toUpdate.some((u) => u.id === "e3"));
}

console.log("\n— [CASH-SETTLE][F1] a corrected invoice amount HEALS the stale settlement —");
{
  // Invoice A was paid at 100, then re-reviewed to 121; the linked entry still says 100.
  const sync = computeCashSettlementSync(
    [{ id: "A", total_inc_btw: 121 }],
    [{ id: "e1", invoice_id: "A", amount: 100, entry_date: "2026-05-01" }],
  );
  check("stale amount → toUpdate (not create, not delete)",
    sync.toUpdate.length === 1 && sync.toUpdate[0].id === "e1" && sync.toCreate.length === 0 && sync.toDeleteIds.length === 0);
  const dateHeal = computeCashSettlementSync(
    [{ id: "A", total_inc_btw: 100, payment_date: "2026-06-02" }],
    [{ id: "e1", invoice_id: "A", amount: 100, entry_date: "2026-05-01" }],
  );
  check("a corrected payment date also heals", dateHeal.toUpdate.length === 1);
  const none = computeCashSettlementSync([], []);
  check("nothing paid, nothing existing → no-op",
    none.toCreate.length === 0 && none.toUpdate.length === 0 && none.toDeleteIds.length === 0);
  // [CASH-SETTLE-BIDIR] a legacy 'out' entry for what is actually an OUTGOING cash sale heals to 'in'.
  const dirHeal = computeCashSettlementSync(
    [{ id: "A", direction: "outgoing", total_inc_btw: 500 }],
    [{ id: "e1", invoice_id: "A", amount: 500, entry_date: undefined, direction: "out" }],
  );
  check("wrong drawer direction → toUpdate (heals 'out' → 'in')", dirHeal.toUpdate.length === 1);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
