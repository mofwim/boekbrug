// [BANK-PARSE] Pure node test — run: npx tsx src/lib/bank-parser.test.ts
// Locks the R2 loss-signal: a statement line the parser CANNOT read must be counted in
// parseErrors (one entry = one dropped transaction), while the readable lines still parse.
// The route + UI rely on parseErrors.length being an honest "lines lost" count so the
// owner is never silently short a transaction.
import { parseBankFile, parseMT940, parseCAMT053 } from "./bank-parser";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— MT940: an unreadable :61: line is counted, not silently dropped —");
{
  const mt940 = [
    ":20:TEST",
    ":25:NL91ABNA0417164300",
    ":60F:C260101EUR1000,00",
    ":61:2601020102C100,00NTRF",
    ":86:/REMI/Betaling A 12345",
    ":61:XXNOTADATEZZ",            // ← malformed: no YYMMDD → cannot be read
    ":86:/REMI/kapot",
    ":61:2601030103D50,00NTRF",
    ":86:/REMI/Betaling B",
    ":62F:C260103EUR1050,00",
  ].join("\n");
  const r = parseMT940(mt940);
  check("the two readable transactions still parse", r.transactions.length === 2);
  check("the unreadable line is recorded as a parse error (not silently dropped)", r.parseErrors.length === 1);
  check("amounts are correct (+100, −50)", r.transactions[0].amount === 100 && r.transactions[1].amount === -50);
  check("parseBankFile routes .txt/MT940 content to the MT940 parser", parseBankFile(mt940, "afschrift.sta").transactions.length === 2);
}

console.log("\n— CAMT.053: an entry missing its amount is counted as an error —");
{
  const camt = [
    '<BkToCstmrStmt>',
    '<Acct><Id><IBAN>NL91ABNA0417164300</IBAN></Id></Acct>',
    // good entry
    '<Ntry><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-01-02</Dt></ValDt><NtryDtls><TxDtls><RmtInf><Ustrd>Betaling A</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>',
    // broken entry: no <Amt>
    '<Ntry><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-01-03</Dt></ValDt></Ntry>',
    '</BkToCstmrStmt>',
  ].join("\n");
  const r = parseCAMT053(camt);
  check("the readable CAMT entry parses", r.transactions.length === 1);
  check("the amount-less entry is recorded as a parse error", r.parseErrors.length === 1);
  check("parseBankFile routes .xml to the CAMT parser", parseBankFile(camt, "afschrift.xml").format === "CAMT053");
}

console.log("\n— a fully-clean statement has zero parse errors (no false positives) —");
{
  const clean = [
    ":20:TEST",
    ":25:NL91ABNA0417164300",
    ":60F:C260101EUR1000,00",
    ":61:2601020102C100,00NTRF",
    ":86:/REMI/Betaling A",
    ":62F:C260102EUR1100,00",
  ].join("\n");
  const r = parseMT940(clean);
  check("clean statement → 1 tx, 0 errors", r.transactions.length === 1 && r.parseErrors.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
