// [RESULT] Pure node test — run: npx tsx src/lib/financial-result.test.ts
import {
  computeResult,
  type ResultInvoice, type ResultBankTx, type ResultCashEntry,
} from "./financial-result";
import type { DailyTurnover } from "./turnover";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

console.log("\n— invoices core —");
{
  const inv: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 1000, btw_amount: 210 }, // sale 21%
    { direction: "outgoing", status: "processing", total_ex_btw: 500, btw_amount: 105 }, // unverified → ignored
    { direction: "incoming", status: "received", total_ex_btw: 400, btw_amount: 84 }, // cost 21%
    { direction: "incoming", status: "draft", total_ex_btw: 999, btw_amount: 209 }, // unverified → ignored
  ];
  const r = computeResult(inv, [], []);
  check("omzet = verified outgoing ex-btw", r.omzet === 1000);
  check("kosten = verified incoming ex-btw", r.kosten === 400);
  check("btw verschuldigd from sales", r.btwVerschuldigd === 210);
  check("btw voorbelasting from purchases", r.btwVoorbelasting === 84);
  check("btw saldo = 210 − 84", r.btwSaldo === 126);
  check("resultaat = 1000 − 400", r.resultaat === 600);
}

console.log("\n— bank de-dup (the critical one) —");
{
  const inv: ResultInvoice[] = [
    { direction: "incoming", status: "received", total_ex_btw: 400, btw_amount: 84 },
  ];
  const bank: ResultBankTx[] = [
    { amount: -484, category: "kosten", invoice_id: "inv-1" }, // PAYMENT of that invoice → must NOT double count
    { amount: -100, category: "kosten", invoice_id: null },     // a cost with no invoice → counts
    { amount: 250, category: "omzet", invoice_id: null },       // non-invoice income → counts
    { amount: -60, category: "transfer", invoice_id: null },    // transfer → excluded
    { amount: -40, category: null, invoice_id: null },          // uncategorized → not guessed
  ];
  const r = computeResult(inv, bank, []);
  check("invoice payment (invoice_id set) is NOT double counted", r.kosten === 400 + 100);
  check("non-invoice bank income counts as omzet", r.omzet === 250);
  check("transfer + uncategorized excluded", r.kosten === 500 && r.omzet === 250);
  check("bare bank lines add no BTW", r.btwVerschuldigd === 0 && r.btwVoorbelasting === 84);
}

console.log("\n— cash —");
{
  const cash: ResultCashEntry[] = [
    { direction: "in", amount: 121, category: "omzet", btw_rate: 21 },   // cash sale incl 21% → net 100, btw 21
    { direction: "in", amount: 50, category: "omzet", btw_rate: null },   // cash sale, no rate → nudge
    { direction: "out", amount: 30, category: "kosten", btw_rate: null }, // cash expense
    { direction: "out", amount: 200, category: "transfer", btw_rate: null }, // storting → excluded
    { direction: "out", amount: 80, category: "prive", btw_rate: null },  // prive → excluded
  ];
  const r = computeResult([], [], cash);
  check("rated cash sale nets ex-btw (121 → 100)", near(r.omzet, 100 + 50));
  check("rated cash sale adds btw (21)", near(r.btwVerschuldigd, 21));
  check("unrated cash sale flagged", r.cashOmzetZonderBtw === 50);
  check("cash expense counts as kosten", r.kosten === 30);
  check("transfer + prive excluded from cash", near(r.omzet, 150) && r.kosten === 30);
}

console.log("\n— combined, no double count —");
{
  const inv: ResultInvoice[] = [{ direction: "outgoing", status: "paid", total_ex_btw: 2000, btw_amount: 420 }];
  const bank: ResultBankTx[] = [
    { amount: 2420, category: "omzet", invoice_id: "inv-1" }, // customer paying the invoice → excluded
    { amount: -150, category: "kosten", invoice_id: null },
  ];
  const cash: ResultCashEntry[] = [{ direction: "in", amount: 242, category: "omzet", btw_rate: 21 }];
  const r = computeResult(inv, bank, cash);
  check("omzet = invoice 2000 + cash net 200 (bank payment excluded)", near(r.omzet, 2200));
  check("kosten = 150 bank-only cost", r.kosten === 150);
  check("btw = invoice 420 + cash 42", near(r.btwVerschuldigd, 462));
  check("resultaat = 2200 − 150", near(r.resultaat, 2050));
}

console.log("\n— turnover (retail Z-report) de-dup vs pos_income + cash —");
{
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-04-04",
    base_0: 20, base_9: 1000, base_21: 500, btw_9: 90, btw_21: 105,
    total_incl: 1715, pin_amount: 1200, cash_amount: 415, other_amount: 100,
  }];
  const bank: ResultBankTx[] = [
    { amount: 1200, category: "pos_income", invoice_id: null, settleDate: "2026-04-04" }, // covered → witness, excluded
    { amount: 800, category: "pos_income", invoice_id: null, settleDate: "2026-05-01" },  // NOT covered → counts
  ];
  const cash: ResultCashEntry[] = [
    { direction: "in", amount: 415, category: "omzet", btw_rate: 21, date: "2026-04-04" },  // covered → excluded (omzet+btw+nudge)
    { direction: "in", amount: 50, category: "omzet", btw_rate: null, date: "2026-05-02" }, // not covered → counts + nudge
    { direction: "out", amount: 30, category: "kosten", btw_rate: null, date: "2026-04-04" }, // covered day but KOSTEN → still counts
  ];
  const r = computeResult([], bank, cash, turnover);
  check("turnover net counted; covered pos_income + cash excluded; uncovered counted",
    near(r.omzet, 1520 + 800 + 50));
  check("kosten on a covered day still counts", r.kosten === 30);
  check("btwVerschuldigd = turnover 195 only (covered cash BTW excluded)", near(r.btwVerschuldigd, 195));
  check("per-rate turnover BTW split (rubriek 1a/1b)", near(r.turnoverBtw9, 90) && near(r.turnoverBtw21, 105));
  check("nudge fires only for the uncovered unrated cash", r.cashOmzetZonderBtw === 50);
}

console.log("\n— turnover cross-quarter settlement lag (R1) —");
{
  // A Mar 31 (Q1) sale settles on the bank Apr 1 (Q2). Q2 has no turnover row for Mar 31,
  // but the caller passes a widened covered set including it → must NOT re-count.
  const bank: ResultBankTx[] = [
    { amount: 500, category: "pos_income", invoice_id: null, settleDate: "2026-03-31" },
  ];
  const covered = new Set(["2026-03-31"]);
  const r = computeResult([], bank, [], [], covered);
  check("pos_income settling in Q2 for a Q1 turnover day is NOT re-counted", r.omzet === 0);
}

console.log("\n— no turnover → byte-identical to before (non-breaking) —");
{
  const bank: ResultBankTx[] = [{ amount: 250, category: "pos_income", invoice_id: null }];
  const r = computeResult([], bank, []);
  check("pos_income still counts as omzet when no turnover exists", r.omzet === 250);
  check("new per-rate fields default to 0", r.turnoverBtw9 === 0 && r.turnoverBtw21 === 0);
}

console.log("\n— salesByRate: per-rate split across all sources, sums to btwVerschuldigd —");
{
  const inv: ResultInvoice[] = [
    { direction: "outgoing", status: "paid", total_ex_btw: 1000, btw_amount: 210 }, // 21%
    { direction: "outgoing", status: "sent", total_ex_btw: 500, btw_amount: 45 },   // 9%
    { direction: "incoming", status: "received", total_ex_btw: 400, btw_amount: 84 }, // purchase, not a sale
  ];
  const cash: ResultCashEntry[] = [{ direction: "in", amount: 218, category: "omzet", btw_rate: 9, date: "2026-05-01" }]; // net 200, btw 18; a real (dated) NON-covered day
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-04-01", base_0: 10, base_9: 1000, base_21: 100, btw_9: 90, btw_21: 21,
    total_incl: 1221, pin_amount: null, cash_amount: null, other_amount: null,
  }];
  const r = computeResult(inv, [], cash, turnover);
  const byRate = (rate: number) => r.salesByRate.find((s) => s.rate === rate);
  check("21% bucket = invoice 210 + turnover 21", near(byRate(21)!.btw, 231));
  check("9% bucket = invoice 45 + cash 18 + turnover 90", near(byRate(9)!.btw, 153));
  check("0% bucket present (turnover base_0), no btw", near(byRate(0)!.omzet, 10) && byRate(0)!.btw === 0);
  const rateSum = r.salesByRate.reduce((s, x) => s + x.btw, 0);
  check("Σ salesByRate.btw === btwVerschuldigd (no drift)", near(rateSum, r.btwVerschuldigd));
  check("incoming invoice never appears as a sale", byRate(21)!.omzet === 1000 + 100); // not 1400
}

console.log("\n— AUDIT FIXES: creditnota nets, null-date cash excluded —");
{
  // #1 an outgoing creditnota (negative both) must NET its rubriek, not over-declare.
  const r1 = computeResult([
    { direction: "outgoing", status: "paid", total_ex_btw: 1185, btw_amount: 249 },
    { direction: "outgoing", status: "paid", total_ex_btw: -1185, btw_amount: -249 },
  ], [], []);
  check("creditnota nets the 21% bucket back to 0", near(r1.salesByRate.find((s) => s.rate === 21)?.btw ?? -1, 0));
  check("creditnota: btwVerschuldigd = 0 (not over-declared)", near(r1.btwVerschuldigd, 0));

  // #3 a null-date cash omzet on a store that uses turnover must NOT double-count.
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-04-04", base_0: 0, base_9: 1000, base_21: 0, btw_9: 90, btw_21: 0,
    total_incl: 1090, pin_amount: null, cash_amount: null, other_amount: null,
  }];
  const r3 = computeResult([], [], [{ direction: "in", amount: 109, category: "omzet", btw_rate: 9, date: null }], turnover);
  check("null-date cash on a turnover store is excluded (omzet stays 1000)", near(r3.omzet, 1000));
  check("null-date cash does not inflate the 9% bucket", near(r3.salesByRate.find((s) => s.rate === 9)?.btw ?? 0, 90));
}

console.log("\n— [TRIANGLE] acquirer commission is booked as a cost, no BTW —");
{
  // Till counts card takings GROSS (1090 incl / 1000 net + 90 BTW). Without commission,
  // profit = 1000. Feeding a €15 acquirer commission drops the result to 985 and adds
  // NOTHING to voorbelasting (its BTW belongs to the acquirer invoice, not invented here).
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-07-03", base_0: 0, base_9: 1000, base_21: 0, btw_9: 90, btw_21: 0,
    total_incl: 1090, pin_amount: 1090, cash_amount: 0, other_amount: 0,
  }];
  const base = computeResult([], [], [], turnover);
  check("without commission, resultaat = 1000 (overstated)", near(base.resultaat, 1000));
  const withComm = computeResult([], [], [], turnover, undefined, 15);
  check("commission booked → kosten = 15", near(withComm.kosten, 15));
  check("commission booked → resultaat = 985 (honest)", near(withComm.resultaat, 985));
  check("commission adds NO voorbelasting", near(withComm.btwVoorbelasting, 0));
  check("a negative/zero commission is ignored", near(computeResult([], [], [], turnover, undefined, -5).kosten, 0));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
