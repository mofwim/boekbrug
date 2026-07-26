// [BANK-RECON-BADGE] Pure node test — run: npx tsx src/lib/bank-reconciliation.test.ts
import { computeInvoiceReconciliation, type ReconLink, type ReconSuggestion } from "./bank-reconciliation";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const auto = (txId: string, invoiceId: string, confidence = 0.9): ReconSuggestion =>
  ({ transactionId: txId, outcome: "auto", best: { invoiceId, confidence }, candidates: [{ invoiceId, confidence }] });
const choice = (txId: string, ids: string[]): ReconSuggestion =>
  ({ transactionId: txId, outcome: "choice", best: null, candidates: ids.map((invoiceId) => ({ invoiceId, confidence: 0.55 })) });

console.log("\n— a linked bank line marks the invoice reconciled —");
{
  const r = computeInvoiceReconciliation([{ invoiceId: "inv1", txStatus: "matched" }], []);
  check("inv1 linked", r["inv1"]?.linked === true);
  check("inv1 has no pendingMatch", r["inv1"]?.pendingMatch === null);
}

console.log("\n— a partial multi link (tx still pending) still counts as linked —");
{
  const r = computeInvoiceReconciliation([{ invoiceId: "inv1", txStatus: "pending" }], []);
  check("inv1 linked even though tx is pending", r["inv1"]?.linked === true);
}

console.log("\n— an auto suggestion tags its best invoice as a pending match —");
{
  const r = computeInvoiceReconciliation([], [auto("tx9", "inv2", 0.92)]);
  check("inv2 pendingMatch on tx9", r["inv2"]?.pendingMatch?.transactionId === "tx9");
  check("confidence carried", r["inv2"]?.pendingMatch?.confidence === 0.92);
  check("inv2 not linked", r["inv2"]?.linked === false);
}

console.log("\n— an ambiguous choice tags NOTHING (no false 'found') —");
{
  const r = computeInvoiceReconciliation([], [choice("tx1", ["a", "b", "c", "d"])]);
  check("no invoice tagged from a choice", Object.keys(r).length === 0);
}

console.log("\n— linked wins over a pending match (disjoint) —");
{
  // Defensive: even if the same invoice appeared both linked and as an auto best.
  const r = computeInvoiceReconciliation([{ invoiceId: "inv3", txStatus: "matched" }], [auto("tx3", "inv3", 0.99)]);
  check("inv3 linked", r["inv3"]?.linked === true);
  check("inv3 pendingMatch suppressed when linked", r["inv3"]?.pendingMatch === null);
}

console.log("\n— strongest auto wins when two txns match one invoice —");
{
  const r = computeInvoiceReconciliation([], [auto("txA", "inv4", 0.80), auto("txB", "inv4", 0.95)]);
  check("keeps the higher-confidence tx (txB)", r["inv4"]?.pendingMatch?.transactionId === "txB");
  check("keeps the higher confidence", r["inv4"]?.pendingMatch?.confidence === 0.95);
}

console.log("\n— an invoice with no bank relationship is absent from the map —");
{
  const r = computeInvoiceReconciliation([{ invoiceId: "inv1", txStatus: "matched" }], [auto("tx9", "inv2")]);
  check("inv-unrelated is absent (caller shows no badge)", r["inv-unrelated"] === undefined);
  check("only inv1 + inv2 present", Object.keys(r).sort().join(",") === "inv1,inv2");
}

console.log("\n— 'none' and null-best suggestions are ignored —");
{
  const r = computeInvoiceReconciliation([], [
    { transactionId: "txN", outcome: "none", best: null, candidates: [] },
    { transactionId: null, outcome: "auto", best: { invoiceId: "x", confidence: 1 }, candidates: [] },
  ]);
  check("nothing tagged", Object.keys(r).length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
