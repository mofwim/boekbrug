// [DEDUP-SOFT] Pure node test — run: npx tsx src/lib/possible-duplicate.test.ts
// Guards assessPossibleDuplicate: a SOFT "mogelijk dubbel" flag that never blocks, but must
// catch a re-import the hard key misses (same amount + date, or same amount + vendor a few days
// apart) WITHOUT flagging a genuinely different supplier or a monthly recurring bill.
import { assessPossibleDuplicate, POSSIBLE_DUP_WINDOW_DAYS, type PossibleDupCandidate, type SemanticDedupInput } from "./safecore";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const input = (o: Partial<SemanticDedupInput> = {}): SemanticDedupInput => ({
  invoiceNumber: "F-2001", vendor: "Atapack B.V.", totalIncBtw: 121, invoiceDate: "2026-03-10", ...o,
});
const cand = (o: Partial<PossibleDupCandidate> = {}): PossibleDupCandidate => ({
  id: "inv-1", invoice_number: "F-9999", client_name: "Atapack", invoice_date: "2026-03-10", total_inc_btw: 121, ...o,
});

console.log("\n— same amount + date, different number → possible —");
{
  const r = assessPossibleDuplicate(input(), [cand()]);
  check("flagged", !!r && r.match.id === "inv-1");
  check("reason mentions bedrag, datum en afzender", r?.reason === "zelfde bedrag, datum en afzender");
}

console.log("\n— same amount + date, vendor unknown on one side → possible (no vendor veto) —");
{
  const r = assessPossibleDuplicate(input({ vendor: "onbekend" }), [cand({ client_name: "Atapack" })]);
  check("still flagged on amount+date", !!r && r.reason === "zelfde bedrag en datum");
}

console.log("\n— provably different reliable vendors, same amount+date → NOT a dup (coincidence) —");
{
  const r = assessPossibleDuplicate(input({ vendor: "Atapack B.V." }), [cand({ client_name: "Jansen Groothandel" })]);
  check("different supplier not flagged", r === null);
}

console.log("\n— exact number match is a HARD dup, not soft → skipped here —");
{
  const r = assessPossibleDuplicate(input({ invoiceNumber: "F-2001" }), [cand({ invoice_number: "F-2001" })]);
  check("exact-number candidate skipped", r === null);
}

console.log("\n— same vendor + amount, a few days apart → possible (near-date re-import) —");
{
  const r = assessPossibleDuplicate(input({ invoiceDate: "2026-03-10" }), [cand({ invoice_date: "2026-03-14" })]);
  check("near-date same vendor flagged", !!r && r.reason === "zelfde bedrag en afzender, datum dichtbij");
}

console.log("\n— same vendor + amount, a MONTH apart → NOT flagged (recurring bill) —");
{
  const r = assessPossibleDuplicate(input({ invoiceDate: "2026-03-10" }), [cand({ invoice_date: "2026-04-10", invoice_number: "F-8888" })]);
  check(`> ${POSSIBLE_DUP_WINDOW_DAYS} days apart not flagged`, r === null);
}

console.log("\n— same vendor + amount, NO dates at all → NOT flagged (recurring risk) —");
{
  const r = assessPossibleDuplicate(input({ invoiceDate: null }), [cand({ invoice_date: null, invoice_number: "F-7777" })]);
  check("no-date same-vendor not flagged", r === null);
}

console.log("\n— different amount → never flagged —");
{
  const r = assessPossibleDuplicate(input({ totalIncBtw: 121 }), [cand({ total_inc_btw: 130 })]);
  check("different total not flagged", r === null);
}

console.log("\n— no usable total on input → null —");
{
  check("missing total → null", assessPossibleDuplicate(input({ totalIncBtw: null }), [cand()]) === null);
}

console.log("\n— picks the STRONGEST signal among candidates —");
{
  const r = assessPossibleDuplicate(input({ vendor: "Atapack B.V.", invoiceDate: "2026-03-10" }), [
    cand({ id: "near", client_name: "Atapack", invoice_date: "2026-03-13", invoice_number: "F-1" }),   // rank 2
    cand({ id: "exact", client_name: "Atapack", invoice_date: "2026-03-10", invoice_number: "F-2" }),  // rank 4
  ]);
  check("best (same date + vendor) wins", !!r && r.match.id === "exact");
}

console.log("\n— cent-precision total match (float-safe) —");
{
  const r = assessPossibleDuplicate(input({ totalIncBtw: 121.10 }), [cand({ total_inc_btw: 121.10 })]);
  check("121.10 matches 121.10", !!r);
  const r2 = assessPossibleDuplicate(input({ totalIncBtw: 121.10 }), [cand({ total_inc_btw: 121.11 })]);
  check("121.10 != 121.11", r2 === null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
