import { computeResult } from "./src/lib/financial-result";
import { buildAangifte, type AangifteCompleteness } from "./src/lib/aangifte";

const comp: AangifteCompleteness = { turnoverDays: 0, quarterDays: 91, incomingInvoiceCount: 0, outgoingInvoiceCount: 1, hasEuPurchase: false };

console.log("=== PROBE A: bank 'omzet' / pos_income revenue DROPPED from aangifte 5a ===");
const rInv = computeResult([{ direction: "outgoing", status: "paid", total_ex_btw: 1000, btw_amount: 210 }], [], [], []);
const aInv = buildAangifte(rInv, comp, "Q2 2026");
console.log("as INVOICE    -> omzet:", rInv.omzet, "5a:", aInv.verschuldigd, "salesByRate:", JSON.stringify(rInv.salesByRate), "zonderBtw:", rInv.cashOmzetZonderBtw);
const rBank = computeResult([], [{ amount: 1210, category: "omzet", invoice_id: null }], [], []);
const aBank = buildAangifte(rBank, comp, "Q2 2026");
console.log("as bank omzet -> omzet:", rBank.omzet, "5a:", aBank.verschuldigd, "salesByRate:", JSON.stringify(rBank.salesByRate), "zonderBtw:", rBank.cashOmzetZonderBtw);
const rPos = computeResult([], [{ amount: 1210, category: "pos_income", invoice_id: null, settleDate: "2026-05-10" }], [], []);
const aPos = buildAangifte(rPos, comp, "Q2 2026");
console.log("as pos_income -> omzet:", rPos.omzet, "5a:", aPos.verschuldigd, "salesByRate:", JSON.stringify(rPos.salesByRate), "zonderBtw:", rPos.cashOmzetZonderBtw);

console.log("\n=== PROBE B: unrated cash omzet ===");
const rCash = computeResult([], [], [{ direction: "in", amount: 121, category: "omzet", btw_rate: null }], []);
const aCash = buildAangifte(rCash, comp, "Q2 2026");
console.log("omzet:", rCash.omzet, "5a:", aCash.verschuldigd, "cashOmzetZonderBtw:", rCash.cashOmzetZonderBtw, "rows:", JSON.stringify(aCash.rows));
console.log("note surfaced?:", aCash.notes.some(n=>n.includes("geen BTW-tarief")));

console.log("\n=== PROBE C: creditnota sign ===");
const rCredit = computeResult([
  { direction: "outgoing", status: "paid", total_ex_btw: 5000, btw_amount: 1050 },
  { direction: "outgoing", status: "sent", total_ex_btw: -1000, btw_amount: -210 },
], [], [], []);
const aCredit = buildAangifte(rCredit, comp, "Q2 2026");
console.log("salesByRate:", JSON.stringify(rCredit.salesByRate));
console.log("1a row:", JSON.stringify(aCredit.rows.find(r=>r.code==="1a")), "5a:", aCredit.verschuldigd, "(expect 4000/840)");
