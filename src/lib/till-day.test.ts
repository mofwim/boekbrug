// [KASSA] Pure node test — run: npx tsx src/lib/till-day.test.ts
//
// The load-bearing assertion in this file is the LAST block: every day this module can build must
// survive checkTurnoverArithmetic, because bookTurnoverRows runs that gate on the write and refuses
// the whole day when it trips. A rounding scheme that drifts by a cent would not fail loudly here —
// it would fail on a barber's busiest day, months from now, with "de bedragen kunnen niet kloppen"
// over figures that are perfectly honest.
import {
  saleGross,
  articleGrossPrice,
  sumSales,
  buildTurnoverRow,
  salesToTurnoverRow,
  isTillRate,
  isTillMethod,
  validateTicket,
  daySourceConflict,
  validateManualDay,
  type TillSale,
} from "./till-day";
import { checkTurnoverArithmetic, turnoverNetOmzet, turnoverBtw, reconcileDay } from "./turnover";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

const sale = (o: Partial<TillSale>): TillSale => ({
  description: "Knippen", quantity: 1, unit_price_incl: 25, btw_rate: 21, method: "pin", ...o,
});

console.log("\n— the price a customer pays —");
check("gross of one haircut", saleGross(sale({})) === 25);
check("quantity multiplies, rounded to the cent", saleGross(sale({ quantity: 3, unit_price_incl: 12.35 })) === 37.05);
// articles.unit_price is stored EX-btw; a shop's price list is what the customer pays.
check("a EUR 20,66 net article is a EUR 25,00 haircut at 21%", articleGrossPrice(20.66, 21) === 25);
check("a 9% article converts at 9%", articleGrossPrice(100, 9) === 109);
check("a 0% article is unchanged", articleGrossPrice(40, 0) === 40);

console.log("\n— a barber's day, summed two ways —");
const day: TillSale[] = [
  sale({ description: "Knippen", unit_price_incl: 25, btw_rate: 21, method: "pin" }),
  sale({ description: "Knippen", unit_price_incl: 25, btw_rate: 21, method: "cash" }),
  sale({ description: "Baard", unit_price_incl: 15, btw_rate: 21, method: "pin" }),
  sale({ description: "Shampoo", unit_price_incl: 8.5, btw_rate: 9, method: "cash" }),
  sale({ description: "Cadeaubon", unit_price_incl: 50, btw_rate: 0, method: "other" }),
];
const g = sumSales(day);
check("21% gross is the three haircut/beard sales", near(g.gross_21, 65));
check("9% gross is the shampoo", near(g.gross_9, 8.5));
check("0% gross is the voucher", near(g.gross_0, 50));
check("pin is knippen + baard", near(g.pin, 40));
check("cash is knippen + shampoo", near(g.cash, 33.5));
check("other is the voucher", near(g.other, 50));
// The two splits describe the SAME money — this identity is what makes the day's internal
// check exact rather than approximate.
check("rate split and method split sum to the same total",
  near(g.gross_0 + g.gross_9 + g.gross_21, g.pin + g.cash + g.other));

console.log("\n— gross in, net derived —");
const row = salesToTurnoverRow("2026-08-20", day);
check("21% base is the gross divided out", near(row.base_21, 53.72));
check("21% btw is the remainder, so base+btw is exact", near(row.base_21 + row.btw_21, 65));
check("9% base is the gross divided out", near(row.base_9, 7.8));
check("9% btw is the remainder", near(row.base_9 + row.btw_9, 8.5));
check("0% carries no btw", row.base_0 === 50);
check("total_incl is what the customers paid", near(row.total_incl ?? 0, 123.5));
check("net omzet + btw equals the total exactly",
  near(turnoverNetOmzet(row) + turnoverBtw(row).total, row.total_incl ?? 0));
check("the payment split is carried through",
  near(row.pin_amount ?? 0, 40) && near(row.cash_amount ?? 0, 33.5) && near(row.other_amount ?? 0, 50));

console.log("\n— the day survives the gate that guards the write —");
check("a barber's day passes checkTurnoverArithmetic", checkTurnoverArithmetic(row).length === 0);
check("an empty day passes (nothing to be wrong)", checkTurnoverArithmetic(buildTurnoverRow("2026-08-20", sumSales([]))).length === 0);

// [KASSA] The real risk this file exists for: per-sale rounding drift. 200 sales of an amount that
// does NOT divide cleanly by 1.21 would, if btw were rounded per sale and summed, drift far enough
// to trip the gate on an honest day. Derived from the summed gross, it cannot.
{
  const many: TillSale[] = Array.from({ length: 200 }, () =>
    sale({ unit_price_incl: 12.35, btw_rate: 21, method: "pin" }));
  const busy = salesToTurnoverRow("2026-08-20", many);
  check("200 awkwardly-priced sales still pass the arithmetic gate", checkTurnoverArithmetic(busy).length === 0);
  check("…and their total is exactly 200 x 12,35", near(busy.total_incl ?? 0, 2470));
  check("…with base+btw landing on that same total",
    near(turnoverNetOmzet(busy) + turnoverBtw(busy).total, 2470));
}

// A day built here has an exact internal identity, so the screen's reconciliation must see no
// 'internal' break — only the pin/cash witnesses (bank + drawer) can ever disagree.
console.log("\n— the day is internally consistent for reconcileDay —");
{
  const breaks = reconcileDay({ turnover: row, posSettledForDay: 40, cashCountedForDay: 33.5 });
  check("no internal break on a day this module built", breaks.every((b) => b.kind !== "internal"));
  check("a matching bank + drawer means no break at all", breaks.length === 0);
}

console.log("\n— what may be rung up —");
check("21 / 9 / 0 are rates", isTillRate(21) && isTillRate(9) && isTillRate(0));
check("6% is not a Dutch rate any more", !isTillRate(6));
check("junk is not a rate", !isTillRate("x") && !isTillRate({}));
// [KASSA] The failure direction that matters. Number(null) and Number("") are both 0, and 0 IS a
// valid rate — so a naive check answers "yes, 0%" to a rate that was never given, and 21% btw the
// owner owes never reaches rubriek 1a. A missing rate must be refused, never defaulted.
check("a MISSING rate is not 0% — it is refused",
  !isTillRate(null) && !isTillRate(undefined) && !isTillRate("") && !isTillRate("   "));
check("but a real 0% still passes, typed or numeric", isTillRate(0) && isTillRate("0"));
check("a boolean is not a rate", !isTillRate(true) && !isTillRate(false));
check("pin / cash / other are methods", isTillMethod("pin") && isTillMethod("cash") && isTillMethod("other"));
check("ideal is not one of them", !isTillMethod("ideal") && !isTillMethod(null));

// A refund: the barber rang up the wrong service and gives the money back the same day. The day's
// figures go DOWN, and every identity must still hold — a negative day is a real day.
console.log("\n— a refund on the same day —");
{
  const withRefund = salesToTurnoverRow("2026-08-20", [
    sale({ unit_price_incl: 25, btw_rate: 21, method: "cash" }),
    sale({ quantity: -1, unit_price_incl: 25, btw_rate: 21, method: "cash" }),
  ]);
  check("a sale and its refund cancel to zero", near(withRefund.total_incl ?? 0, 0));
  check("…and the day still passes the gate", checkTurnoverArithmetic(withRefund).length === 0);
}

console.log("\n— what may be written —");
{
  const good = [{ description: "Knippen", quantity: 1, unit_price_incl: 25, btw_rate: 21, method: "pin" }];
  const r = validateTicket(good);
  check("a plain ticket is accepted", r.ok === true);
  check("an empty ticket is refused", validateTicket([]).ok === false);
  check("a non-array is refused", validateTicket(null).ok === false && validateTicket({}).ok === false);
  const noDesc = validateTicket([{ ...good[0], description: "  " }]);
  check("a line without an omschrijving is refused", noDesc.ok === false);
  const noRate = validateTicket([{ description: "X", quantity: 1, unit_price_incl: 10, method: "pin" }]);
  check("a line with NO rate is refused, not booked at 0%", noRate.ok === false);
  const badRate = validateTicket([{ ...good[0], btw_rate: 6 }]);
  check("a line at a rate that no longer exists is refused", badRate.ok === false);
  const noMethod = validateTicket([{ ...good[0], method: "ideal" }]);
  check("a line with an unknown payment method is refused", noMethod.ok === false);
  const zeroQty = validateTicket([{ ...good[0], quantity: 0 }]);
  check("a zero quantity is refused (it is not a sale)", zeroQty.ok === false);
  const negPrice = validateTicket([{ ...good[0], unit_price_incl: -25 }]);
  check("a negative PRICE is refused — a refund is a negative aantal", negPrice.ok === false);
  const refund = validateTicket([{ ...good[0], quantity: -1 }]);
  check("a negative quantity IS accepted (that is the refund)", refund.ok === true);
  const huge = validateTicket([{ ...good[0], unit_price_incl: 250000 }]);
  check("a slipped decimal is refused", huge.ok === false);
  // All-or-nothing: one bad line takes the whole ticket with it.
  const mixed = validateTicket([good[0], { ...good[0], btw_rate: 7 }]);
  check("one bad line refuses the WHOLE ticket", mixed.ok === false);
  if (r.ok) {
    check("an accepted line carries no article by default", r.lines[0].article_id === null);
  }
}

console.log("\n— one day, one source —");
{
  check("a free day has no conflict", daySourceConflict({ hasImportedDay: false, cashOmzetCount: 0 }) === null);
  // The imported day must never be overwritten by a hand-rung one.
  const imported = daySourceConflict({ hasImportedDay: true, cashOmzetCount: 0 });
  check("a day with a Z-report is refused", typeof imported === "string" && imported.length > 0);
  // The case this whole guard exists for: writing a turnover day on top of cash 'omzet' entries
  // does not corrupt anything — it SILENTLY switches those entries off.
  const one = daySourceConflict({ hasImportedDay: false, cashOmzetCount: 1 });
  const many = daySourceConflict({ hasImportedDay: false, cashOmzetCount: 3 });
  check("one existing cash sale is refused", typeof one === "string");
  check("…and the sentence is singular", typeof one === "string" && one.includes("één contante verkoop"));
  check("three existing cash sales are refused", typeof many === "string");
  check("…and the sentence counts them", typeof many === "string" && many.includes("3 contante verkopen"));
  // A typed day and a rung-up day are the same row from two directions.
  const till = daySourceConflict({ hasImportedDay: false, cashOmzetCount: 0, tillSaleCount: 4 });
  check("a day with Kassa sales refuses a hand-typed total", typeof till === "string");
  check("an omitted till count means zero, not a conflict",
    daySourceConflict({ hasImportedDay: false, cashOmzetCount: 0 }) === null);
  // The mirror, and the asymmetry that would have lost a whole day. rebuildTillDay rewrites the day
  // from till_sales alone, so without this the first ticket rung up on a date the owner had already
  // typed would replace his entire day's takings with that one sale.
  const typed = daySourceConflict({ hasImportedDay: false, cashOmzetCount: 0, hasTypedDay: true });
  check("a hand-typed day refuses a Kassa sale", typeof typed === "string");
  check("…and it says where to remove it", typeof typed === "string" && typed.includes("Dagomzet"));
  check("an omitted typed-day flag means no conflict",
    daySourceConflict({ hasImportedDay: false, cashOmzetCount: 0 }) === null);
  // A refusal the owner cannot act on is a dead end — both sentences say what to do.
  check("both sentences say what to do next",
    typeof one === "string" && one.includes("Kas") && typeof imported === "string" && imported.includes("kassa-rapport"));
}

console.log("\n— a day typed by hand —");
{
  const ok = validateManualDay({ gross_21: 300, gross_9: 50, pin: 250, cash: 100 });
  check("a day whose splits agree is accepted", ok.ok === true);
  if (ok.ok) {
    const r = buildTurnoverRow("2026-08-20", ok.gross);
    check("…and it survives the arithmetic gate", checkTurnoverArithmetic(r).length === 0);
    check("…with the total the owner typed", near(r.total_incl ?? 0, 350));
  }
  // The check this exists for: pin_amount SUPPRESSES the bank settlement and cash_amount feeds the
  // drawer, so disagreeing splits double-count revenue rather than merely looking untidy.
  const mismatch = validateManualDay({ gross_21: 300, pin: 250 });
  check("splits that disagree are refused", mismatch.ok === false);
  check("…and the sentence names both totals",
    !mismatch.ok && mismatch.error.includes("300.00") && mismatch.error.includes("250.00"));
  check("a cent of slack is tolerated", validateManualDay({ gross_21: 100, pin: 100.01 }).ok === true);
  check("ten cents is not", validateManualDay({ gross_21: 100, pin: 100.1 }).ok === false);
  check("an empty day is refused", validateManualDay({}).ok === false);
  check("omzet with no payment split is refused", validateManualDay({ gross_21: 100 }).ok === false);
  check("a payment split with no omzet is refused", validateManualDay({ pin: 100 }).ok === false);
  check("a negative amount is refused", validateManualDay({ gross_21: -100, pin: -100 }).ok === false);
  check("junk is refused", validateManualDay({ gross_21: "abc", pin: 10 }).ok === false);
  check("null is refused", validateManualDay(null).ok === false);
  check("a slipped decimal is refused", validateManualDay({ gross_21: 9e9, pin: 9e9 }).ok === false);
  // Blank fields are a legitimate zero — a barber who took no 9% revenue leaves that box empty.
  check("blank boxes read as zero", validateManualDay({ gross_21: 100, gross_9: "", pin: "", cash: 100 }).ok === true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
