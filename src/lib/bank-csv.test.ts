// [BANK-CSV] Pure node test — run: npx tsx src/lib/bank-csv.test.ts
// Locks the CSV bank-statement parser against realistic ING / Rabobank / bunq / SNS
// exports, the number/date notations they use, and the honesty guard (a non-bank CSV
// must import ZERO transactions, never fabricated rows). Also covers the normalized
// "naar Excel" export.
import {
  parseBankCsv, parseBankAmount, parseBankDate, looksLikeBankCsv,
  toExportMatrix, toNormalizedCsv, splitCsv,
} from "./bank-csv";
import { parseBankFile } from "./bank-parser";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

console.log("\n— parseBankAmount: every common notation —");
{
  check('Dutch "1.234,56" → 1234.56', near(parseBankAmount("1.234,56")!, 1234.56));
  check('Dutch "12,50" → 12.5', near(parseBankAmount("12,50")!, 12.5));
  check('English "1,234.56" → 1234.56', near(parseBankAmount("1,234.56")!, 1234.56));
  check('English "12.50" → 12.5', near(parseBankAmount("12.50")!, 12.5));
  check('bare thousands "1.234" → 1234', near(parseBankAmount("1.234")!, 1234));
  check('"1.234.567" → 1234567', near(parseBankAmount("1.234.567")!, 1234567));
  check('leading minus "-12,50" → -12.5', near(parseBankAmount("-12,50")!, -12.5));
  check('trailing minus "12,50-" → -12.5', near(parseBankAmount("12,50-")!, -12.5));
  check('leading plus "+99,00" → 99', near(parseBankAmount("+99,00")!, 99));
  check('with currency "€ 1.000,00" → 1000', near(parseBankAmount("€ 1.000,00")!, 1000));
  check("empty → null", parseBankAmount("") === null && parseBankAmount(null) === null);
  check('non-numeric "n.v.t." → null', parseBankAmount("n.v.t.") === null);
}

console.log("\n— parseBankDate: every common notation → ISO —");
{
  check('ING "20260115" → 2026-01-15', parseBankDate("20260115") === "2026-01-15");
  check('Rabo "2026-01-15" → 2026-01-15', parseBankDate("2026-01-15") === "2026-01-15");
  check('SNS "15-01-2026" → 2026-01-15', parseBankDate("15-01-2026") === "2026-01-15");
  check('slash "15/01/2026" → 2026-01-15', parseBankDate("15/01/2026") === "2026-01-15");
  check('short "15-01-26" → 2026-01-15', parseBankDate("15-01-26") === "2026-01-15");
  check("invalid month rejected", parseBankDate("2026-13-01") === null);
  check("garbage → null", parseBankDate("nope") === null);
}

console.log("\n— splitCsv: quotes + embedded delimiters —");
{
  const m = splitCsv('a;"b;c";d\n1;"x""y";3', ";");
  check("row 1 has 3 fields with embedded ; preserved", m[0].length === 3 && m[0][1] === "b;c");
  check("escaped quote decoded", m[1][1] === 'x"y');
}

console.log("\n— ING CSV (semicolon, YYYYMMDD, Af/Bij flag, comma decimals) —");
{
  // Mijn ING → Downloaden → CSV. Fully quoted, semicolon-delimited.
  const ing = [
    '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"',
    '"20260115";"Albert Heijn 1234";"NL11INGB0001234567";"NL22RABO0111111111";"BA";"Af";"53,20";"Betaalautomaat";"Pasvolgnr 001 15-01-2026"',
    '"20260116";"Klant Jansen BV";"NL11INGB0001234567";"NL33ABNA0222222222";"OV";"Bij";"1.210,00";"Overschrijving";"Factuur 29528"',
  ].join("\n");
  const r = parseBankCsv(ing);
  check("format is CSV", r.format === "CSV");
  check("2 transactions parsed", r.transactions.length === 2);
  check("own IBAN detected from Rekening", r.accountIban === "NL11INGB0001234567");
  check("Af → negative amount", near(r.transactions[0].amount, -53.2));
  check("Bij → positive amount", near(r.transactions[1].amount, 1210));
  check("counterpart name read", r.transactions[0].counterpartName === "Albert Heijn 1234");
  check("counterpart IBAN read from Tegenrekening", r.transactions[1].counterpartIban === "NL33ABNA0222222222");
  check("invoice reference extracted from Mededelingen", r.transactions[1].reference === "29528");
  check("routes via parseBankFile by .csv extension", parseBankFile(ing, "MijnING.csv").transactions.length === 2);
  check("routes via parseBankFile by content sniff (wrong ext)", parseBankFile(ing, "afschrift.txt").format === "CSV");
}

console.log("\n— Rabobank CSV (comma-delimited, signed amount, twin IBAN columns) —");
{
  // Rabo "CSV kommagescheiden". Amount carries its own sign; Omschrijving split over 3 cols.
  const rabo = [
    '"IBAN/BBAN","Munt","BIC","Volgnr","Datum","Rentedatum","Bedrag","Saldo na trn","Tegenrekening IBAN/BBAN","Naam tegenpartij","Omschrijving-1","Omschrijving-2","Omschrijving-3"',
    '"NL44RABO0123456789","EUR","RABONL2U","000001","2026-02-03","2026-02-03","-45,10","954,90","NL55INGB0999999999","Shell Tilburg","Tankbeurt","",""',
    '"NL44RABO0123456789","EUR","RABONL2U","000002","2026-02-04","2026-02-04","+2.500,00","3454,90","NL66ABNA0888888888","Groothandel B.V.","Betaling","factuur 26702781","26703066"',
  ].join("\n");
  const r = parseBankCsv(rabo);
  check("2 transactions parsed", r.transactions.length === 2);
  check("own IBAN = IBAN/BBAN (not Tegenrekening)", r.accountIban === "NL44RABO0123456789");
  check("negative signed amount", near(r.transactions[0].amount, -45.1));
  check("positive signed amount with thousands", near(r.transactions[1].amount, 2500));
  check("counterpart = Naam tegenpartij", r.transactions[0].counterpartName === "Shell Tilburg");
  check("counterpart IBAN = Tegenrekening (not own)", r.transactions[0].counterpartIban === "NL55INGB0999999999");
  check("Omschrijving-1/2/3 concatenated", r.transactions[1].description.includes("Betaling") && r.transactions[1].description.includes("26703066"));
}

console.log("\n— bunq CSV (English headers, dot decimals, signed) —");
{
  const bunq = [
    '"Date","Amount","Account","Counterparty","Name","Description"',
    '"2026-03-01","-9.99","NL77BUNQ0011223344","NL88INGB0044556677","Spotify","Abonnement maart"',
    '"2026-03-02","150.00","NL77BUNQ0011223344","NL99RABO0055667788","Webshop Klant","Order 100234"',
  ].join("\n");
  const r = parseBankCsv(bunq);
  check("2 transactions parsed", r.transactions.length === 2);
  check("dot decimal negative", near(r.transactions[0].amount, -9.99));
  check("dot decimal positive", near(r.transactions[1].amount, 150));
  check("counterpart from Name", r.transactions[0].counterpartName === "Spotify");
  check("reference from Description", r.transactions[1].reference === "100234");
}

console.log("\n— honesty guard: a non-bank CSV imports ZERO, with a clear error —");
{
  const products = [
    '"Artikel","Prijs","Voorraad"',
    '"Appels","1,20","40"',
    '"Peren","0,95","30"',
  ].join("\n");
  const r = parseBankCsv(products);
  check("no transactions fabricated", r.transactions.length === 0);
  check("error explains + is non-dismissive (never 'geen bankafschrift')",
    r.parseErrors.length >= 1 && /kolommen.*niet.*herkend/i.test(r.parseErrors[0]) && !/geen bankafschrift/i.test(r.parseErrors[0]));
  check("looksLikeBankCsv is false for a product list", looksLikeBankCsv(products) === false);
  check("looksLikeBankCsv is true for an ING header", looksLikeBankCsv('"Datum";"Naam";"Bedrag (EUR)"\n"20260101";"x";"1,00"') === true);
  check("MT940 content is NOT mistaken for CSV", looksLikeBankCsv(":20:X\n:25:NL91ABNA0417164300") === false);
}

console.log("\n— a row with an unreadable date/amount is skipped and counted —");
{
  const ing = [
    '"Datum";"Naam / Omschrijving";"Af Bij";"Bedrag (EUR)";"Mededelingen"',
    '"20260101";"Goed";"Bij";"10,00";"ok"',
    '"";"Kapot geen datum";"Af";"5,00";"x"',
    '"20260103";"Ook goed";"Af";"7,50";"y"',
  ].join("\n");
  const r = parseBankCsv(ing);
  check("2 valid rows parsed", r.transactions.length === 2);
  check("the 1 broken row is counted in parseErrors", r.parseErrors.some((e) => /overgeslagen/i.test(e)));
}

console.log("\n— normalized export (bankafschrift naar Excel) —");
{
  const ing = [
    '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Af Bij";"Bedrag (EUR)";"Mededelingen"',
    '"20260116";"Klant Jansen BV";"NL11INGB0001234567";"NL33ABNA0222222222";"Bij";"1.210,00";"Factuur 29528"',
    '"20260115";"Albert Heijn";"NL11INGB0001234567";"NL22RABO0111111111";"Af";"53,20";"Pas"',
  ].join("\n");
  const r = parseBankCsv(ing);
  const m = toExportMatrix(r);
  check("header row present", m[0][0] === "Datum" && m[0].includes("Referentie"));
  check("sorted oldest-first", m[1][0] === "2026-01-15" && m[2][0] === "2026-01-16");
  check("amount kept as a positive number + Bij/Af flag", m[2][1] === 1210 && m[2][2] === "Bij");
  check("Af row flagged Af", m[1][2] === "Af");
  const csv = toNormalizedCsv(r);
  check("CSV has UTF-8 BOM", csv.charCodeAt(0) === 0xfeff);
  {
    // Formula-injection guard: a counterpart name starting with '=' must be
    // neutralised with a leading apostrophe so it can't execute in Excel.
    const evil = parseBankCsv([
      '"Datum";"Naam / Omschrijving";"Af Bij";"Bedrag (EUR)";"Mededelingen"',
      '"20260101";"=HYPERLINK(x)";"Af";"1,00";"x"',
    ].join('\n'));
    const out = toNormalizedCsv(evil);
    check("formula-leading name is apostrophe-prefixed", out.includes("'=HYPERLINK") && !/;=HYPERLINK/.test(out));
  }
  check("CSV is semicolon-delimited with comma decimals", csv.includes(";1210,00;") || csv.includes(";53,20;"));
  check("CSV header line present", csv.includes("Datum;Bedrag (EUR)"));
}

console.log("\n— [BANK-CSV] bunq: 'Account' is the OWN rekening, 'Counterparty' the other side —");
{
  const bunq = [
    "Date;Interest Date;Amount;Account;Counterparty;Name;Description",
    "2026-06-20;2026-06-20;150,00;NL77BUNQ0011223344;NL99RABO0055667788;Klant Jansen;factuur 26302050",
    "2026-06-21;2026-06-21;-42,50;NL77BUNQ0011223344;NL13INGB0000000001;Leverancier X;bestelling 8891",
  ].join("\n");
  const r = parseBankCsv(bunq);
  check("bunq: two rows parse", r.transactions.length === 2);
  check("bunq: counterpartIban is the COUNTERPARTY's IBAN", r.transactions[0]?.counterpartIban === "NL99RABO0055667788");
  check("bunq: …never the own account", r.transactions[0]?.counterpartIban !== "NL77BUNQ0011223344");
  check("bunq: the own account lands in accountIban", r.accountIban === "NL77BUNQ0011223344");
  check("bunq: the signed amount keeps its sign", r.transactions[1]?.amount === -42.5);
  check("bunq: the name column still maps", r.transactions[0]?.counterpartName === "Klant Jansen");
}

console.log("\n— [CSV-PREAMBLE] Knab: banner line + CreditDebet sign column —");
{
  const knab = [
    "KNAB EXPORT;;;",
    "Rekeningnummer;Transactiedatum;Valutacode;CreditDebet;Bedrag;Tegenrekeningnummer;Tegenrekeninghouder;Omschrijving",
    "NL12KNAB0123456789;20-06-2026;EUR;D;53,20;NL99RABO0055667788;Albert Heijn 1522;pinbetaling",
    "NL12KNAB0123456789;21-06-2026;EUR;C;250,00;NL89RABO0131703501;W ketels en zn;factuur 26302050",
  ].join("\n");
  check("Knab: the sniffer recognises the file despite the banner", looksLikeBankCsv(knab));
  const r = parseBankCsv(knab);
  check("Knab: both rows parse (banner skipped)", r.transactions.length === 2);
  check("Knab: a D row is NEGATIVE (a debit is money out)", r.transactions[0]?.amount === -53.2);
  check("Knab: a C row is positive", r.transactions[1]?.amount === 250);
  check("Knab: Tegenrekeninghouder is the counterpart NAME", r.transactions[0]?.counterpartName === "Albert Heijn 1522");
  check("Knab: Tegenrekeningnummer is the counterpart IBAN", r.transactions[0]?.counterpartIban === "NL99RABO0055667788");
  check("Knab: the own rekening does not leak into the counterpart", r.transactions[0]?.counterpartIban !== "NL12KNAB0123456789");
}

console.log("\n— [LEES] an unrecognised Af/Bij flag is SAID, never silently guessed —");
{
  const csv = [
    '"Datum";"Naam";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mededelingen"',
    '"20260801";"Sligro";"NL01INGB0001";"NL02RABO0002";"GT";"Onbekend";"250,00";"levering"',
    '"20260802";"Klant BV";"NL01INGB0001";"NL03ABNA0003";"GT";"Bij";"100,00";"factuur 44"',
  ].join("\n");
  const r = parseBankCsv(csv);
  check("both rows still import (refusing a file over one odd flag is worse)", r.transactions.length === 2);
  check("…but the guessed direction is named in the warnings",
    r.parseErrors.some((e) => /Af\/Bij-vlag die we niet herkennen/.test(e)));
  const zonder = parseBankCsv(csv.replace('"Onbekend"', '"Af"'));
  check("a recognised flag produces NO warning", !zonder.parseErrors.some((e) => /herkennen/.test(e)));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
