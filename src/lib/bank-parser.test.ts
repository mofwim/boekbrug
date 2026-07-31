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

console.log("\n— [H3/M4] a CAMT entry with a non-finite amount or bad date is dropped, not written —");
{
  const camt = [
    '<BkToCstmrStmt>',
    '<Acct><Id><IBAN>NL91ABNA0417164300</IBAN></Id></Acct>',
    // good
    '<Ntry><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-01-02</Dt></ValDt></Ntry>',
    // non-finite amount (Infinity) — must NOT reach the DB
    '<Ntry><Amt Ccy="EUR">1e309</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-01-03</Dt></ValDt></Ntry>',
    // garbage amount (NaN)
    '<Ntry><Amt Ccy="EUR">abc</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-01-04</Dt></ValDt></Ntry>',
    // impossible date — would fail the batch INSERT if it slipped through
    '<Ntry><Amt Ccy="EUR">50.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>9999-99-99</Dt></ValDt></Ntry>',
    '</BkToCstmrStmt>',
  ].join("\n");
  const r = parseCAMT053(camt);
  check("only the one clean entry parses", r.transactions.length === 1 && r.transactions[0].amount === 100);
  check("every non-finite amount is finite in the output", r.transactions.every((t) => Number.isFinite(t.amount)));
  check("the three bad entries are each recorded as a parse error", r.parseErrors.length === 3);
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

console.log("\n— [BANK-BALANCE] MT940 opening/closing balance extraction —");
{
  const mt940 = [
    ":25:NL91ABNA0417164300",
    ":60F:C260101EUR1000,00",
    ":61:2601020102C100,00NTRF",
    ":86:/REMI/Betaling A",
    ":61:2601030103D50,00NTRF",
    ":86:/REMI/Betaling B",
    ":62F:C260103EUR1050,00",
  ].join("\n");
  const r = parseMT940(mt940);
  check("opening balance parsed = 1000", r.statementBalance?.opening === 1000);
  check("closing balance parsed = 1050", r.statementBalance?.closing === 1050);
  // opening + (100 − 50) = 1050 → this statement is internally complete
  const sum = r.transactions.reduce((s, t) => s + t.amount, 0);
  check("opening + Σtx equals closing (reconciles)", 1000 + sum === r.statementBalance?.closing);
}

console.log("\n— [BANK-BALANCE] MT940 debit (overdrawn) closing balance is negative —");
{
  const mt940 = [
    ":60F:D260101EUR200,00",     // overdrawn by 200
    ":61:2601020102C50,00NTRF",
    ":86:/REMI/x",
    ":62F:D260102EUR150,00",     // still overdrawn by 150
  ].join("\n");
  const r = parseMT940(mt940);
  check("debit opening = −200", r.statementBalance?.opening === -200);
  check("debit closing = −150", r.statementBalance?.closing === -150);
}

console.log("\n— [BANK-BALANCE] CAMT.053 OPBD/CLBD balance extraction —");
{
  const camt = [
    '<BkToCstmrStmt>',
    '<Acct><Id><IBAN>NL91ABNA0417164300</IBAN></Id></Acct>',
    '<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>',
    '<Ntry><Amt Ccy="EUR">250.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-01-02</Dt></ValDt></Ntry>',
    '<Ntry><Amt Ccy="EUR">50.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><ValDt><Dt>2026-01-03</Dt></ValDt></Ntry>',
    '<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1200.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>',
    '</BkToCstmrStmt>',
  ].join("\n");
  const r = parseCAMT053(camt);
  check("OPBD opening = 1000", r.statementBalance?.opening === 1000);
  check("CLBD closing = 1200", r.statementBalance?.closing === 1200);
  const sum = r.transactions.reduce((s, t) => s + t.amount, 0);
  check("opening + Σtx (250 − 50) = closing 1200", 1000 + sum === 1200);
  check("a DBIT closing balance is read negative", parseCAMT053(camt.replace("<Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy=\"EUR\">1200.00</Amt><CdtDbtInd>CRDT", "<Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy=\"EUR\">1200.00</Amt><CdtDbtInd>DBIT")).statementBalance?.closing === -1200);
}

console.log("\n— [BANK-BALANCE] MT940 reversal signs (RC nets debit, RD nets credit) —");
{
  // A received payment (+100) that then bounces (RC 100 → net −100) leaves the balance where it
  // started. RC must be NEGATIVE and RD POSITIVE, or the reversal books the wrong omzet/kosten
  // AND a complete statement fails the begin/eindsaldo check.
  const mt940 = [
    ":60F:C260101EUR1000,00",
    ":61:2601020102C100,00NTRF",     // credit +100
    ":86:/REMI/Betaling",
    ":61:2601030103RC100,00NTRF",    // reversal of that credit → −100
    ":86:/REMI/Storno",
    ":62F:C260103EUR1000,00",        // bank's real closing = 1000 (net zero movement)
  ].join("\n");
  const r = parseMT940(mt940);
  check("RC (reversal of credit) is negative", r.transactions[1].amount === -100);
  const sum = r.transactions.reduce((s, t) => s + t.amount, 0);
  check("reversal nets to zero → opening + Σtx = closing (reconciles)", 1000 + sum === r.statementBalance?.closing);

  // RD (reversal of a debit) must be positive.
  const rd = parseMT940([
    ":60F:C260101EUR1000,00",
    ":61:2601020102RD50,00NTRF",     // reversal of a debit → +50
    ":86:/REMI/Storno kosten",
    ":62F:C260102EUR1050,00",
  ].join("\n"));
  check("RD (reversal of debit) is positive", rd.transactions[0].amount === 50);
  check("RD statement reconciles (1000 + 50 = 1050)", 1000 + rd.transactions[0].amount === rd.statementBalance?.closing);
}

console.log("\n— [BANK-PARSE-CAMT-ALLDTLS] every <Ustrd> of every <TxDtls> is read —");
{
  const camt = (entries: string) =>
    `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>` +
    `<Acct><Id><IBAN>NL91ABNA0417164300</IBAN></Id></Acct>${entries}</Stmt></BkToCstmrStmt></Document>`;

  // 1) ISO caps one <Ustrd> at 140 chars, so a long remittance arrives SPLIT. Reading only the
  //    first element truncated it — and an invoice number past the split simply vanished.
  const split = parseCAMT053(camt(
    `<Ntry><Amt Ccy="EUR">242.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><ValDt><Dt>2026-06-11</Dt></ValDt>` +
    `<NtryDtls><TxDtls><RmtInf>` +
    `<Ustrd>Betaling van uw openstaande posten conform afspraak, met dank voor de vlotte</Ustrd>` +
    `<Ustrd>afhandeling van de levering — factuur 26302050</Ustrd>` +
    `</RmtInf></TxDtls></NtryDtls></Ntry>`,
  ));
  check("a split remittance is rejoined, not truncated",
    split.transactions[0]?.description.includes("factuur 26302050") === true);
  check("…so the invoice number past the split IS extracted",
    (split.transactions[0]?.reference ?? "").includes("26302050"));

  // 2) A collection/batch entry repeats <TxDtls>. Only the first sub-transaction was read, so
  //    every other invoice number in the run was dropped with no warning.
  const batch = parseCAMT053(camt(
    `<Ntry><Amt Ccy="EUR">2265.41</Amt><CdtDbtInd>DBIT</CdtDbtInd><ValDt><Dt>2026-06-20</Dt></ValDt>` +
    `<NtryDtls>` +
    `<TxDtls><RmtInf><Ustrd>factuur 26302050</Ustrd></RmtInf></TxDtls>` +
    `<TxDtls><RmtInf><Ustrd>factuur 26302362</Ustrd></RmtInf></TxDtls>` +
    `</NtryDtls></Ntry>`,
  ));
  const batchRef = batch.transactions[0]?.reference ?? "";
  check("a batch entry keeps the FIRST sub-transaction's number", batchRef.includes("26302050"));
  check("…and no longer drops the SECOND one", batchRef.includes("26302362"));
  check("the entry's booked total is untouched (money-truth)", batch.transactions[0]?.amount === -2265.41);

  // 3) A repeated identical line must not be doubled.
  const dup = parseCAMT053(camt(
    `<Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><ValDt><Dt>2026-06-01</Dt></ValDt>` +
    `<NtryDtls><TxDtls><RmtInf><Ustrd>Huur</Ustrd><Ustrd>Huur</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`,
  ));
  check("a repeated identical <Ustrd> is not duplicated", dup.transactions[0]?.description === "Huur");

  // 4) The ordinary single-remittance entry is byte-identical to before.
  const plain = parseCAMT053(camt(
    `<Ntry><Amt Ccy="EUR">50.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-06-02</Dt></ValDt>` +
    `<NtryDtls><TxDtls><RmtInf><Ustrd>factuur 26309999</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`,
  ));
  check("a single-remittance entry is unchanged", plain.transactions[0]?.description === "factuur 26309999");
  check("…with its amount and sign unchanged", plain.transactions[0]?.amount === 50);
}

console.log("\n— [BANK-PARSE-XMLENT-ORDER] each entity is decoded exactly once —");
{
  const camtName = (nm: string) =>
    `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>` +
    `<Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-06-02</Dt></ValDt>` +
    `<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>${nm}</Nm></Dbtr></RltdPties>` +
    `<RmtInf><Ustrd>test</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;
  // The ordinary case is unaffected — it always worked.
  check("a plain escaped ampersand still decodes", parseCAMT053(camtName("ING DD&amp;C")).transactions[0]?.counterpartName === "ING DD&C");
  // The escaped-escape is the one that was wrong: "&amp;lt;" is the TEXT "&lt;", not a "<".
  check("an escaped entity is not double-decoded into markup",
    parseCAMT053(camtName("A&amp;lt;B")).transactions[0]?.counterpartName === "A&lt;B");
  check("a numeric entity beside an ampersand decodes once",
    parseCAMT053(camtName("R&amp;D&#38;Co")).transactions[0]?.counterpartName === "R&D&Co");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
