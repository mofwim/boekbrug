import { computeResult, toResultBankTx } from "./src/lib/financial-result";
import { turnoverNetOmzet, type DailyTurnover } from "./src/lib/turnover";

const P = (date: string, amount: number, description: string) =>
  ({ date, amount, description, category: "pos_income", invoice_id: null });
const rows = [
  P("2026-05-01", 274.9,  "AFREK. BETAALAUTOMAAT DBMC DAT. 20260430/6120 AANT. 27 MREFNR. KFM"),
  P("2026-05-01", 960.39, "AFREK. BETAALAUTOMAAT MAES DAT. 20260430/6120 AANT. 59 MREFNR. KFM"),
  P("2026-05-01", 278.79, "AFREK. BETAALAUTOMAAT VIDB DAT. 20260430/6120 AANT. 21 MREFNR. KFM"),
  P("2026-05-01", 534.76, "AFREK. BETAALAUTOMAAT VPAY DAT. 20260430/6120 AANT. 35 MREFNR. KFM"),
  P("2026-05-04", 318.87, "AFREK. BETAALAUTOMAAT VPAY DAT. 20260503/6123 AANT. 19 MREFNR. KFM"),
  P("2026-05-04", 206.78, "AFREK. BETAALAUTOMAAT MAST DAT. 202618 AANT. 12 BRUTO 21055 /COM D377"),
  P("2026-05-04", 39.75,  "AFREK. BETAALAUTOMAAT VISA DAT. 202618 AANT. 2 BRUTO 4044 /COM D69"),
  P("2026-05-04", 100.19, "AFREK. BETAALAUTOMAAT VIDB DAT. 20260503/6123 AANT. 12 MREFNR. KFM"),
  P("2026-05-04", 227.86, "AFREK. BETAALAUTOMAAT DBMC DAT. 20260503/6123 AANT. 29 MREFNR. KFM"),
  P("2026-05-04", 928.02, "AFREK. BETAALAUTOMAAT MAES DAT. 20260503/6123 AANT. 60 MREFNR. KFM"),
  P("2026-05-05", 288.26, "AFREK. BETAALAUTOMAAT DBMC DAT. 20260504/6124 AANT. 28 MREFNR. KFM"),
  P("2026-05-05", 817.49, "AFREK. BETAALAUTOMAAT MAES DAT. 20260504/6124 AANT. 56 MREFNR. KFM"),
  P("2026-05-05", 233.52, "AFREK. BETAALAUTOMAAT VIDB DAT. 20260504/6124 AANT. 23 MREFNR. KFM"),
  P("2026-05-05", 351.04, "AFREK. BETAALAUTOMAAT VPAY DAT. 20260504/6124 AANT. 25 MREFNR. KFM"),
];
const till: Record<string, number> = { "2026-04-30": 2145.76, "2026-05-03": 1574.94, "2026-05-04": 1690.31 };
const r2 = (n: number) => Math.round(n * 100) / 100;
const turnover: DailyTurnover[] = Object.entries(till).map(([d, pin]) => ({
  turnover_date: d, base_0: 0, base_9: r2(pin / 1.09), base_21: 0,
  btw_9: r2(pin - pin / 1.09), btw_21: 0,
  total_incl: pin, pin_amount: pin, cash_amount: 0, other_amount: 0,
}));

const tx = rows.map((b) => toResultBankTx(b));
console.log("the two week-numbered lines as the engine sees them:");
for (const t of tx) if (!t.settleExact) console.log("  ", JSON.stringify({ amount: t.amount, settleDate: t.settleDate, settleExact: t.settleExact }));

const r = computeResult([], tx, [], turnover);
const tillNet = turnover.reduce((s, t) => s + turnoverNetOmzet(t), 0);
console.log("\ntill net omzet (30 Apr + 3 May + 4 May):", tillNet.toFixed(2));
console.log("computeResult omzet                    :", r.omzet.toFixed(2));
console.log("DOUBLE-COUNTED into omzet              :", (r.omzet - tillNet).toFixed(2));
console.log("cashOmzetZonderBtw (blocks readiness)  :", r.cashOmzetZonderBtw.toFixed(2));
console.log("MAST 206,78 + VISA 39,75               :", (206.78 + 39.75).toFixed(2));
console.log("\nbank total vs total till card budget:");
console.log("  sum of all 14 settlement lines:", rows.reduce((s, x) => s + x.amount, 0).toFixed(2));
console.log("  sum of the three pin budgets  :", Object.values(till).reduce((s, x) => s + x, 0).toFixed(2));
