// [KASSTELSEL] Pure node test — run: npx tsx src/lib/kas-payment-events.test.ts
// The load-bearing guarantee: the omzet/BTW slices of an invoice, summed over EVERY quarter it
// is paid in, equal the invoice header EXACTLY — to the cent, no rounding drift, no double-count.
import {
  buildSettlementEvents,
  buildQuarterSettlements,
  computeSettlementSlices,
  deriveRate,
  type InvoiceHeader,
  type SettlementRecord,
  type PriorSettled,
  type HeaderWithPaid,
  type RawSettlement,
} from "./kas-payment-events";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// Simulate the real engine: process one quarter's records, threading the unrounded cumulative
// (priorByInvoice + priorInc) forward exactly as compute-result-range will across quarters.
function runQuarter(
  header: InvoiceHeader,
  priorInc: number,
  prior: Map<string, PriorSettled>,
  records: SettlementRecord[],
) {
  const events = buildSettlementEvents(header, priorInc, records);
  const slices = computeSettlementSlices(events, prior);
  const ex = slices.reduce((s, x) => s + x.ex, 0);
  const btw = slices.reduce((s, x) => s + x.btw, 0);
  const nextPrior = new Map(prior);
  nextPrior.set(header.invoiceId, {
    ex: (prior.get(header.invoiceId)?.ex ?? 0) + ex,
    btw: (prior.get(header.invoiceId)?.btw ?? 0) + btw,
  });
  const nextInc = priorInc + records.reduce((s, r) => s + r.amountApplied, 0);
  return { events, slices, ex, btw, nextPrior, nextInc };
}

const H = (over: Partial<InvoiceHeader> = {}): InvoiceHeader => ({
  invoiceId: "inv1", direction: "outgoing", totalEx: 1000, totalBtw: 210, totalInc: 1210, ...over,
});
const rec = (payDate: string, amountApplied: number, estimated = false): SettlementRecord => ({ payDate, amountApplied, estimated });

console.log("\n— single full payment in one quarter —");
{
  const q = runQuarter(H(), 0, new Map(), [rec("2026-02-10", 1210)]);
  check("closes the invoice", q.events[0].closesInvoice === true);
  check("ex slice = 1000", near(q.ex, 1000));
  check("btw slice = 210", near(q.btw, 210));
}

console.log("\n— 2-quarter 50/50 partial, to the cent (F10/S1) —");
{
  const h = H();
  const q1 = runQuarter(h, 0, new Map(), [rec("2026-02-10", 605)]);
  check("Q1 does NOT close", q1.events[0].closesInvoice === false);
  check("Q1 ex = 500, btw = 105", near(q1.ex, 500) && near(q1.btw, 105));
  const q2 = runQuarter(h, q1.nextInc, q1.nextPrior, [rec("2026-05-10", 605)]);
  check("Q2 closes", q2.events[0].closesInvoice === true);
  check("Q2 ex = 500, btw = 105", near(q2.ex, 500) && near(q2.btw, 105));
  check("Σ ex over both quarters = header 1000 EXACTLY", q1.ex + q2.ex === 1000);
  check("Σ btw over both quarters = header 210 EXACTLY", q1.btw + q2.btw === 210);
}

console.log("\n— 3-quarter uneven split with rounding, no cent leak (S2) —");
{
  const h = H(); // 1000 / 210 / 1210
  const q1 = runQuarter(h, 0, new Map(), [rec("2026-02-01", 403.33)]);
  const q2 = runQuarter(h, q1.nextInc, q1.nextPrior, [rec("2026-05-01", 403.33)]);
  const q3 = runQuarter(h, q2.nextInc, q2.nextPrior, [rec("2026-08-01", 403.34)]);
  check("Q3 closes (cumulative reaches header)", q3.events[0].closesInvoice === true);
  check("Σ ex = 1000 EXACTLY (remainder absorbs the drift)", q1.ex + q2.ex + q3.ex === 1000);
  check("Σ btw = 210 EXACTLY", q1.btw + q2.btw + q3.btw === 210);
}

console.log("\n— cross-quarter remainder never re-books prior slices (F1 headline) —");
{
  // Q1 pays 900 of 1210; Q2 pays the remaining 310 and closes. The Q2 remainder must be
  // header − prior, NOT header − (in-window only), or Q2 would over-count the first 900.
  const h = H();
  const q1 = runQuarter(h, 0, new Map(), [rec("2026-03-01", 900)]);
  const q2 = runQuarter(h, q1.nextInc, q1.nextPrior, [rec("2026-06-01", 310)]);
  check("Q1 ex ≈ 743.80 (900/1210×1000)", near(q1.ex, 900 / 1210 * 1000));
  check("Q2 ex = header − Q1 (no re-book)", near(q2.ex, 1000 - q1.ex));
  check("Σ ex = 1000 EXACTLY", q1.ex + q2.ex === 1000);
  check("Σ btw = 210 EXACTLY", q1.btw + q2.btw === 210);
}

console.log("\n— invoice still OPEN at quarter end books only its proportional share —");
{
  const h = H();
  const q1 = runQuarter(h, 0, new Map(), [rec("2026-02-10", 605)]); // half, never closed here
  check("open partial does not close", q1.events[0].closesInvoice === false);
  check("books only the paid half (ex 500), not the full 1000", near(q1.ex, 500));
}

console.log("\n— creditnota: negative header nets via a negative slice at the real rate —");
{
  const cn = H({ invoiceId: "cn1", totalEx: -100, totalBtw: -21, totalInc: -121 });
  const q = runQuarter(cn, 0, new Map(), [rec("2026-04-15", -121)]);
  check("creditnota refund closes", q.events[0].closesInvoice === true);
  check("ex slice = −100 (nets omzet down)", near(q.ex, -100));
  check("btw slice = −21", near(q.btw, -21));
  check("rate derived as 21% (so it nets rubriek 1a, not 1e)", q.slices[0].rate === 21);
}

console.log("\n— deriveRate —");
{
  check("1000/210 → 21", deriveRate(1000, 210) === 21);
  check("1000/90 → 9", deriveRate(1000, 90) === 9);
  check("1000/0 → 0", deriveRate(1000, 0) === 0);
  check("0 ex → 0 (no divide)", deriveRate(0, 0) === 0);
  check("negative header still derives 21", deriveRate(-100, -21) === 21);
}

console.log("\n— date ordering is applied inside computeSettlementSlices —");
{
  // Feed events out of order; the closing (later) event must still book the remainder correctly.
  const h = H();
  const events = buildSettlementEvents(h, 0, [rec("2026-02-01", 605), rec("2026-05-01", 605)]);
  const shuffled = [events[1], events[0]]; // reversed
  const slices = computeSettlementSlices(shuffled, new Map());
  const total = slices.reduce((s, x) => s + x.ex, 0);
  check("Σ ex = 1000 regardless of input order", total === 1000);
}

console.log("\n— buildQuarterSettlements: prior/in-window split + undated detection —");
{
  const hdrMap = (over: Partial<HeaderWithPaid> = {}) => {
    const h: HeaderWithPaid = { invoiceId: "inv1", direction: "outgoing", totalEx: 1000, totalBtw: 210, totalInc: 1210, amountPaidMagnitude: 1210, ...over };
    return new Map([[h.invoiceId, h]]);
  };
  const raw = (over: Partial<RawSettlement> = {}): RawSettlement => ({ invoiceId: "inv1", payDate: "2026-05-01", magnitude: 1210, estimated: false, ...over });
  const Q2 = ["2026-04-01", "2026-06-30"] as const;

  // fully paid in-window
  {
    const q = buildQuarterSettlements(hdrMap(), [raw()], ...Q2);
    check("full in-window → 1 event, closes", q.events.length === 1 && q.events[0].closesInvoice === true);
    check("no prior, no undated", q.priorByInvoice.size === 0 && q.undatedPaidCount === 0);
  }
  // partial Q1 (prior) + closing Q2 (in-window)
  {
    const q = buildQuarterSettlements(hdrMap(), [raw({ payDate: "2026-03-01", magnitude: 605 }), raw({ payDate: "2026-05-01", magnitude: 605 })], ...Q2);
    check("in-window event closes (cumulative reaches header)", q.events.length === 1 && q.events[0].closesInvoice === true);
    check("priorByInvoice carries Q1's unrounded 500 ex", near(q.priorByInvoice.get("inv1")!.ex, 500));
    check("priorByInvoice carries Q1's 105 btw", near(q.priorByInvoice.get("inv1")!.btw, 105));
  }
  // fully paid in a PRIOR quarter → nothing this quarter
  {
    const q = buildQuarterSettlements(hdrMap(), [raw({ payDate: "2026-02-01", magnitude: 1210 })], ...Q2);
    check("prior-only invoice contributes NO in-window events", q.events.length === 0);
    check("no undated (dated total == amount paid)", q.undatedPaidCount === 0);
  }
  // undated paid money: 605 dated by bank, 605 more marked paid with NO date
  {
    const q = buildQuarterSettlements(hdrMap({ amountPaidMagnitude: 1210 }), [raw({ payDate: "2026-05-01", magnitude: 605 })], ...Q2);
    check("paid beyond the dated total → undatedPaidCount 1 (never silently under-declared)", q.undatedPaidCount === 1);
  }
  // an explicitly undated row (payDate null)
  {
    const q = buildQuarterSettlements(hdrMap({ amountPaidMagnitude: 1210 }), [raw({ payDate: null, magnitude: 1210 })], ...Q2);
    check("null-date settlement → undatedPaidCount 1, no events", q.undatedPaidCount === 1 && q.events.length === 0);
  }
  // estimated date (marked_paid_at)
  {
    const q = buildQuarterSettlements(hdrMap(), [raw({ estimated: true })], ...Q2);
    check("estimated in-window date → estimatedCount 1", q.estimatedCount === 1);
  }
  // rows for an unknown invoice are ignored
  {
    const q = buildQuarterSettlements(hdrMap(), [raw({ invoiceId: "other", magnitude: 999 })], ...Q2);
    check("unknown-invoice rows ignored", q.events.length === 0 && q.undatedPaidCount === 0);
  }
  // creditnota (negative header) → signed-negative in-window event
  {
    const cnMap = hdrMap({ invoiceId: "cn1", totalEx: -100, totalBtw: -21, totalInc: -121, amountPaidMagnitude: 121 });
    const q = buildQuarterSettlements(cnMap, [{ invoiceId: "cn1", payDate: "2026-05-02", magnitude: 121, estimated: false }], ...Q2);
    check("creditnota event amountApplied is negative", q.events[0].amountApplied === -121);
    const slices = computeSettlementSlices(q.events, q.priorByInvoice);
    check("creditnota slice nets omzet −100", near(slices[0].ex, -100));
  }
  // [REVIEW-FIX D1] an invoice paid in a LATER quarter must NOT be flagged undated when computing
  // THIS (earlier) quarter — it's dated, just future. Else every closed quarter falsely un-klaars.
  {
    const q = buildQuarterSettlements(hdrMap({ amountPaidMagnitude: 1210 }), [raw({ payDate: "2026-08-01", magnitude: 1210 })], ...Q2);
    check("future-paid (Q3) → NOT undated when computing Q2", q.undatedPaidCount === 0);
    check("future-paid → no in-window events this quarter", q.events.length === 0);
  }
}

console.log("\n— [REVIEW-FIX D2] overpayment / duplicate settlement never over-declares —");
{
  const h = H(); // 1000 / 210 / 1210
  // Customer double-pays: two records [1210 (closes), 100 (extra)] in one quarter.
  const events = buildSettlementEvents(h, 0, [{ payDate: "2026-02-10", amountApplied: 1210, estimated: false }, { payDate: "2026-02-20", amountApplied: 100, estimated: false }]);
  const slices = computeSettlementSlices(events, new Map());
  const ex = slices.reduce((s, x) => s + x.ex, 0);
  const btw = slices.reduce((s, x) => s + x.btw, 0);
  check("overpayment: Σ ex capped at header 1000 (not 1082.64)", ex === 1000);
  check("overpayment: Σ btw capped at header 210 (not 227.36)", btw === 210);
}
{
  // Cross-quarter: invoice closed in Q1 (prior = full header), an extra duplicate record in Q2.
  const h = H();
  const priorClosed = new Map([[h.invoiceId, { ex: 1000, btw: 210 }]]);
  const q2events = buildSettlementEvents(h, 1210, [{ payDate: "2026-05-01", amountApplied: 100, estimated: false }]);
  const slices = computeSettlementSlices(q2events, priorClosed);
  check("already-closed invoice: a later duplicate books 0 ex", near(slices[0].ex, 0));
  check("already-closed invoice: a later duplicate books 0 btw", near(slices[0].btw, 0));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
