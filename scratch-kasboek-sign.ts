import { parseKasboekSheet } from "./src/lib/kasboek-import";
import { matchKasboekDays, matchHeadline, bookableAmount } from "./src/lib/kasboek-match";
import type { Cell } from "./src/lib/turnover-import";

const KOP: Cell[] = [null, "april", "Beginsaldo", "Uitgaven", "Omschrijving", null, "Ontvangsten ", "Omschrijving", "Eindsaldo"];
const dag = (serial: number, begin: number, uit: number | null, uitOms: string | null, ont: number | null, eind: number): Cell[] =>
  [serial, serial, begin, uit, uitOms, null, ont, null, eind];

const show = (r: ReturnType<typeof parseKasboekSheet>) =>
  r!.rows.map((x) => ({ d: x.date, spent: x.spent, received: x.received, closing: x.closing, desc: x.spentDescription }));

console.log("=== A) whole Uitgaven column written negative (abs is CORRECT here) ===");
// sheet's own formula: eind = begin + ont + uitgaven, uitgaven stored negative
const A = parseKasboekSheet([KOP, dag(46113, 1000, -100, null, null, 900), dag(46114, 900, -50, null, null, 850)])!;
console.log("rows:", show(A));
console.log("warnings:", A.warnings.map((w) => w.message));
console.log("totalSpent:", A.totalSpent);

console.log("\n=== B) ONE negative correction inside an otherwise positive column ===");
const B = parseKasboekSheet([
  KOP,
  dag(46113, 1000, 200, "inkoop Trimex", null, 800),
  dag(46114, 800, -50, "retour Trimex", null, 850),
])!;
console.log("rows:", show(B));
console.log("totalSpent read:", B.totalSpent, " (file's true net spend: 200 - 50 = 150)");
console.log("warnings:", B.warnings.map((w) => `${w.code}: ${w.message}`));
console.log("row for the correction was STILL pushed:", B.rows.length === 2);

const empty = { spent: new Map<string, number>(), received: new Map<string, number>() };
const mB = matchKasboekDays(B.rows, empty);
console.log("day matches:", mB.days.map((d) => ({ date: d.date, fileSpent: d.fileSpent, delta: d.delta, verdict: d.verdict, bookable: bookableAmount(d) })));
console.log("headline:", matchHeadline(mB.summary));
console.log("summary.missingTotal:", mB.summary.missingTotal, " (truth: 150)");
const booked = mB.days.reduce((s, d) => s + (bookableAmount(d) ?? 0), 0);
console.log("booked as cash OUT:", booked);
console.log("drawer after booking:", 1000 - booked, "| file says the drawer ends at", B.closingBalance);
console.log("error on the drawer:", (1000 - booked) - (B.closingBalance ?? 0));

console.log("\n=== C) reversal line: BOTH columns negative, saldo unchanged — any warning? ===");
const C = parseKasboekSheet([
  KOP,
  dag(46113, 1000, null, null, null, 1000),
  dag(46114, 1000, -50, "storno", -50, 1000),
])!;
console.log("warnings:", C.warnings.map((w) => `${w.code}: ${w.message}`));
console.log("rows:", show(C));
console.log("totalSpent:", C.totalSpent, "totalReceived:", C.totalReceived, " (truth: 0 and 0)");
const mC = matchKasboekDays(C.rows, empty);
console.log("bookable:", mC.days.map((d) => ({ date: d.date, delta: d.delta, verdict: d.verdict, bookable: bookableAmount(d) })));
console.log("headline:", matchHeadline(mC.summary));

console.log("\n=== D) negative Ontvangsten only ===");
const D = parseKasboekSheet([KOP, dag(46113, 1000, null, null, -80, 920)])!;
console.log("received read:", D.rows[0].received, "(file means -80)  totalReceived:", D.totalReceived);
console.log("warnings:", D.warnings.map((w) => w.message));

console.log("\n=== E) negative written as Dutch text ===");
const E = parseKasboekSheet([KOP, dag(46113, 2000, "-1.234,56" as unknown as number, "x", null, 3234.56)])!;
console.log("spent read:", E.rows[0].spent, "(file says -1234.56)");
console.log("warnings:", E.warnings.map((w) => w.code));
