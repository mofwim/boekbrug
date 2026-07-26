// [BANK-BATCH-RECONCILE] Pure node test — run: npx tsx src/lib/bank-batch-reconcile.test.ts
import { reconcileBatch, countResolvedReferences, planBatchAutoConfirm, type BatchSlotInput, type BatchCandidateInvoice } from "./bank-batch-reconcile";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const slot = (refNum: string, amount: number | null, isConfirmed = false): BatchSlotInput =>
  ({ refNum, amount, isConfirmed });

console.log("\n— the real M.H. BAL case: 3 invoices sum to the debit —");
{
  // −€2.902,60 debit; three matched invoices that add up exactly.
  const r = reconcileBatch(
    [slot("262627", 900.00), slot("262744", 1002.60), slot("262762", 1000.00)],
    -2902.60,
  );
  check("status = ties", r.status === "ties");
  check("allMatched", r.allMatched === true);
  check("matchedCount = 3", r.matchedCount === 3);
  check("total = 2902.60", Math.abs(r.total - 2902.60) < 0.005);
  check("bankAmount is the magnitude of the debit", r.bankAmount === 2902.60);
  check("diff ≈ 0", Math.abs(r.diff) < 0.005);
}

console.log("\n— a batch that does NOT add up is a mismatch, never a false tie —");
{
  // Two invoices found, both matched, but they sum to 1900 ≠ 2902.60 debit.
  const r = reconcileBatch([slot("A", 900), slot("B", 1000)], -1900.01);
  check("status = mismatch (sum 1900 vs 1900.01)", r.status === "mismatch");
  check("allMatched true (both have amounts)", r.allMatched === true);
  check("diff is reported (−0.01)", Math.abs(r.diff - -0.01) < 0.005);
}

console.log("\n— a missing invoice ⇒ incomplete, sum is not asserted —");
{
  // Third number has no invoice in the system yet (amount null) → cannot claim a tie
  // even though the two known amounts happen to sit under the debit.
  const r = reconcileBatch(
    [slot("262627", 900), slot("262744", 1002.60), slot("262762", null)],
    -2902.60,
  );
  check("status = incomplete", r.status === "incomplete");
  check("allMatched = false", r.allMatched === false);
  check("matchedCount = 2 of 3", r.matchedCount === 2 && r.slotCount === 3);
}

console.log("\n— a lone matched slot equal to the debit still ties —");
{
  const r = reconcileBatch([slot("VHF1", 83.70)], -83.70);
  check("single slot, exact → ties", r.status === "ties");
  check("matchedCount = 1", r.matchedCount === 1);
}

console.log("\n— cent precision: float sums do not spuriously break a real tie —");
{
  // 0.10 + 0.20 + 0.30 in float ≠ 0.60 exactly; cent rounding must still tie.
  const r = reconcileBatch([slot("a", 0.10), slot("b", 0.20), slot("c", 0.30)], -0.60);
  check("float-safe cents tie", r.status === "ties");
}

console.log("\n— sign independence: a positive (credit) batch reconciles too —");
{
  const r = reconcileBatch([slot("x", 500), slot("y", 250)], 750);
  check("credit +750 ties against 500+250", r.status === "ties");
  check("bankAmount = 750", r.bankAmount === 750);
}

console.log("\n— [BATCH-SIGN] a creditnota slot REDUCES the batch total (net, not Σ|…|) —");
{
  // Invoice €300 + creditnota −€20 → the supplier debits the NET €280. The old Σ|amount| showed
  // "ties" against a −€320 debit (300+20) — a green light on a €40 over-charge.
  const net = reconcileBatch([slot("F-1001", 300), slot("CN-1", -20)], -280);
  check("net €280 against a −€280 debit → ties", net.status === "ties");
  const overcharge = reconcileBatch([slot("F-1001", 300), slot("CN-1", -20)], -320);
  check("the −€320 over-charge is a MISMATCH (was a false tie)", overcharge.status === "mismatch");
  check("diff reports the €40 gap", Math.abs(overcharge.diff - -40) < 0.005);
}

console.log("\n— a corrupt (non-finite) amount is treated as unmatched, not a tie —");
{
  const r = reconcileBatch([slot("a", 900), slot("b", Number.NaN)], -900);
  check("NaN slot ⇒ incomplete (never silently equal)", r.status === "incomplete");
  check("matchedCount counts only the finite one", r.matchedCount === 1);
}

console.log("\n— anyConfirmed reflects slot state —");
{
  const r = reconcileBatch([slot("a", 900, true), slot("b", 1000)], -1900);
  check("anyConfirmed = true when a slot is paid", r.anyConfirmed === true);
  check("still ties (900+1000=1900)", r.status === "ties");
}

console.log("\n— an empty slot list is incomplete, not a tie —");
{
  const r = reconcileBatch([], -100);
  check("no slots ⇒ incomplete", r.status === "incomplete");
  check("allMatched = false on empty", r.allMatched === false);
}

console.log("\n— countResolvedReferences: genuine batch vs PSP junk vs coincidental full-amount —");
{
  // M.H. BAL: 3 reference numbers, all real invoices → a genuine batch (≥2).
  check("3 real invoice numbers → 3 resolved (genuine batch)",
    countResolvedReferences(["262627", "262744", "262762"], ["262627", "262744", "262762"]) === 3);

  // HorecaRama: a Mollie hash + order number, ZERO are invoices → not a batch.
  check("PSP hash + order number → 0 resolved (fall back to single match)",
    countResolvedReferences(["8152314131466030", "72802"], ["82910"]) === 0);

  // The adversarial-review case: a real batch 501+502, PLUS an unrelated invoice 480 that
  // happens to equal the full debit. The reference still resolves to the 2 real invoices —
  // 480 must NOT collapse the batch (it isn't in the reference).
  check("genuine batch keeps 2 resolved even with an unrelated full-amount candidate present",
    countResolvedReferences(["501", "502"], ["501", "502", "480"]) === 2);

  // Whitespace/format independence (matches the matcher's normalizeRef).
  check("normalizes formatting: '26 / 3958' reference resolves to '26/3958' invoice",
    countResolvedReferences(["26 / 3958"], ["26/3958"]) === 1);

  // A confirmed (already-paid) number still counts as resolved, so a partially-paid batch
  // stays a batch even after its paid invoices leave the live candidate set.
  check("confirmed numbers count as resolved (partial-pay batch stays a batch)",
    countResolvedReferences(["A100", "A101"], ["A100"].concat(["A101"])) === 2);

  // A doubled reference number is not two invoices.
  check("a doubled reference fragment counts once",
    countResolvedReferences(["A100", "A100"], ["A100"]) === 1);

  // Only one of two references is a real invoice → 1 (not a genuine batch on its own).
  check("one real + one junk → 1 resolved",
    countResolvedReferences(["A100", "ORDER99"], ["A100"]) === 1);

  check("empty reference list → 0", countResolvedReferences([], ["A100"]) === 0);
}

console.log("\n— [ROOT] planBatchAutoConfirm: auto-book ONLY a provably-unambiguous batch —");
{
  const inv = (id: string, num: string, amt: number, sup = "Oz + Er Food B.V."): BatchCandidateInvoice =>
    ({ id, invoice_number: num, total_inc_btw: amt, client_name: sup, direction: "incoming", status: "received" });

  // The real Oz + Er Food case: €793,47 debit, 3 invoices summing EXACTLY, all numbers in the ref.
  const invoices = [inv("i1", "26023790", 380.37), inv("i2", "26026707", 195.50), inv("i3", "26031023", 217.60)];
  const tie = planBatchAutoConfirm({ reference: "26023790, 26026707, 26031023", bankAmount: -793.47, invoices });
  check("exact-sum, all-present, one supplier → auto-book the 3", !!tie && tie.invoiceIds.sort().join(",") === "i1,i2,i3");

  // ATAPACK: sum €4.265,41 but only €2.265,41 debited (€2.000 short) → NOT auto (mismatch).
  const atapack = [inv("a1", "26302050", 3685.78, "ATAPACK"), inv("a2", "26302362", 579.63, "ATAPACK")];
  check("short-paid batch (€2.000 diff) is NOT auto-booked",
    planBatchAutoConfirm({ reference: "26302050, 26302362", bankAmount: -2265.41, invoices: atapack }) === null);

  // W ketels: one referenced invoice (26002972) not in the system → incomplete → NOT auto.
  const wketels = [inv("w1", "26002569", 338.82, "W ketels"), inv("w2", "26002857", 654.99, "W ketels"), inv("w3", "26002714", 211.50, "W ketels")];
  check("a not-yet-imported invoice in the batch blocks auto-book",
    planBatchAutoConfirm({ reference: "26002569, 26002857, 26002714, 26002972", bankAmount: -1458.27, invoices: wketels }) === null);

  // Ambiguity: a referenced number maps to TWO unpaid invoices → unsafe → null.
  const dup = [inv("d1", "500", 100), inv("d2", "500", 100), inv("d3", "600", 200)];
  check("an ambiguous number (two invoices) blocks the whole batch",
    planBatchAutoConfirm({ reference: "500, 600", bankAmount: -300, invoices: dup }) === null);

  // Cross-supplier coincidental tie → blocked.
  const cross = [inv("c1", "700", 150, "Alpha BV"), inv("c2", "800", 150, "Beta BV")];
  check("two different suppliers whose sum ties is NOT auto-booked",
    planBatchAutoConfirm({ reference: "700, 800", bankAmount: -300, invoices: cross }) === null);

  // Direction guard: a CREDIT (+) must pay OUTGOING invoices, not incoming.
  check("a credit does not auto-pay incoming purchase invoices",
    planBatchAutoConfirm({ reference: "26023790, 26026707", bankAmount: +575.87, invoices }) === null);

  // A single reference is not a batch → left to the 1:1 safe pass.
  check("a single-reference line is not a batch here",
    planBatchAutoConfirm({ reference: "26023790", bankAmount: -380.37, invoices }) === null);

  // An already-paid invoice is not a live candidate → its number no longer resolves → not auto.
  const paidOne = [inv("p1", "900", 100), { ...inv("p2", "901", 100), status: "paid" }];
  check("a paid invoice can't be re-booked in a batch",
    planBatchAutoConfirm({ reference: "900, 901", bankAmount: -200, invoices: paidOne }) === null);

  // [REVIEW-B] A credit note (negative gross) must never enter the automatic path — reconcileBatch
  // sums by magnitude, so an abs-tie could book the wrong amount. ≤0 candidate → whole batch null.
  const withCredit = [inv("cn1", "1001", 300), { ...inv("cn2", "CR55", -20) }];
  check("a credit note in the batch blocks auto-book (magnitude-tie at 320)",
    planBatchAutoConfirm({ reference: "1001, CR55", bankAmount: -320, invoices: withCredit }) === null);
  check("a credit note also blocks the genuine net debit (280)",
    planBatchAutoConfirm({ reference: "1001, CR55", bankAmount: -280, invoices: withCredit }) === null);
}

console.log("\n— [BUNDEL] the app must recognise the payment IT generated —");
{
  // The gebundeld betaalverzoek asks the customer for the SUM OF THE OPEN AMOUNTS
  // (src/lib/betaalverzoek.ts buildBundelBetaalverzoek). Invoice A is EUR 1000 with EUR 400
  // already settled by an earlier instalment, invoice B is EUR 500 and fully open, so the QR
  // asks EUR 1100 and the customer transfers exactly that, quoting both numbers.
  // Summing the invoice TOTALS (1500) against that EUR 1100 credit calls the app's own,
  // perfectly correct payment a mismatch.
  const r = reconcileBatch([slot("2026001", 600.00), slot("2026002", 500.00)], 1100.00);
  check("bundle with a partly paid invoice ties on the OPEN amounts", r.status === "ties");

  const invoices: BatchCandidateInvoice[] = [
    { id: "a", invoice_number: "2026-001", total_inc_btw: 1000, amount_paid: 400, client_name: "Klant BV", direction: "outgoing", status: "sent" },
    { id: "b", invoice_number: "2026-002", total_inc_btw: 500, amount_paid: 0, client_name: "Klant BV", direction: "outgoing", status: "sent" },
  ];
  const plan = planBatchAutoConfirm({ reference: "2026-001, 2026-002", bankAmount: 1100, invoices });
  check("auto-confirm books the bundle it generated", plan !== null && plan.invoiceIds.length === 2);

  // The old, total-based reading must NOT tie: EUR 1500 of totals never left the bank.
  const wrong = planBatchAutoConfirm({ reference: "2026-001, 2026-002", bankAmount: 1500, invoices });
  check("a payment equal to the TOTALS (not the open sum) is refused", wrong === null);
}
{
  // Fully-open invoices: open == total, so the classic wholesaler batch is untouched.
  const invoices: BatchCandidateInvoice[] = [
    { id: "a", invoice_number: "F-1001", total_inc_btw: 300, amount_paid: 0, client_name: "Groothandel", direction: "incoming", status: "received" },
    { id: "b", invoice_number: "F-1002", total_inc_btw: 200, amount_paid: 0, client_name: "Groothandel", direction: "incoming", status: "received" },
  ];
  const plan = planBatchAutoConfirm({ reference: "F-1001, F-1002", bankAmount: -500, invoices });
  check("all-open batch is unchanged", plan !== null && plan.invoiceIds.length === 2);
  check("missing amount_paid is treated as zero",
    planBatchAutoConfirm({ reference: "F-1001, F-1002", bankAmount: -500, invoices: invoices.map(i => ({ ...i, amount_paid: null })) }) !== null);
}
{
  // An invoice whose balance is already covered contributes nothing and must not be
  // auto-booked as part of a batch — it would settle for EUR 0.
  const invoices: BatchCandidateInvoice[] = [
    { id: "a", invoice_number: "F-1001", total_inc_btw: 300, amount_paid: 300, client_name: "Groothandel", direction: "incoming", status: "received" },
    { id: "b", invoice_number: "F-1002", total_inc_btw: 200, amount_paid: 0, client_name: "Groothandel", direction: "incoming", status: "received" },
  ];
  check("a fully covered invoice blocks the automatic batch",
    planBatchAutoConfirm({ reference: "F-1001, F-1002", bankAmount: -200, invoices }) === null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

