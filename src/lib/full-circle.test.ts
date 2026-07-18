// [FULL-CIRCLE] End-to-end money reconciliation for ONE realistic retail quarter.
//
// This is the objective proof of the "automatic financial-truth" claim: a single Q2 that touches
// EVERY channel a shop actually uses — outgoing invoices (paid + still open), a credit-note refund,
// incoming purchase invoices (voorbelasting), a card/till day + a cash-sale day (dagomzet), the
// bank's card payouts (pos_income), a bank line that PAYS an invoice, and the card terminal (EFT) —
// run through the SAME kernel + shared mapper the live app uses, then checked that:
//   1. every headline figure equals a hand-computed expected value (to the cent),
//   2. the per-rate BTW sums EXACTLY to btwVerschuldigd (no rounding drift),
//   3. the concept aangifte closes: 5a − 5b = 5g,
//   4. NOTHING double-counts — the card payout, the invoice-payment line, and the settled till day
//      each add revenue exactly ONCE,
//   5. the result is deterministic and order-independent (shuffling the bank lines changes nothing).
//
// Run: npx tsx src/lib/full-circle.test.ts

import {
  computeResult,
  toResultBankTx,
  cardBudgetBound,
  type ResultInvoice,
  type ResultCashEntry,
  type RawBankRow,
} from "./financial-result";
import { buildAangifte, type AangifteCompleteness } from "./aangifte";
import { reconcileTriangle, bankNetByDay } from "./triangle";
import type { DailyTurnover } from "./turnover";
import type { EftSettlement } from "./eft-parser";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

// ── The quarter: Q2 2026 (01-04 … 30-06) ──────────────────────────────────────
// Outgoing sales (accrual — count on invoice date regardless of payment):
//   INV1 paid    ex 1000 + 21% → sale
//   INV2 sent    ex 2000 + 21% → open sale (still counts on accrual)
//   CN1  sent    ex −500 − 21% → a credit-note refund (reduces omzet)
const invoices: ResultInvoice[] = [
  { direction: "outgoing", status: "paid", total_ex_btw: 1000, btw_amount: 210 },
  { direction: "outgoing", status: "sent", total_ex_btw: 2000, btw_amount: 420 },
  { direction: "outgoing", status: "sent", total_ex_btw: -500, btw_amount: -105 }, // creditnota
  // Incoming purchases (voorbelasting):
  { direction: "incoming", status: "received", total_ex_btw: 800, btw_amount: 168 }, // 21%
  { direction: "incoming", status: "paid", total_ex_btw: 1000, btw_amount: 90 },     // 9%
  // Noise that must be IGNORED (unverified / draft):
  { direction: "outgoing", status: "processing", total_ex_btw: 9999, btw_amount: 2099 },
  { direction: "incoming", status: "draft", total_ex_btw: 7777, btw_amount: 1632 },
];

// Till (dagomzet): a 21% card day and a 9% card day.
const turnover: DailyTurnover[] = [
  { turnover_date: "2026-05-10", base_0: 0, base_9: 0, base_21: 1000, btw_9: 0, btw_21: 210, total_incl: 1210, pin_amount: 1210, cash_amount: 0, other_amount: 0 },
  { turnover_date: "2026-05-11", base_0: 0, base_9: 500, base_21: 0, btw_9: 45, btw_21: 0, total_incl: 545, pin_amount: 545, cash_amount: 0, other_amount: 0 },
];
const coveredDates = new Set(turnover.map((t) => t.turnover_date));
const coveredBudget = new Map(turnover.map((t) => [t.turnover_date, cardBudgetBound(t)] as const));

// A rated cash sale (dagomzet's cash sibling): €121 incl 21% → net 100.
const cash: ResultCashEntry[] = [
  { direction: "in", amount: 121, category: "omzet", btw_rate: 21, date: "2026-05-12" },
];

// Bank lines (raw rows → the SAME toResultBankTx mapper the routes use):
//   POS1/POS2 — the acquirer paying out the two till days. Their takings were ALREADY counted by
//               the till → must be suppressed (no second helping of revenue).
//   PAY1      — a customer paying INV1. invoice_id set → the sale was already counted on accrual,
//               so this line adds nothing (no double-count of the invoice).
const rawBank: RawBankRow[] = [
  { amount: 1210, category: "pos_income", invoice_id: null, date: "2026-05-10", description: "BEA card payout", counterpart_name: "CCV" },
  { amount: 545, category: "pos_income", invoice_id: null, date: "2026-05-11", description: "BEA card payout", counterpart_name: "CCV" },
  { amount: 1210, category: "omzet", invoice_id: "INV1", date: "2026-05-20", description: "overboeking klant" },
];
const bank = rawBank.map(toResultBankTx);

// commissionToBook: the card terminal (EFT) reconciled against the bank payout. Here the payout
// equals the terminal gross (no fee) → commission 0. (A fee case is asserted separately below.)
const result = computeResult(invoices, bank, cash, turnover, coveredDates, 0, coveredBudget);

console.log("\n— headline figures reconcile to the hand-computed truth —");
// omzet: outgoing invoices 3000 − 500 (CN) = 2500; till 1500; cash 100 = 4100. POS + PAY add 0.
check("omzet = 4100 (invoices 2500 + till 1500 + cash 100, card/payment add nothing)", near(result.omzet, 4100));
check("kosten = 1800 (purchases 800 + 1000, no commission)", near(result.kosten, 1800));
check("resultaat = 2300 (4100 − 1800)", near(result.resultaat, 2300));
check("btwVerschuldigd = 801 (21%: 525+210+21, 9%: 45)", near(result.btwVerschuldigd, 801));
check("btwVoorbelasting = 258 (168 + 90)", near(result.btwVoorbelasting, 258));
check("btwSaldo = 543 (801 − 258)", near(result.btwSaldo, 543));
check("nothing is unrated — cashOmzetZonderBtw = 0", near(result.cashOmzetZonderBtw, 0));

console.log("\n— per-rate BTW sums EXACTLY to btwVerschuldigd (no drift) —");
const rate21 = result.salesByRate.find((b) => b.rate === 21);
const rate9 = result.salesByRate.find((b) => b.rate === 9);
check("21% bucket: omzet 3600, btw 756", !!rate21 && near(rate21.omzet, 3600) && near(rate21.btw, 756));
check("9% bucket: omzet 500, btw 45", !!rate9 && near(rate9.omzet, 500) && near(rate9.btw, 45));
check("Σ salesByRate.btw === btwVerschuldigd",
  near(result.salesByRate.reduce((s, b) => s + b.btw, 0), result.btwVerschuldigd));
check("Σ salesByRate.omzet === omzet",
  near(result.salesByRate.reduce((s, b) => s + b.omzet, 0), result.omzet));

console.log("\n— the concept aangifte closes: 5a − 5b = 5g —");
const completeness: AangifteCompleteness = {
  turnoverDays: turnover.length, quarterDays: 91,
  incomingInvoiceCount: 2, outgoingInvoiceCount: 3, hasEuPurchase: false,
};
const aangifte = buildAangifte(result, completeness, "Q2 2026");
check("5a verschuldigd = 801", near(aangifte.verschuldigd, 801));
check("5b voorbelasting = 258", near(aangifte.voorbelasting, 258));
check("5g saldo = 543", near(aangifte.saldo, 543));
check("aangifte closes: verschuldigd − voorbelasting === saldo",
  near(aangifte.verschuldigd - aangifte.voorbelasting, aangifte.saldo));

console.log("\n— NOTHING double-counts (remove-a-channel deltas) —");
// Remove the card payouts + the invoice-payment line → omzet must be UNCHANGED (they add nothing).
const noBank = computeResult(invoices, [], cash, turnover, coveredDates, 0, coveredBudget);
check("dropping the card payouts + invoice-payment leaves omzet unchanged (no double-count)",
  near(noBank.omzet, result.omzet));
// The card payouts on covered days add EXACTLY 0: the till already counted those takings, so
// removing just the payouts (keeping the till + the invoice-payment line) leaves omzet unchanged.
const noPayouts = computeResult(invoices, [bank[2]], cash, turnover, coveredDates, 0, coveredBudget);
check("the card payouts on covered days add exactly 0 (the till already counted them)",
  near(noPayouts.omzet, result.omzet));
// And money is conserved when the channel SUBSTITUTES: drop the till and the same card takings are
// still counted once — now via the payouts as omzet-zonder-tarief — so omzet never silently drops
// to just the invoices+cash (2600); the card revenue is never lost.
const noTill = computeResult(invoices, bank, cash, [], new Set(), 0, new Map());
check("dropping the till doesn't lose the card revenue — it moves to the payouts (omzet stays > 2600)",
  noTill.omzet > 2600 + 0.005);
// Remove the creditnota → omzet RISES by exactly 500 (the refund really reduced omzet).
const noCredit = computeResult(invoices.filter((i) => (i.total_ex_btw ?? 0) >= 0), bank, cash, turnover, coveredDates, 0, coveredBudget);
check("the credit-note refund reduces omzet by exactly 500", near(noCredit.omzet - result.omzet, 500));

console.log("\n— deterministic + order-independent —");
const again = computeResult(invoices, bank, cash, turnover, coveredDates, 0, coveredBudget);
check("same inputs → identical omzet/kosten/btwSaldo",
  near(again.omzet, result.omzet) && near(again.kosten, result.kosten) && near(again.btwSaldo, result.btwSaldo));
const shuffled = computeResult(invoices, [bank[2], bank[0], bank[1]], cash, turnover, coveredDates, 0, coveredBudget);
check("shuffling the bank lines changes nothing", near(shuffled.omzet, result.omzet) && near(shuffled.btwSaldo, result.btwSaldo));

console.log("\n— the card triangle books the acquirer fee ONCE (and only in kosten) —");
// Terminal gross 1210 on 05-10; bank paid out 1200 net → €10 commission. Booked as a BTW-free cost.
const eft: EftSettlement[] = [
  { terminalId: "T1", periodNr: 1, shiftNr: null, periodStart: null, periodEnd: null, firstTrx: null, lastTrx: null,
    settlementDate: "2026-05-10", grossTotal: 1210, txCount: 10, byScheme: [] as unknown as EftSettlement["byScheme"] },
];
const feePos: RawBankRow[] = [{ amount: 1200, category: "pos_income", invoice_id: null, date: "2026-05-10", description: "BEA card payout", counterpart_name: "CCV" }];
const net = bankNetByDay(feePos.map((b) => ({ description: b.description, amount: b.amount, date: b.date })));
const tri = reconcileTriangle({ turnover: [turnover[0]], eftSettlements: eft, bankNetByDay: net });
check("triangle commission = 10 (1210 gross − 1200 net)", near(tri.totalCommission, 10));
const withFee = computeResult(invoices, feePos.map(toResultBankTx), [], [turnover[0]],
  new Set(["2026-05-10"]), tri.totalCommission, new Map([["2026-05-10", cardBudgetBound(turnover[0])]]));
const withoutFee = computeResult(invoices, feePos.map(toResultBankTx), [], [turnover[0]],
  new Set(["2026-05-10"]), 0, new Map([["2026-05-10", cardBudgetBound(turnover[0])]]));
check("booking the €10 commission raises kosten by exactly 10 and leaves omzet + BTW untouched",
  near(withFee.kosten - withoutFee.kosten, 10) && near(withFee.omzet, withoutFee.omzet) && near(withFee.btwVerschuldigd, withoutFee.btwVerschuldigd));

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
