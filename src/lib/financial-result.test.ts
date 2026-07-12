// [RESULT] Pure node test — run: npx tsx src/lib/financial-result.test.ts
import {
  computeResult,
  type ResultInvoice, type ResultBankTx, type ResultCashEntry,
} from "./financial-result";

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
