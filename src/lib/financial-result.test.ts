// [RESULT] Pure node test — run: npx tsx src/lib/financial-result.test.ts
import {
  computeResult,
  toResultBankTx,
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

console.log("\n— [SIGN] a refund keeps its sign (not abs'd into fabricated revenue/cost) —");
{
  const bank: ResultBankTx[] = [
    { amount: 1000, category: "omzet", invoice_id: null },   // card takings → +1000 omzet
    { amount: -150, category: "omzet", invoice_id: null },   // card REFUND → must REDUCE omzet by 150
    { amount: -200, category: "kosten", invoice_id: null },  // normal expense → +200 kosten
    { amount: 50, category: "kosten", invoice_id: null },    // supplier REFUND (credit) → REDUCES kosten by 50
  ];
  const r = computeResult([], bank, []);
  check("refund reduces omzet (1000 − 150 = 850), not 1150", r.omzet === 850);
  check("supplier refund reduces kosten (200 − 50 = 150), not 250", r.kosten === 150);
  check("negative omzet does not inflate the zonder-tarief nudge", r.cashOmzetZonderBtw === 1000);
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
  // The uncovered €800 pos_income is real revenue with NO BTW rate → it must be flagged
  // (blocks readiness), exactly like the €50 unrated cash. Silently zero-rating it was the
  // HIGH money-truth bug. Total no-rate omzet = 800 (bank) + 50 (cash) = 850.
  check("bank omzet without rate is flagged too (not just cash)", r.cashOmzetZonderBtw === 850);
}

console.log("\n— [BTW-TRUTH] bank omzet without a rate must not silently declare €0 BTW —");
{
  // A plain 'omzet' bank credit and an uncovered pos_income line: both revenue, no rate.
  const bank: ResultBankTx[] = [
    { amount: 1210, category: "omzet", invoice_id: null },
    { amount: 605, category: "pos_income", invoice_id: null, settleDate: "2026-06-30", settleExact: true },
  ];
  const r = computeResult([], bank, []);
  check("counted in omzet", near(r.omzet, 1815));
  check("no invented BTW (btwVerschuldigd 0, salesByRate empty)",
    r.btwVerschuldigd === 0 && r.salesByRate.length === 0);
  check("BUT surfaced as omzet-zonder-tarief (blocks readiness)", near(r.cashOmzetZonderBtw, 1815));
}

console.log("\n— [SETTLE-LAG] fallback booking date reconciles to Z-report via backward window —");
{
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-04-06", // Monday: the takings day
    base_0: 0, base_9: 0, base_21: 1000, btw_9: 0, btw_21: 210,
    total_incl: 1210, pin_amount: 1210, cash_amount: 0, other_amount: 0,
  }];
  // Bank omitted DAT. → settleDate is the booking date (Apr 8, T+2), settleExact false.
  const bankFallback: ResultBankTx[] = [
    { amount: 1210, category: "pos_income", invoice_id: null, settleDate: "2026-04-08", settleExact: false },
  ];
  const rf = computeResult([], bankFallback, [], turnover);
  check("fallback booking date (T+2) is reconciled to the Z-report day → not double-counted",
    near(rf.omzet, 1000) && rf.cashOmzetZonderBtw === 0);

  // An EXACT takings date that ISN'T covered must still count (never hidden by the window).
  const bankExactUncovered: ResultBankTx[] = [
    { amount: 300, category: "pos_income", invoice_id: null, settleDate: "2026-04-07", settleExact: true },
  ];
  const re = computeResult([], bankExactUncovered, [], turnover);
  check("exact takings date not in covered → counts (window never hides exact-dated revenue)",
    near(re.omzet, 1000 + 300) && near(re.cashOmzetZonderBtw, 300));

  // A fallback booking date with NO covered day within the lag window → still real revenue.
  const bankFarFallback: ResultBankTx[] = [
    { amount: 400, category: "pos_income", invoice_id: null, settleDate: "2026-04-20", settleExact: false },
  ];
  const rff = computeResult([], bankFarFallback, [], turnover);
  check("fallback booking date beyond the lag window → counts (not silently suppressed)",
    near(rff.omzet, 1000 + 400) && near(rff.cashOmzetZonderBtw, 400));
}

console.log("\n— [FINDING-1] an acquirer payout MIS-TAPPED as 'omzet' on a covered day must NOT double-count —");
{
  // The R&D audit's HIGH bug: a Rabo OmniKassa / Worldline / Nets payout the auto-classifier
  // missed → sign-fallback 'omzet' → the owner confirms 'omzet'. On a covered till day the
  // till already counted those takings once; the old de-dup (keyed on the literal category
  // "pos_income") let this 'omzet' line add a SECOND helping. Now toResultBankTx recognises the
  // acquirer NAME and flags it as a settlement, so computeResult treats it as a covered witness.
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-07-03",
    base_0: 0, base_9: 0, base_21: 2113, btw_9: 0, btw_21: 190,
    total_incl: 2303.10, pin_amount: 2086.65, cash_amount: 216.45, other_amount: 0,
  }];
  // Owner (mis)categorised the OmniKassa payout as plain 'omzet'. Booked next day (T+1).
  const rawMisTap = { amount: 2080, category: "omzet", invoice_id: null, date: "2026-07-04", description: "Rabo OmniKassa afrekening periode" };
  const mapped = toResultBankTx(rawMisTap);
  check("toResultBankTx flags an acquirer-named CREDIT as a settlement even when category='omzet'", mapped.posSettlement === true);
  check("… and derives a settleDate (booking-date fallback) for the covered-day check", mapped.settleDate === "2026-07-04");
  const rMis = computeResult([], [mapped], [], turnover);
  check("covered-day OmniKassa 'omzet' payout is a witness → omzet = till net only (2113, NOT ~4193)", near(rMis.omzet, 2113));

  // A genuine NON-acquirer bank 'omzet' on a covered day (e.g. a webshop transfer that never
  // went through the till) has NO acquirer name → NOT a settlement → it must still COUNT, so
  // real off-till revenue is never hidden.
  const rawWebshop = { amount: 500, category: "omzet", invoice_id: null, date: "2026-07-03", description: "overboeking webshop bestelling 8842" };
  const mappedWebshop = toResultBankTx(rawWebshop);
  check("a non-acquirer 'omzet' credit is NOT flagged as a settlement", mappedWebshop.posSettlement === false);
  const rShop = computeResult([], [mappedWebshop], [], turnover);
  check("… so genuine off-till revenue on a covered day still counts (2113 + 500)", near(rShop.omzet, 2113 + 500));

  // An acquirer-named DEBIT (a purchase AT a terminal) is not income → never a settlement.
  const mappedDebit = toResultBankTx({ amount: -12.5, category: "kosten", invoice_id: null, date: "2026-07-03", description: "betaalautomaat CCV bloemen" });
  check("an acquirer-named DEBIT is not a settlement (it's a purchase)", mappedDebit.posSettlement === false);

  // The acquirer name often lives in counterpart_name, not description — the mapper must see it,
  // else a mis-tapped 'omzet' payout would still double-count (adversarial review LOW #7/#8).
  const cpOnly = toResultBankTx({ amount: 900, category: "omzet", invoice_id: null, date: "2026-07-03", description: "afrekening", counterpart_name: "Worldline" });
  check("acquirer name in counterpart_name (not description) still flags a settlement", cpOnly.posSettlement === true);
}

console.log("\n— [CARD-BUDGET] suppression is bounded by pin_amount, so off-till (webshop) revenue is never hidden —");
{
  // The adversarial review's HIGH: an omnichannel store (physical till + webshop via the same
  // PSP). Covered day pin €545; a Buckaroo payout of €800 arrives, tapped 'omzet'. Suppressing
  // the WHOLE €800 would hide €255 of real off-till revenue. The budget suppresses only up to
  // pin_amount; the €255 excess counts and is flagged.
  const turnover: DailyTurnover[] = [{
    turnover_date: "2026-07-06",
    base_0: 0, base_9: 0, base_21: 500, btw_9: 0, btw_21: 105,
    total_incl: 605, pin_amount: 545, cash_amount: 60, other_amount: 0,
  }];
  const buckaroo = toResultBankTx({ amount: 800, category: "omzet", invoice_id: null, date: "2026-07-06", description: "Buckaroo uitbetaling webshop" });
  const r = computeResult([], [buckaroo], [], turnover);
  check("only pin_amount (545) is suppressed; the €255 excess counts (till net 500 + 255)", near(r.omzet, 500 + 255));
  check("the excess is flagged as omzet-zonder-tarief (blocks readiness, no false 'klaar')", near(r.cashOmzetZonderBtw, 255));

  // When the till's OWN card settlement also appears, it consumes the budget and the full
  // webshop payout counts — the reconciliation self-corrects and the total is order-independent.
  const terminal = toResultBankTx({ amount: 545, category: "pos_income", invoice_id: null, date: "2026-07-06", description: "CCV afrek. transacties DAT. 20260706" });
  const rBoth = computeResult([], [terminal, buckaroo], [], turnover);
  const rBothRev = computeResult([], [buckaroo, terminal], [], turnover);
  check("terminal (545) + webshop (800): budget consumed by the terminal → full webshop counts (500 + 800)", near(rBoth.omzet, 500 + 800));
  check("… and the result is independent of statement order", near(rBoth.omzet, rBothRev.omzet));

  // A pos_income line that itself exceeds the day's pin (terminal paid out more than the till
  // rang, or a webshop settling via the terminal PSP) → the excess is not hidden.
  const bigPos: ResultBankTx[] = [{ amount: 700, category: "pos_income", invoice_id: null, settleDate: "2026-07-06", settleExact: true }];
  const rBig = computeResult([], bigPos, [], turnover);
  check("pos_income above pin (700 vs 545) → €155 excess counts, not hidden", near(rBig.omzet, 500 + 155));
}

console.log("\n— [FINDING-2] SETTLE_LAG widened to 5 days: a DAT-less T+5 payout still reconciles —");
{
  // A Jun 30 (Q2) sale whose DAT-less payout posts Jul 5 (T+5, over a long weekend + holiday),
  // booked into Q3. Q3's revenue array has no Jun 30 row, but the caller's −5-day covered
  // buffer includes it. With the OLD lag=3 the backward window reached only Jul 2 → the payout
  // was NOT matched → the till's already-counted €900 was booked a SECOND time in Q3. lag=5
  // reaches Jun 30 and suppresses it.
  const bankT5: ResultBankTx[] = [
    { amount: 1089, category: "pos_income", invoice_id: null, settleDate: "2026-07-05", settleExact: false },
  ];
  const covered = new Set(["2026-06-30"]);
  const r = computeResult([], bankT5, [], [], covered);
  check("T+5 DAT-less payout reconciles to the covered Z-report day → not re-counted in the new quarter",
    r.omzet === 0 && r.cashOmzetZonderBtw === 0);

  // A T+6 payout is beyond the 5-day window (and the 5-day buffer) → it is NOT suppressed and
  // counts as real revenue rather than being silently hidden.
  const bankT6: ResultBankTx[] = [
    { amount: 500, category: "pos_income", invoice_id: null, settleDate: "2026-07-06", settleExact: false },
  ];
  const r6 = computeResult([], bankT6, [], [], covered);
  check("T+6 (beyond the window) counts as revenue → never silently hidden", near(r6.omzet, 500));
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

console.log("\n— [FIN-5] a turnover day whose rate columns didn't import is not lost —");
{
  // A broken Z-report import: gross printed (total_incl 2000) but the per-rate bases are 0
  // (the normalizer couldn't split it). Old behavior: omzet += 0, 5a += 0 → revenue vanishes
  // and the day slips past the readiness gate. New: the unaccounted gross is recovered as
  // revenue AND flagged as omzet-zonder-tarief so a rate must be assigned before filing.
  const broken: DailyTurnover[] = [{
    turnover_date: "2026-07-05", base_0: 0, base_9: 0, base_21: 0, btw_9: 0, btw_21: 0,
    total_incl: 2000, pin_amount: 1500, cash_amount: 500, other_amount: 0,
  }];
  const r = computeResult([], [], [], broken);
  check("the €2000 gross is NOT lost (counted in omzet)", near(r.omzet, 2000));
  check("it is flagged as omzet-zonder-tarief (blocks readiness)", near(r.cashOmzetZonderBtw, 2000));
  check("5a stays honest — no invented BTW on the unrated day", near(r.btwVerschuldigd, 0));

  // A well-formed day still reconciles exactly — no false 'unrated' trigger from rounding.
  const clean: DailyTurnover[] = [{
    turnover_date: "2026-07-06", base_0: 0, base_9: 1000, base_21: 0, btw_9: 90, btw_21: 0,
    total_incl: 1090, pin_amount: 1090, cash_amount: 0, other_amount: 0,
  }];
  const rc = computeResult([], [], [], clean);
  check("a reconciling day adds nothing to the no-rate flag", near(rc.cashOmzetZonderBtw, 0));
  check("a reconciling day's omzet is exactly its net (1000)", near(rc.omzet, 1000));
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
