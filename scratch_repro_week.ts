import { computeResult, toResultBankTx, cardBudgetBound } from "./src/lib/financial-result";
import { parsePosSettlement, turnoverNetOmzet, type DailyTurnover } from "./src/lib/turnover";

const day = (d: string): DailyTurnover => ({
  turnover_date: d, base_0: 0, base_9: 0, base_21: 300, btw_9: 0, btw_21: 63,
  total_incl: 363, pin_amount: 363, cash_amount: 0, other_amount: 0,
});
const days = ["2026-05-04","2026-05-05","2026-05-06","2026-05-07","2026-05-08"].map(day);

const desc = "AFREK. BETAALAUTOMAAT MAST REFNR. F9Q3BH DAT. 202618 AANT. 55 BRUTO 181500 /COM D377";
console.log("parsePosSettlement:", JSON.stringify(parsePosSettlement(desc)));

const raw = { amount: 1815, category: "pos_income", invoice_id: null, date: "2026-05-11", description: desc };
const tx = toResultBankTx(raw);
console.log("toResultBankTx:", JSON.stringify(tx));
console.log("per-day card budget:", days.map(t => [t.turnover_date, cardBudgetBound(t)]));

const r = computeResult([], [tx], [], days);
const tillNet = days.reduce((s, t) => s + turnoverNetOmzet(t), 0);
console.log("\n--- result ---");
console.log("till (Z-report) net omzet for the week :", tillNet.toFixed(2));
console.log("computeResult omzet                    :", r.omzet.toFixed(2));
console.log("DOUBLE-COUNTED                         :", (r.omzet - tillNet).toFixed(2));
console.log("omzetZonderBtwNonCash (blocks readiness):", r.omzetZonderBtwNonCash.toFixed(2));
console.log("resultaat                              :", r.resultaat.toFixed(2));
