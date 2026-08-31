// Alternative: pick the per-column sign convention that makes the MOST rows satisfy
// begin + ont - uit = eind. Ties prefer as-written. Still column-level, never per-row.
import type { Cell } from "./src/lib/turnover-import";

const num = (c: Cell): number | null => {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (typeof c === "string") {
    const t = c.trim().replace(/[€\s]/g, "");
    if (t === "") return null;
    return Number(t.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) || null;
  }
  return null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const SPENT = 3, RECEIVED = 6;

function read(dataRows: Cell[][]) {
  const score = (fs: boolean, fr: boolean) =>
    dataRows.filter((r) => {
      const o = num(r[2]), c = num(r[8]);
      if (o === null || c === null) return false;
      const s = (num(r[SPENT]) ?? 0) * (fs ? -1 : 1);
      const rec = (num(r[RECEIVED]) ?? 0) * (fr ? -1 : 1);
      return Math.abs(r2(o + rec - s) - r2(c)) < 0.005;
    }).length;
  // as-written first, so a tie keeps the file as it is written
  const combos: [boolean, boolean][] = [[false, false], [true, false], [false, true], [true, true]];
  let best = combos[0], bestScore = score(false, false);
  for (const [fs, fr] of combos.slice(1)) { const sc = score(fs, fr); if (sc > bestScore) { best = [fs, fr]; bestScore = sc; } }
  const [fs, fr] = best;
  return { flip: `spent:${fs} received:${fr}`, rows: dataRows.map((r) => ({
    spent: r2((num(r[SPENT]) ?? 0) * (fs ? -1 : 1)), received: r2((num(r[RECEIVED]) ?? 0) * (fr ? -1 : 1)),
    opening: num(r[2])!, closing: num(r[8])! })) };
}

const dag = (s: number, b: number, u: number | null, o: number | null, e: number): Cell[] => [s, s, b, u, null, null, o, null, e];
const cases: Record<string, Cell[][]> = {
  "A whole column negative": [dag(46113, 1000, -100, null, 900), dag(46114, 900, -50, null, 850)],
  "B one negative correction": [dag(46113, 1000, 200, null, 800), dag(46114, 800, -50, null, 850)],
  "C reversal only line": [dag(46113, 1000, null, null, 1000), dag(46114, 1000, -50, -50, 1000)],
  "C' reversal in a positive sheet": [dag(46113, 1000, 100, null, 900), dag(46114, 900, 200, null, 700), dag(46115, 700, -50, -50, 700)],
  "D negative ontvangsten only": [dag(46113, 1000, null, -80, 920)],
  "real Kiwi sheet": [dag(46113, 1018.32, null, 267.849991, 1286.169991), dag(46114, 1286.169991, null, 279.799999, 1565.96999), dag(46120, 1565.96999, 1754.35, 341.899994, 153.519984)],
  "test:55 non-adding row must STILL warn": [dag(46113, 1000, 100, 50, 1000)],
};
for (const [n, rows] of Object.entries(cases)) {
  const o = read(rows);
  const adds = o.rows.every((r) => Math.abs(r2(r.opening + r.received - r.spent) - r2(r.closing)) < 0.005);
  console.log(n, "\n   flip:", o.flip, " spent:", o.rows.map((r) => r.spent), " received:", o.rows.map((r) => r.received),
    "\n   totalSpent:", r2(o.rows.reduce((s, r) => s + r.spent, 0)), " every row adds up:", adds);
}
