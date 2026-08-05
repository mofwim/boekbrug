// [CASH-LEDGER] Pure node test — run: npx tsx src/lib/cash.test.ts
import { computeCashBalance, computeDrawerBalance, isCashCategory, buildCashSettlement, buildCashSettlements, computeCashSettlementSync, settlementGross } from "./cash";

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

console.log("\n— [CASH-CREDITNOTA] a refund moves the drawer the OTHER way, and it was booked backwards —");
{
  // `direction` records who SENT the document, not which way the money travelled, and on a
  // creditnota those are opposite. Booking by direction alone puts a cash refund in the drawer
  // backwards — and a wrong-signed entry is off by TWICE its amount, on the one book whose whole
  // purpose is that it reconciles against the coins in the till.
  //
  // The legacy aggregate path was already safe (settlementGross refuses a non-positive gross).
  // The per-instalment path added later returns BEFORE that guard is consulted, which is the only
  // path a cash payment recorded today takes.
  const supplierRefund = buildCashSettlements({
    id: "cn1", direction: "incoming", invoice_type: "creditnota",
    total_inc_btw: -75, invoice_number: "CR-1", client_name: "Sligro",
    cash_instalments: [{ id: "i1", amount: -75, paid_on: "2026-05-03" }],
  });
  check("supplier refunds me in cash → drawer UP", supplierRefund.length === 1 && supplierRefund[0].direction === "in");
  check("…for the magnitude, not the sign", supplierRefund[0]?.amount === 75);
  check("…and it stays P&L-neutral", supplierRefund[0]?.category === "betaling" && supplierRefund[0]?.btw_rate === null);
  check("…and reads as a creditnota, not a factuur",
    (supplierRefund[0]?.description ?? "").includes("creditnota") && !(supplierRefund[0]?.description ?? "").includes("factuur"));

  const iRefundCustomer = buildCashSettlements({
    id: "cn2", direction: "outgoing", invoice_type: "creditnota",
    total_inc_btw: -40, invoice_number: "2026-CR-2", client_name: "Klant BV",
    cash_instalments: [{ id: "i2", amount: -40, paid_on: "2026-05-04" }],
  });
  check("I refund my customer in cash → drawer DOWN", iRefundCustomer[0]?.direction === "out");
  check("…and reads 'Terugbetaling'", (iRefundCustomer[0]?.description ?? "").includes("Terugbetaling"));

  // Either witness alone is enough. A creditnota imported with POSITIVE amounts is the 'conflict'
  // stance import-health flags — the type is the declared truth and must still flip the drawer.
  const typedOnly = buildCashSettlements({
    id: "cn3", direction: "incoming", invoice_type: "creditnota", total_inc_btw: 75,
    cash_instalments: [{ id: "i3", amount: 75, paid_on: "2026-05-05" }],
  });
  check("type alone flips it (a credit stored with positive amounts)", typedOnly[0]?.direction === "in");
  // …and a negative gross with no type set (an older row, or one the reader typed as an invoice).
  const signOnly = buildCashSettlements({
    id: "cn4", direction: "incoming", total_inc_btw: -75,
    cash_instalments: [{ id: "i4", amount: -75, paid_on: "2026-05-06" }],
  });
  check("sign alone flips it (no invoice_type stored)", signOnly[0]?.direction === "in");

  // The negative control that keeps the fix honest: an ORDINARY invoice must not move.
  const ordinary = buildCashSettlements({
    id: "ok1", direction: "incoming", invoice_type: "factuur", total_inc_btw: 121,
    cash_instalments: [{ id: "i5", amount: 121, paid_on: "2026-05-07" }],
  });
  check("an ordinary purchase still lowers the drawer", ordinary[0]?.direction === "out");
  check("…and still reads 'Betaling factuur'", (ordinary[0]?.description ?? "").includes("Betaling factuur"));

  // The drawers already booked backwards are not stranded: the reconciler compares direction and
  // heals it. Without this the fix would only apply to refunds recorded from today on, and every
  // existing one would keep the kasboek off by twice its amount forever.
  const sync = computeCashSettlementSync(
    [{
      id: "cn1", direction: "incoming", invoice_type: "creditnota", total_inc_btw: -75,
      cash_instalments: [{ id: "i1", amount: -75, paid_on: "2026-05-03" }],
    }],
    [{ id: "e-old", invoice_id: "cn1", settlement_id: "i1", amount: 75, entry_date: "2026-05-03", direction: "out" }],
  );
  check("an existing backwards entry is healed, not duplicated",
    sync.toUpdate.length === 1 && sync.toCreate.length === 0 && sync.toDeleteIds.length === 0);
  check("…to the direction the money actually moved", sync.toUpdate[0]?.row.direction === "in");
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
    sync.toCreate.length === 1 && sync.toCreate[0].invoice_id === "B");
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

console.log("\n— [CASH-PARTIAL] bank instalments reduce the cash settlement to the remainder —");
{
  check("€500 invoice, €300 bank-paid → cash settlement = €200 remainder",
    settlementGross({ id: "x", total_inc_btw: 500, amount_paid: 300 }) === 200);
  check("no bank instalment (amount_paid 0/absent) → full gross unchanged",
    settlementGross({ id: "x", total_inc_btw: 500, amount_paid: 0 }) === 500 &&
    settlementGross({ id: "x", total_inc_btw: 500 }) === 500);
  check("fully bank-settled → null (no cash ever moved the drawer)",
    settlementGross({ id: "x", total_inc_btw: 500, amount_paid: 500 }) === null);
  check("negative amount_paid is clamped (never inflates the settlement)",
    settlementGross({ id: "x", total_inc_btw: 500, amount_paid: -100 }) === 500);
  check("a real 1-cent remainder is kept (cent-rounded, not dropped)",
    settlementGross({ id: "x", total_inc_btw: 100.1, amount_paid: 100.09 }) === 0.01);
  check("float-noise 'remainder' (paid == total in float arithmetic) → null, never a micro-entry",
    settlementGross({ id: "x", total_inc_btw: 0.1 + 0.2, amount_paid: 0.3 }) === null);
}

console.log("\n— [CASH-STALE-DELETE] an unusable gross DELETES the stale linked entry (the dead zone) —");
{
  // Invoice A was cash-paid at €121 (entry e1 exists), then edited to €0/negative — the old code
  // skipped it entirely (still in paidIds → also excluded from orphan delete) so e1 double-counted
  // the drawer FOREVER. Now the stale entry is deleted; nothing is created or updated.
  const zeroed = computeCashSettlementSync(
    [{ id: "A", total_inc_btw: 0 }],
    [{ id: "e1", invoice_id: "A", amount: 121, entry_date: "2026-05-01" }],
  );
  check("gross edited to €0 → stale entry deleted, none created",
    zeroed.toDeleteIds.length === 1 && zeroed.toDeleteIds[0] === "e1" &&
    zeroed.toCreate.length === 0 && zeroed.toUpdate.length === 0);
  const bankTook = computeCashSettlementSync(
    [{ id: "A", total_inc_btw: 500, amount_paid: 500 }],
    [{ id: "e1", invoice_id: "A", amount: 500 }],
  );
  check("bank since settled the full amount → the cash entry is removed",
    bankTook.toDeleteIds.length === 1 && bankTook.toDeleteIds[0] === "e1");
  // No linked entry + unusable gross → still nothing (never a garbage create).
  const nothing = computeCashSettlementSync([{ id: "A", total_inc_btw: 0 }], []);
  check("unusable gross with no entry → complete no-op",
    nothing.toCreate.length === 0 && nothing.toUpdate.length === 0 && nothing.toDeleteIds.length === 0);
}

console.log("\n— [CASH-DUP-HEAL] duplicate settlements for one invoice: keep the first, delete the rest —");
{
  const dup = computeCashSettlementSync(
    [{ id: "A", total_inc_btw: 121 }],
    [
      { id: "e1", invoice_id: "A", amount: 121, entry_date: undefined },
      { id: "e2", invoice_id: "A", amount: 121, entry_date: undefined }, // pre-index race duplicate
    ],
  );
  check("the duplicate entry is deleted, the first kept in sync",
    dup.toDeleteIds.length === 1 && dup.toDeleteIds[0] === "e2" && dup.toUpdate.length === 0 && dup.toCreate.length === 0);
  // A drifted first entry still heals while its duplicate is removed.
  const dupDrift = computeCashSettlementSync(
    [{ id: "A", total_inc_btw: 150 }],
    [
      { id: "e1", invoice_id: "A", amount: 121 },
      { id: "e2", invoice_id: "A", amount: 121 },
    ],
  );
  check("duplicate deleted AND the kept entry heals its amount",
    dupDrift.toDeleteIds.includes("e2") && dupDrift.toUpdate.length === 1 && dupDrift.toUpdate[0].id === "e1");
}

console.log("\n— [CASH-INSTALMENT] one drawer movement per CASH PAYMENT, on its own day —");
{
  // The case the app used to refuse: a €1.210 supplier invoice paid from the till in two
  // handovers. As ONE entry it claimed €1.210 left the drawer on 12 June — the balance was
  // €500 too high for five weeks, and half the money moved out of Q2 into Q3.
  const inv = {
    id: "A", direction: "incoming" as const, total_inc_btw: 1210, invoice_number: "2026-045",
    client_name: "Groothandel BV", payment_date: "2026-06-12",
    cash_instalments: [
      { id: "p2", amount: 710, paid_on: "2026-06-12" },
      { id: "p1", amount: 500, paid_on: "2026-05-03" },
    ],
  };
  const rows = buildCashSettlements(inv);
  check("two cash payments → two drawer movements", rows.length === 2);
  check("oldest first, on its OWN day", rows[0].entry_date === "2026-05-03" && rows[0].amount === 500);
  check("...and the second on its own day", rows[1].entry_date === "2026-06-12" && rows[1].amount === 710);
  check("together they equal the invoice", rows[0].amount + rows[1].amount === 1210);
  check("each carries its instalment key", rows[0].settlement_id === "p1" && rows[1].settlement_id === "p2");
  check("both lower the drawer (a purchase)", rows.every((r) => r.direction === "out"));
  check("both are P&L-neutral", rows.every((r) => r.category === "betaling" && r.btw_rate === null));
  check("the lines are told apart", /1e termijn van 2/.test(rows[0].description) && /2e termijn van 2/.test(rows[1].description));
}
{
  // A cash SALE works the same way, raising the drawer.
  const rows = buildCashSettlements({
    id: "S", direction: "outgoing", total_inc_btw: 300, invoice_number: "20260007",
    cash_instalments: [{ id: "q1", amount: 100, paid_on: "2026-04-01" }, { id: "q2", amount: 200, paid_on: "2026-04-08" }],
  });
  check("a cash sale in two parts raises the drawer twice", rows.length === 2 && rows.every((r) => r.direction === "in"));
}
{
  // One instalment: exactly one entry, and no "1e termijn van 1" noise.
  const rows = buildCashSettlements({
    id: "B", total_inc_btw: 121, invoice_number: "F-9", client_name: "Sligro",
    cash_instalments: [{ id: "s1", amount: 121, paid_on: "2026-05-03" }],
  });
  check("a single cash payment is still one entry", rows.length === 1 && rows[0].amount === 121);
  check("...keyed to its instalment", rows[0].settlement_id === "s1");
  check("...and reads plainly", !/termijn/.test(rows[0].description));
}
{
  // No instalment rows at all (an invoice settled before instalments existed): the legacy
  // aggregate, remainder-of-the-bank rule, with no key.
  const rows = buildCashSettlements({ id: "L", total_inc_btw: 500, amount_paid: 300, payment_date: "2026-03-09" });
  check("legacy invoice → one aggregate entry of the remainder", rows.length === 1 && rows[0].amount === 200);
  check("...with no instalment key", rows[0].settlement_id === null);
  check("nothing bookable → no rows at all", buildCashSettlements({ id: "Z", total_inc_btw: 0 }).length === 0);
  check("a €0 instalment is not a movement",
    buildCashSettlements({ id: "Z2", total_inc_btw: 100, cash_instalments: [{ id: "z", amount: 0, paid_on: "2026-01-01" }] }).length === 1);
  check("buildCashSettlement still answers for one-payment callers",
    buildCashSettlement({ id: "B", total_inc_btw: 121, cash_instalments: [{ id: "s1", amount: 121, paid_on: "2026-05-03" }] })?.amount === 121);
}

console.log("\n— [CASH-INSTALMENT] the reconcile keeps one entry per payment, and migrates the old one —");
{
  const inv = {
    id: "A", total_inc_btw: 1210,
    cash_instalments: [{ id: "p1", amount: 500, paid_on: "2026-05-03" }, { id: "p2", amount: 710, paid_on: "2026-06-12" }],
  };
  // First run after the migration: the drawer still holds ONE aggregate entry.
  const migrate = computeCashSettlementSync([inv], [{ id: "old", invoice_id: "A", settlement_id: null, amount: 1210, entry_date: "2026-06-12" }]);
  check("the legacy aggregate entry is replaced, not kept alongside",
    migrate.toDeleteIds.length === 1 && migrate.toDeleteIds[0] === "old");
  check("...by one entry per instalment", migrate.toCreate.length === 2);
  check("...which together still equal the invoice",
    migrate.toCreate.reduce((s, r) => s + r.amount, 0) === 1210);

  // Steady state: both entries exist and match → nothing to do.
  const settled = computeCashSettlementSync([inv], [
    { id: "e1", invoice_id: "A", settlement_id: "p1", amount: 500, entry_date: "2026-05-03" },
    { id: "e2", invoice_id: "A", settlement_id: "p2", amount: 710, entry_date: "2026-06-12" },
  ]);
  check("in sync → no create, no update, no delete",
    settled.toCreate.length === 0 && settled.toUpdate.length === 0 && settled.toDeleteIds.length === 0);

  // A second instalment added after the first was booked → only the new one is created.
  const grew = computeCashSettlementSync([inv], [{ id: "e1", invoice_id: "A", settlement_id: "p1", amount: 500, entry_date: "2026-05-03" }]);
  check("a new cash payment adds exactly one movement",
    grew.toCreate.length === 1 && grew.toCreate[0].settlement_id === "p2" && grew.toDeleteIds.length === 0);

  // An instalment the owner undid → its entry goes, the other stays.
  const undone = computeCashSettlementSync(
    [{ id: "A", total_inc_btw: 1210, cash_instalments: [{ id: "p1", amount: 500, paid_on: "2026-05-03" }] }],
    [
      { id: "e1", invoice_id: "A", settlement_id: "p1", amount: 500, entry_date: "2026-05-03" },
      { id: "e2", invoice_id: "A", settlement_id: "p2", amount: 710, entry_date: "2026-06-12" },
    ],
  );
  check("undoing one payment removes only ITS movement",
    undone.toDeleteIds.length === 1 && undone.toDeleteIds[0] === "e2" && undone.toCreate.length === 0);

  // A corrected instalment amount heals in place (no delete/recreate).
  const heal = computeCashSettlementSync([inv], [
    { id: "e1", invoice_id: "A", settlement_id: "p1", amount: 450, entry_date: "2026-05-03" },
    { id: "e2", invoice_id: "A", settlement_id: "p2", amount: 710, entry_date: "2026-06-12" },
  ]);
  check("a corrected instalment heals its own entry only",
    heal.toUpdate.length === 1 && heal.toUpdate[0].id === "e1" && heal.toUpdate[0].row.amount === 500);

  // Duplicates on the SAME instalment are still collapsed.
  const dup = computeCashSettlementSync([inv], [
    { id: "e1", invoice_id: "A", settlement_id: "p1", amount: 500, entry_date: "2026-05-03" },
    { id: "e1b", invoice_id: "A", settlement_id: "p1", amount: 500, entry_date: "2026-05-03" },
    { id: "e2", invoice_id: "A", settlement_id: "p2", amount: 710, entry_date: "2026-06-12" },
  ]);
  check("a duplicate of one instalment is deleted, the rest untouched",
    dup.toDeleteIds.length === 1 && dup.toDeleteIds[0] === "e1b" && dup.toCreate.length === 0);

  // The invoice stops being cash-paid → every movement is reversed.
  const reversed = computeCashSettlementSync([], [
    { id: "e1", invoice_id: "A", settlement_id: "p1", amount: 500 },
    { id: "e2", invoice_id: "A", settlement_id: "p2", amount: 710 },
  ]);
  check("un-paying the invoice reverses BOTH movements", reversed.toDeleteIds.length === 2);
}

console.log("\n— computeDrawerBalance (the ONE saldo shown on both the Kas page and the home) —");
// The reported bug: two omzet cash_entries (−150 out, +109 in) net −41; a till day of 100 cash;
// opening 0. Home showed −41 (entries only); Kas page showed 59 (all three). 59 is the truth.
check("entries + till cash + opening → the true drawer (the −41 vs 59 bug)",
  computeDrawerBalance({
    openingBalance: 0,
    entries: [{ direction: "out", amount: 150 }, { direction: "in", amount: 109 }],
    tillCashAmounts: [100],
  }) === 59);
check("cash_entries alone (no till, no opening) still matches computeCashBalance",
  computeDrawerBalance({ openingBalance: 0, entries: [{ direction: "in", amount: 40 }], tillCashAmounts: [] }) === 40);
check("opening float is included",
  computeDrawerBalance({ openingBalance: 25, entries: [], tillCashAmounts: [] }) === 25);
check("null/empty inputs → 0 (no NaN)",
  computeDrawerBalance({ openingBalance: null, entries: [], tillCashAmounts: [null, null] }) === 0);
check("till-only shop (no manual entries) shows its drawer",
  computeDrawerBalance({ openingBalance: 0, entries: [], tillCashAmounts: [200, 50] }) === 250);
check("rounds to the cent",
  computeDrawerBalance({ openingBalance: 0.1, entries: [{ direction: "in", amount: 0.2 }], tillCashAmounts: [] }) === 0.3);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
