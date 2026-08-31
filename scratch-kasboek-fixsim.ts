// Simulates the PROPOSED fix (step 1): negate a column only when EVERY non-null value in it is < 0.
import type { Cell } from "./src/lib/turnover-import";

const num = (c: Cell): number | null => {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (typeof c === "string") {
    const t = c.trim().replace(/[€\s]/g, "");
    if (t === "") return null;
    const cleaned = t.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const SPENT = 3, RECEIVED = 6;

function readWithProposedFix(dataRows: Cell[][]) {
  const colAllNegative = (idx: number) => {
    const vals = dataRows.map((r) => num(r[idx])).filter((v): v is number => v !== null && v !== 0);
    return vals.length > 0 && vals.every((v) => v < 0);
  };
  const flipSpent = colAllNegative(SPENT), flipReceived = colAllNegative(RECEIVED);
  return dataRows.map((r) => {
    const s = num(r[SPENT]) ?? 0, rec = num(r[RECEIVED]) ?? 0;
    return { spent: flipSpent ? -s : s, received: flipReceived ? -rec : rec, opening: num(r[2])!, closing: num(r[8])! };
  });
}

const dag = (serial: number, begin: number, uit: number | null, ont: number | null, eind: number): Cell[] =>
  [serial, serial, begin, uit, null, null, ont, null, eind];

const cases: Record<string, Cell[][]> = {
  "A whole column negative": [dag(46113, 1000, -100, null, 900), dag(46114, 900, -50, null, 850)],
  "B one negative correction": [dag(46113, 1000, 200, null, 800), dag(46114, 800, -50, null, 850)],
  "C reversal, both cols negative (ONLY line in the sheet)": [dag(46113, 1000, null, null, 1000), dag(46114, 1000, -50, -50, 1000)],
  "C' same reversal inside a normal positive sheet": [
    dag(46113, 1000, 100, null, 900), dag(46114, 900, 200, null, 700), dag(46115, 700, -50, -50, 700),
  ],
  "D negative ontvangsten only": [dag(46113, 1000, null, -80, 920)],
  "real Kiwi sheet": [
    dag(46113, 1018.32, null, 267.849991, 1286.169991),
    dag(46114, 1286.169991, null, 279.799999, 1565.96999),
    dag(46120, 1565.96999, 1754.35, 341.899994, 153.519984),
  ],
};

for (const [name, rows] of Object.entries(cases)) {
  const out = readWithProposedFix(rows);
  const adds = out.every((r) => Math.abs(Math.round((r.opening + r.received - r.spent) * 100) / 100 - r.closing) < 0.005);
  console.log(name);
  console.log("   spent:", out.map((r) => r.spent), " received:", out.map((r) => r.received));
  console.log("   totalSpent:", out.reduce((s, r) => s + r.spent, 0), " every row adds up:", adds);
}
