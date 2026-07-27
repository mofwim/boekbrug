// [ICP] Pure node test — run: npx tsx src/lib/icp.test.ts
import {
  classifyVatNumber, normalizeVatNumber, buildIcp, icpNote, buildIcpCsv, ICP_MIN_EUR,
  buildForeignPurchases, foreignPurchaseNote, buildForeignPurchaseCsv,
  type IcpInvoice,
} from "./icp";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

const inv = (over: Partial<IcpInvoice> = {}): IcpInvoice => ({
  invoiceNumber: "2026-001", clientName: "Müller GmbH", clientVatNumber: "DE123456789",
  direction: "outgoing", status: "sent", totalExBtw: 1000, btwAmount: 0, ...over,
});
const icp = (invoices: IcpInvoice[], korActive = false) => buildIcp({ invoices, korActive });

console.log("\n— reading a VAT number the way a human wrote it —");
{
  check("spaces and dots are not part of the number", normalizeVatNumber(" de 1234.567-89 ") === "DE123456789");
  check("null is the empty string, never 'null'", normalizeVatNumber(null) === "");
  const de = classifyVatNumber("DE 123 456 789");
  check("a German number is another member state", de.kind === "eu" && de.country === "DE");
  check("…and it is stored normalised, as the opgaaf wants it", de.kind === "eu" && de.vat === "DE123456789");
  check("Greece is filed as EL even when written GR", (() => { const g = classifyVatNumber("GR123456789"); return g.kind === "eu" && g.country === "EL"; })());
  check("a Dutch customer is domestic, never ICP", classifyVatNumber("NL123456789B01").kind === "domestic");
  check("no number at all → nothing to classify", classifyVatNumber(null).kind === "none");
  check("an empty field is not a country", classifyVatNumber("  ").kind === "none");
  check("a non-EU prefix is left alone", classifyVatNumber("US123456789").kind === "none");
  check("a number without a country prefix is not guessed at", classifyVatNumber("123456789").kind === "none");
}

console.log("\n— a length that cannot be right is flagged, a valid one never is —");
{
  check("DE with a digit dropped is suspect", classifyVatNumber("DE12345678").kind === "eu_suspect");
  check("DE with a digit too many is suspect", classifyVatNumber("DE1234567890").kind === "eu_suspect");
  check("BE has ten digits", classifyVatNumber("BE0123456789").kind === "eu");
  check("FR has eleven characters, letters included", classifyVatNumber("FRXX123456789").kind === "eu");
  check("AT starts with a U", classifyVatNumber("ATU12345678").kind === "eu");
  check("SE has twelve", classifyVatNumber("SE123456789001").kind === "eu");
  check("IE accepts both its lengths", classifyVatNumber("IE1234567A").kind === "eu" && classifyVatNumber("IE1234567AA").kind === "eu");
  check("a note typed into the field is not a number", classifyVatNumber("DE onbekend nog").kind === "eu_suspect");
}

console.log("\n— rubriek 3b: what belongs in it —");
{
  const r = icp([inv()]);
  check("one EU sale becomes one ICP line", r.lines.length === 1 && near(r.totalExBtw, 1000));
  check("…keyed on the VAT number, with the country beside it", r.lines[0].vatNumber === "DE123456789" && r.lines[0].country === "DE");
  const two = icp([inv(), inv({ invoiceNumber: "2026-002", totalExBtw: 500 })]);
  check("two invoices to the same customer are ONE line", two.lines.length === 1 && near(two.totalExBtw, 1500));
  check("…and the line counts them", two.lines[0].invoiceCount === 2);
  const multi = icp([inv(), inv({ invoiceNumber: "2026-003", clientVatNumber: "BE0123456789", clientName: "Janssens BVBA", totalExBtw: 4000 })]);
  check("two customers are two lines", multi.lines.length === 2);
  check("the biggest customer is listed first", multi.lines[0].vatNumber === "BE0123456789");
}

console.log("\n— what must stay OUT of 3b —");
{
  check("a purchase is not an intra-EU supply of yours", icp([inv({ direction: "incoming" })]).lines.length === 0);
  check("a concept was never declared", icp([inv({ status: "draft" })]).lines.length === 0);
  check("an archived row was never declared either", icp([inv({ status: "archived" })]).lines.length === 0);
  check("a Dutch customer stays domestic", icp([inv({ clientVatNumber: "NL123456789B01" })]).lines.length === 0);
  check("an EU CONSUMER (no VAT number) is not ICP", icp([inv({ clientVatNumber: null })]).lines.length === 0);
  check("KOR short-circuits the whole thing", icp([inv()], true).lines.length === 0);
}

console.log("\n— BTW on an EU sale: reported, never quietly moved —");
{
  const r = icp([inv({ btwAmount: 210 })]);
  check("it does NOT become a 3b line", r.lines.length === 0);
  check("…because its BTW lives in 1a, and moving it would drop it out of 5a", near(r.totalExBtw, 0));
  check("it is reported as a problem instead", r.problems.length === 1 && r.problems[0].kind === "btw_charged");
  check("the problem names the invoice, so it can be found", r.problems[0].invoiceNumber === "2026-001");
  const susp = icp([inv({ clientVatNumber: "DE12345678" })]);
  check("a suspect number is a problem, not a silent drop", susp.problems.length === 1 && susp.problems[0].kind === "suspect_vat");
  check("…and it is not listed either — an afgekeurde opgaaf counts as not done", susp.lines.length === 0);
  check("the suspect note points at VIES", /VIES/.test(susp.problems[0].detail));
}

console.log("\n— creditnotas net out, as the opgaaf expects —");
{
  const r = icp([inv({ totalExBtw: 1000 }), inv({ invoiceNumber: "2026-C1", totalExBtw: -400 })]);
  check("a credit reduces the customer's ICP amount", near(r.totalExBtw, 600));
  const zeroed = icp([inv({ totalExBtw: 1000 }), inv({ invoiceNumber: "2026-C1", totalExBtw: -1000 })]);
  check("fully credited → no line at all (a €0 line invites a letter)", zeroed.lines.length === 0);
  const negative = icp([inv({ invoiceNumber: "2026-C1", totalExBtw: -1000 })]);
  check("a credit whose invoice was a previous quarter is a real negative line", negative.lines.length === 1 && near(negative.totalExBtw, -1000));
}

console.log("\n— the note says the part the rubrieken cannot —");
{
  const note = icpNote(icp([inv()]))!;
  check("it names rubriek 3b", /3b/.test(note));
  check("it says a SEPARATE opgaaf exists", /APARTE ICP-opgaaf/.test(note));
  check("it says this app did not file it", /NIET ingediend/.test(note));
  check("nothing intra-EU → no note at all", icpNote(icp([inv({ clientVatNumber: "NL123456789B01" })])) === null);
  const probNote = icpNote(icp([inv({ btwAmount: 210 })]))!;
  check("a problem alone still produces a note", probNote !== null && /niet zo in de ICP-opgaaf/.test(probNote));
  const tiny = icp([inv({ totalExBtw: 0.2 })]);
  check("below materiality there is no line to state", tiny.lines.length === 0 && ICP_MIN_EUR === 0.5);
}

console.log("\n— the CSV the accountant gets —");
{
  const r = icp([inv(), inv({ invoiceNumber: "2026-002", btwAmount: 210 })]);
  const csv = buildIcpCsv(r, "Q3 2026");
  check("it is loudly a concept", /GEEN ingediende opgaaf/.test(csv));
  check("it says the ICP stands apart from the aangifte", /LOS van de BTW-aangifte/.test(csv));
  check("it has the columns the form asks for", /Land;BTW-nummer;Klant;Bedrag \(excl\. BTW\);Facturen/.test(csv));
  check("the customer line is there with a Dutch decimal comma", /DE;DE123456789;Müller GmbH;1000,00;1/.test(csv));
  check("the total is labelled as rubriek 3b, so the two can be tied", /Totaal \(= rubriek 3b\);1000,00/.test(csv));
  check("the problem invoices get their own section", /Eerst controleren/.test(csv));
  check("a semicolon in a name could never break a column", buildIcpCsv(icp([inv({ clientName: "A;B GmbH" })]), "Q3 2026").includes('"A;B GmbH"'));
}

console.log("\n— the purchase mirror: EU-inkopen listed, never computed —");
{
  const pur = (over: Partial<IcpInvoice> = {}): IcpInvoice => ({
    invoiceNumber: "LEV-9", clientName: "Hansen GmbH", clientVatNumber: "DE987654321",
    direction: "incoming", status: "received", totalExBtw: 800, btwAmount: 0, ...over,
  });
  const fp = (invoices: IcpInvoice[]) => buildForeignPurchases({ invoices });

  check("an EU supplier invoice is listed", fp([pur()]).purchases.length === 1);
  check("…with the country and the total", near(fp([pur()]).totalExBtw, 800) && fp([pur()]).purchases[0].country === "DE");
  check("a Dutch supplier is not a foreign purchase", fp([pur({ clientVatNumber: "NL123456789B01" })]).purchases.length === 0);
  check("a supplier with no VAT number cannot be placed in 4b", fp([pur({ clientVatNumber: null })]).purchases.length === 0);
  check("a SALE is not a purchase", fp([pur({ direction: "outgoing" })]).purchases.length === 0);
  check("a row still in the processing queue is not counted", fp([pur({ status: "processing" })]).purchases.length === 0);
  check("a PAID EU purchase still needs placing in 4b", fp([pur({ status: "paid" })]).purchases.length === 1);
  check("a suspect number is still listed — a listing cannot be rejected",
    fp([pur({ clientVatNumber: "DE98765432" })]).purchases.length === 1);
  check("BTW on the supplier invoice is flagged, not hidden",
    fp([pur({ btwAmount: 152 })]).purchases[0].btwCharged === true);
  check("biggest purchase first", fp([pur(), pur({ invoiceNumber: "LEV-10", totalExBtw: 5000 })]).purchases[0].invoiceNumber === "LEV-10");

  const note = foreignPurchaseNote(fp([pur()]))!;
  check("the note names rubriek 4b and the aftrek in 5b", /4b/.test(note) && /5b/.test(note));
  check("it says plainly that the app does NOT compute it", /berekent die verlegging NIET/.test(note));
  check("it says WHY not (a judgement, and KOR breaks the cancelling)", /beoordeling/.test(note) && /KOR/.test(note));
  check("it names the invoices, so nobody has to hunt", /LEV-9/.test(note));
  check("nothing foreign → no note", foreignPurchaseNote(fp([pur({ clientVatNumber: "NL123456789B01" })])) === null);
  check("a supplier that charged BTW gets its own warning in the note",
    /waarschijnlijk geen verlegde inkoop/.test(foreignPurchaseNote(fp([pur({ btwAmount: 152 })]))!));

  const csv = buildForeignPurchaseCsv(fp([pur(), pur({ invoiceNumber: "LEV-10", btwAmount: 152 })]), "Q3 2026");
  check("the CSV says it is a list, not a calculation", /LIJST, geen berekening/.test(csv));
  check("it warns that 4b and 5b are NOT in the concept", /NIET in het concept/.test(csv));
  check("each row carries the supplier, the invoice and the amount", /DE;DE987654321;Hansen GmbH;LEV-9;800,00;nee/.test(csv));
  check("a supplier that charged BTW is marked for checking", /LEV-10;800,00;ja — controleer/.test(csv));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
