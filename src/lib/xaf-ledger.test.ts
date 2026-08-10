// [XAF] Pure node test — run: npx tsx src/lib/xaf-ledger.test.ts
//
// The one property that matters: every entry balances to the cent, and nothing is
// ever booked on a guess. A wrong number in an auditfile is worse than no file.
import {
  deriveInvoiceEntry,
  deriveBankEntry,
  deriveCashEntry,
  buildLedger,
  ledgerIsBalanced,
  isBalanced,
  sideTotal,
  toCents,
  ACC,
  LEDGER_ACCOUNTS,
  type LedgerEntry,
  type LedgerSkip,
  type LedgerInvoice,
  type LedgerBankTx,
  type LedgerCashEntry,
} from "./xaf-ledger";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const isSkip = (x: LedgerEntry | LedgerSkip): x is LedgerSkip => (x as LedgerSkip).reason !== undefined;
const entryOf = (x: LedgerEntry | LedgerSkip): LedgerEntry => {
  if (isSkip(x)) throw new Error(`expected an entry, got skip: ${x.reason}`);
  return x;
};
const lineOn = (e: LedgerEntry, acc: string) => e.lines.find((l) => l.accountId === acc);

const invoice = (o: Partial<LedgerInvoice> = {}): LedgerInvoice => ({
  id: "inv-1", invoice_number: "2026-004", invoice_date: "2026-08-08",
  invoice_type: "factuur", direction: "outgoing", status: "sent",
  client_name: "Stichting Contour de Twern",
  total_ex_btw: 362.39, btw_amount: 32.61, total_inc_btw: 395.0, ...o,
});
const bankTx = (o: Partial<LedgerBankTx> = {}): LedgerBankTx => ({
  id: "b-1", date: "2026-08-09", amount: 395.0, description: "Overboeking",
  counterpart_name: "Contour de Twern", reference: "2026-004",
  category: "omzet", invoice_id: null, ...o,
});
const cash = (o: Partial<LedgerCashEntry> = {}): LedgerCashEntry => ({
  id: "k-1", entry_date: "2026-08-08", direction: "in", amount: 121.0,
  category: "omzet", description: "Contante verkoop", btw_rate: 21, ...o,
});

console.log("\n— money helpers —");
check("toCents rounds half away from zero", toCents(0.005) === 1 && toCents(-0.005) === -1);
check("toCents survives float noise (8.07)", toCents(8.07) === 807);
check("toCents on null → 0", toCents(null) === 0);

console.log("\n— outgoing invoice (Verkoop) —");
{
  const e = entryOf(deriveInvoiceEntry(invoice()));
  check("journal V", e.journal === "V");
  check("balances", isBalanced(e));
  check("debtors debited with the gross total", lineOn(e, ACC.debtors)?.amountCents === 39500 && lineOn(e, ACC.debtors)?.side === "D");
  check("revenue credited with the net", lineOn(e, ACC.revenue)?.amountCents === 36239 && lineOn(e, ACC.revenue)?.side === "C");
  check("btw payable credited with the STORED btw", lineOn(e, ACC.btwPayable)?.amountCents === 3261);
  check("carries the invoice number as docRef", e.docRef === "2026-004");
  check("carries the relation", e.relation === "Stichting Contour de Twern");
}

console.log("\n— incoming invoice (Inkoop) —");
{
  const e = entryOf(deriveInvoiceEntry(invoice({ id: "inv-2", direction: "incoming", status: "received" })));
  check("journal I", e.journal === "I");
  check("balances", isBalanced(e));
  check("costs debited (net)", lineOn(e, ACC.costs)?.side === "D" && lineOn(e, ACC.costs)?.amountCents === 36239);
  check("btw reclaimable debited", lineOn(e, ACC.btwReclaimable)?.side === "D" && lineOn(e, ACC.btwReclaimable)?.amountCents === 3261);
  check("creditors credited (gross)", lineOn(e, ACC.creditors)?.side === "C" && lineOn(e, ACC.creditors)?.amountCents === 39500);
}

console.log("\n— creditnota = every side flipped (rule 4) —");
{
  const normal = entryOf(deriveInvoiceEntry(invoice()));
  const credit = entryOf(deriveInvoiceEntry(invoice({ id: "inv-3", invoice_type: "creditnota" })));
  check("balances", isBalanced(credit));
  check("debtors now CREDITED", lineOn(credit, ACC.debtors)?.side === "C");
  check("revenue now DEBITED", lineOn(credit, ACC.revenue)?.side === "D");
  check("same amounts, opposite sides", sideTotal(credit, "D") === sideTotal(normal, "C"));
}

console.log("\n— what must NOT be booked (rules 1 & 3) —");
check("offerte / pro forma is refused", isSkip(deriveInvoiceEntry(invoice({ invoice_type: "pro_forma" }))));
check("concept (draft) is refused", isSkip(deriveInvoiceEntry(invoice({ status: "draft" }))));
check("outgoing 'received' is not a sale status", isSkip(deriveInvoiceEntry(invoice({ status: "received" }))));
check("incoming 'sent' is not a purchase status", isSkip(deriveInvoiceEntry(invoice({ direction: "incoming", status: "sent" }))));
check("no direction → refused (cannot tell revenue from cost)", isSkip(deriveInvoiceEntry(invoice({ direction: null }))));
check("no valid date → refused", isSkip(deriveInvoiceEntry(invoice({ invoice_date: null }))));
check("zero amount → refused", isSkip(deriveInvoiceEntry(invoice({ total_ex_btw: 0, btw_amount: 0, total_inc_btw: 0 }))));
check("a REAL mismatch is refused, not booked",
  isSkip(deriveInvoiceEntry(invoice({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 200 }))));
{
  // One cent of rounding noise IS absorbed (rule 3) — and still balances.
  const r = deriveInvoiceEntry(invoice({ total_ex_btw: 362.39, btw_amount: 32.62, total_inc_btw: 395.0 }));
  check("a one-cent rounding difference is absorbed", !isSkip(r) && isBalanced(r as LedgerEntry));
}
check("invoice without btw (0%) still balances",
  isBalanced(entryOf(deriveInvoiceEntry(invoice({ total_ex_btw: 100, btw_amount: 0, total_inc_btw: 100 })))));

console.log("\n— bank —");
{
  const inc = entryOf(deriveBankEntry(bankTx()));
  check("money in → bank DEBITED", lineOn(inc, ACC.bank)?.side === "D" && lineOn(inc, ACC.bank)?.amountCents === 39500);
  check("counter is revenue, credited", lineOn(inc, ACC.revenue)?.side === "C");
  check("balances", isBalanced(inc));

  const out = entryOf(deriveBankEntry(bankTx({ id: "b-2", amount: -45.5, category: "kosten" })));
  check("money out → bank CREDITED", lineOn(out, ACC.bank)?.side === "C" && lineOn(out, ACC.bank)?.amountCents === 4550);
  check("counter is costs, debited", lineOn(out, ACC.costs)?.side === "D");
  check("balances", isBalanced(out));

  const fee = entryOf(deriveBankEntry(bankTx({ id: "b-3", amount: -3.4, category: "fee" })));
  check("bank fee lands on 4700", lineOn(fee, ACC.bankFees)?.side === "D");

  const priv = entryOf(deriveBankEntry(bankTx({ id: "b-4", amount: -500, category: "prive" })));
  check("privé lands on 0900", lineOn(priv, ACC.prive)?.side === "D");

  const tax = entryOf(deriveBankEntry(bankTx({ id: "b-5", amount: -1200, category: "tax" })));
  check("belasting lands on 1800", lineOn(tax, ACC.tax)?.side === "D");

  // A matched line settles a receivable — booking revenue again would double-count.
  const matched = entryOf(deriveBankEntry(bankTx({ id: "b-6", invoice_id: "inv-1", category: "omzet" })));
  check("matched incoming payment hits DEBITEUREN, not revenue",
    lineOn(matched, ACC.debtors)?.side === "C" && lineOn(matched, ACC.revenue) === undefined);
  const matchedOut = entryOf(deriveBankEntry(bankTx({ id: "b-7", amount: -395, invoice_id: "inv-2", category: "kosten" })));
  check("matched outgoing payment hits CREDITEUREN, not costs",
    lineOn(matchedOut, ACC.creditors)?.side === "D" && lineOn(matchedOut, ACC.costs) === undefined);

  check("uncategorised + unmatched → skipped, never guessed",
    isSkip(deriveBankEntry(bankTx({ id: "b-8", category: null, invoice_id: null }))));
  check("unknown category → skipped", isSkip(deriveBankEntry(bankTx({ id: "b-9", category: "iets-nieuws" }))));
  check("zero amount → skipped", isSkip(deriveBankEntry(bankTx({ id: "b-10", amount: 0 }))));
  check("no date → skipped", isSkip(deriveBankEntry(bankTx({ id: "b-11", date: null }))));
}

console.log("\n— cash —");
{
  const sale = entryOf(deriveCashEntry(cash())); // 121,00 incl. 21%
  check("journal K", sale.journal === "K");
  check("balances", isBalanced(sale));
  check("cash debited with the gross", lineOn(sale, ACC.cash)?.side === "D" && lineOn(sale, ACC.cash)?.amountCents === 12100);
  check("revenue credited with the net (100,00)", lineOn(sale, ACC.revenue)?.amountCents === 10000);
  check("btw payable credited (21,00)", lineOn(sale, ACC.btwPayable)?.amountCents === 2100);

  const spend = entryOf(deriveCashEntry(cash({ id: "k-2", direction: "out", category: "kosten", amount: 12.1, btw_rate: 21 })));
  check("cash out → cash CREDITED", lineOn(spend, ACC.cash)?.side === "C");
  check("cost debited, btw reclaimable debited",
    lineOn(spend, ACC.costs)?.side === "D" && lineOn(spend, ACC.btwReclaimable)?.side === "D");
  check("balances", isBalanced(spend));

  const priv = entryOf(deriveCashEntry(cash({ id: "k-3", direction: "out", category: "prive", amount: 50, btw_rate: 21 })));
  check("privé carries NO btw even when a rate is set", lineOn(priv, ACC.btwPayable) === undefined && lineOn(priv, ACC.btwReclaimable) === undefined);
  check("balances", isBalanced(priv));

  const tr = entryOf(deriveCashEntry(cash({ id: "k-4", direction: "out", category: "transfer", amount: 200, btw_rate: 0 })));
  check("transfer books cash against bank", lineOn(tr, ACC.bank)?.side === "D" && lineOn(tr, ACC.cash)?.side === "C");

  // 9% on an odd amount is where a naive split loses a cent.
  const odd = entryOf(deriveCashEntry(cash({ id: "k-5", amount: 123.85, btw_rate: 9 })));
  check("awkward btw split still balances exactly", isBalanced(odd));

  check("no category → skipped", isSkip(deriveCashEntry(cash({ id: "k-6", category: null }))));
  check("no direction → skipped", isSkip(deriveCashEntry(cash({ id: "k-7", direction: null }))));
}

console.log("\n— buildLedger —");
{
  const l = buildLedger({
    invoices: [invoice(), invoice({ id: "inv-2", direction: "incoming", status: "received" }), invoice({ id: "inv-x", status: "draft" })],
    bank: [bankTx(), bankTx({ id: "b-2", amount: -45.5, category: "kosten" }), bankTx({ id: "b-9", category: null })],
    cash: [cash()],
  });
  check("the whole ledger balances", ledgerIsBalanced(l));
  check("control totals agree", l.totals.debitCents === l.totals.creditCents);
  check("line count matches the actual lines", l.totals.lineCount === l.entries.reduce((s, e) => s + e.lines.length, 0));
  check("unbookable rows are reported, not dropped", l.skipped.length === 2);
  check("every skip carries a reason the owner can act on", l.skipped.every((s) => s.reason.length > 10));
  check("only USED accounts are listed", l.accounts.every((a) => l.entries.some((e) => e.lines.some((x) => x.accountId === a.id))));
  check("journals listed are only the ones used", l.journals.every((j) => l.entries.some((e) => e.journal === j.id)));
  check("entries are date-ordered (stable, diffable export)",
    l.entries.every((e, i) => i === 0 || l.entries[i - 1].date <= e.date));

  const again = buildLedger({
    invoices: [invoice({ id: "inv-2", direction: "incoming", status: "received" }), invoice()],
    bank: [bankTx({ id: "b-2", amount: -45.5, category: "kosten" }), bankTx()],
    cash: [cash()],
  });
  check("input order does not change the output (deterministic)",
    JSON.stringify(again.entries) === JSON.stringify(l.entries));

  check("an empty administration yields an empty, balanced ledger",
    ledgerIsBalanced(buildLedger({})) && buildLedger({}).entries.length === 0);
}

console.log("\n— chart of accounts —");
check("account ids are unique", new Set(LEDGER_ACCOUNTS.map((a) => a.id)).size === LEDGER_ACCOUNTS.length);
check("every ACC constant exists in the chart",
  Object.values(ACC).every((id) => LEDGER_ACCOUNTS.some((a) => a.id === id)));
check("every account is typed B or P", LEDGER_ACCOUNTS.every((a) => a.type === "B" || a.type === "P"));

console.log("\n— property sweep: balancing is a rule, not a coincidence —");
{
  // Hand-picked examples prove the cases I thought of. This sweeps the ones I did
  // not: awkward rates, cent-level amounts, every category and direction.
  let seed = 20260810;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const RATES = [0, 9, 21];
  let unbalanced = 0, booked = 0, skipped = 0;

  for (let i = 0; i < 4000; i++) {
    const rate = RATES[Math.floor(rnd() * RATES.length)];
    // Build an invoice the way the app does: a net amount, then btw off it.
    const ex = Math.round(rnd() * 500000) / 100; // 0 … 5000,00
    const btw = Math.round(ex * rate) / 100;
    const inc = Math.round((ex + btw) * 100) / 100;
    const outgoing = rnd() < 0.5;
    const r = deriveInvoiceEntry(invoice({
      id: `f-${i}`,
      direction: outgoing ? "outgoing" : "incoming",
      status: outgoing ? "sent" : "received",
      invoice_type: rnd() < 0.2 ? "creditnota" : "factuur",
      total_ex_btw: ex, btw_amount: btw, total_inc_btw: inc,
    }));
    if (isSkip(r)) { skipped++; continue; }
    booked++;
    if (!isBalanced(r)) { unbalanced++; if (unbalanced < 4) console.log(`    ex=${ex} btw=${btw} inc=${inc}`); }
  }

  const CATS = ["omzet", "kosten", "prive", "transfer"];
  for (let i = 0; i < 4000; i++) {
    const r = deriveCashEntry(cash({
      id: `fc-${i}`,
      direction: rnd() < 0.5 ? "in" : "out",
      category: CATS[Math.floor(rnd() * CATS.length)],
      amount: Math.round(rnd() * 200000) / 100,
      btw_rate: RATES[Math.floor(rnd() * RATES.length)],
    }));
    if (isSkip(r)) { skipped++; continue; }
    booked++;
    if (!isBalanced(r)) unbalanced++;
  }

  check(`${booked} random bookings all balance (0 unbalanced)`, unbalanced === 0);
  check("the sweep actually booked a meaningful number", booked > 5000);

  // And the mirror property: broken input is REFUSED, never booked on a guess.
  let refused = 0, leaked = 0;
  for (let i = 0; i < 2000; i++) {
    const broken = Math.floor(rnd() * 4);
    const r = deriveInvoiceEntry(invoice({
      id: `x-${i}`,
      // 0: totals that genuinely disagree · 1: no direction · 2: not a real booking · 3: no date
      total_ex_btw: broken === 0 ? 100 : 100,
      btw_amount: broken === 0 ? 21 : 21,
      total_inc_btw: broken === 0 ? 500 : 121,
      direction: broken === 1 ? null : "outgoing",
      invoice_type: broken === 2 ? "pro_forma" : "factuur",
      invoice_date: broken === 3 ? null : "2026-08-08",
    }));
    if (isSkip(r)) refused++;
    else { leaked++; if (!isBalanced(r)) unbalanced++; }
  }
  check(`${refused} broken rows were all refused (0 booked on a guess)`, leaked === 0);
  check("still nothing unbalanced anywhere in the sweep", unbalanced === 0);
  void skipped;
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
