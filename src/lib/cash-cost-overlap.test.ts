// [KAS-DUBBELE-KOST] Pure node test — run: npx tsx src/lib/cash-cost-overlap.test.ts
import {
  detectCashCostOverlaps, overlapTotals, isOwnerTypedCost, booksACost, descriptionNamesSupplier,
  OVERLAP_WINDOW_DAYS, doubleCostNote, type CashCostEntry, type PurchaseForOverlap,
} from "./cash-cost-overlap";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

const entry = (over: Partial<CashCostEntry> = {}): CashCostEntry => ({
  id: "k1", entry_date: "2026-05-12", direction: "out", amount: 121, category: "kosten",
  description: "Enka Horeca contant", invoice_id: null, btw_rate: null, document_id: null, ...over,
});
const bill = (over: Partial<PurchaseForOverlap> = {}): PurchaseForOverlap => ({
  id: "f1", invoice_number: "26701681", client_name: "Enka Horeca B.V.", invoice_date: "2026-05-12",
  payment_date: null, total_ex_btw: 100, total_inc_btw: 121, status: "received",
  payment_method: null, invoice_type: "factuur", direction: "incoming", ...over,
});
const find = (entries: CashCostEntry[], invoices: PurchaseForOverlap[]) =>
  detectCashCostOverlaps({ entries, invoices });

console.log("\n— which cash lines are the owner's own cost —");
{
  check("a typed 'kosten' outflow is", isOwnerTypedCost(entry()));
  // The system settlement of a cash-paid invoice IS the correct mechanism. Flagging it would
  // report the fix as the fault.
  check("a 'betaling' settlement is NOT", isOwnerTypedCost(entry({ category: "betaling" })) === false);
  check("…nor is anything carrying invoice_id, whatever its label",
    isOwnerTypedCost(entry({ invoice_id: "f1" })) === false);
  check("money IN under 'kosten' is a refund, not a second cost",
    isOwnerTypedCost(entry({ direction: "in" })) === false);
  check("a zero line is nothing at all", isOwnerTypedCost(entry({ amount: 0 })) === false);
  check("another category is not a cost", isOwnerTypedCost(entry({ category: "prive" })) === false);
}

console.log("\n— which invoices actually book a cost —");
{
  check("a received purchase does", booksACost(bill()));
  check("a paid purchase does too", booksACost(bill({ status: "paid" })));
  // financial-result.ts counts only paid|received, so a row it never counted is not doubled.
  check("one in the verify queue does not", booksACost(bill({ status: "processing" })) === false);
  check("a draft does not", booksACost(bill({ status: "draft" })) === false);
  check("a creditnota is the reverse of a cost", booksACost(bill({ invoice_type: "creditnota" })) === false);
  check("a SALES invoice is not a purchase", booksACost(bill({ direction: "outgoing" })) === false);
  check("an absent direction reads as the purchase it was queried as",
    booksACost(bill({ direction: null })));
}

console.log("\n— the supplier name as a witness —");
{
  check("the legal suffix is folded", descriptionNamesSupplier("betaald enka horeca", "Enka Horeca B.V."));
  check("diacritics are folded", descriptionNamesSupplier("cafe de kroon", "Café de Kroon"));
  // The fragment bug [TRUST-MATCH] closed for invoice numbers, in its supplier form.
  check("a name inside a longer word is NOT a match",
    descriptionNamesSupplier("kroonluchter gekocht", "Kroon") === false);
  check("…while the word itself still is", descriptionNamesSupplier("kroon gekocht", "Kroon"));
  check("a multi-word supplier must appear in order",
    descriptionNamesSupplier("horeca enka", "Enka Horeca") === false);
  check("a short supplier is never used as a witness",
    descriptionNamesSupplier("bon van de bv", "BV") === false);
  check("no description names nobody", descriptionNamesSupplier(null, "Enka Horeca") === false);
}

console.log("\n— the pair itself —");
{
  const hits = find([entry()], [bill()]);
  check("the same amount on the same day is one question", hits.length === 1);
  check("…matched on the gross", hits[0]?.basis === "gross");
  check("…with the supplier named", hits[0]?.nameMatched === true);
  check("…and the cost it doubles is the invoice's ex-BTW", near(hits[0]?.doubleCountedCost ?? 0, 100));
  // A bare typed line claims no BTW of its own — financial-result.ts needs document_id AND a rate.
  check("a bare line doubles the cost and NOT the btw", near(hits[0]?.doubleCountedBtw ?? -1, 0));
  check("the drawer is only doubled when the invoice is settled in cash too",
    hits[0]?.drawerDoubled === false);
}

console.log("\n— the expensive case: the drawer goes down twice —");
{
  // The invoice is paid in cash, so reconcileCashSettlements already wrote its own 'betaling'
  // entry. The hand-typed line takes the till down a second time for one handover.
  const hits = find([entry()], [bill({ status: "paid", payment_method: "kas" })]);
  check("it is reported as such", hits[0]?.drawerDoubled === true);
  const t = overlapTotals(hits);
  check("the drawer figure is the amount that left twice", near(t.drawer, 121));
  check("…and the cost figure is still the ex-BTW", near(t.cost, 100));
}

console.log("\n— the owner typed the ex-BTW figure —");
{
  const hits = find([entry({ amount: 100 })], [bill()]);
  check("the net figure is the same money", hits.length === 1 && hits[0].basis === "net");
  check("…and the doubled cost is still € 100", near(hits[0]?.doubleCountedCost ?? 0, 100));
}

console.log("\n— a bon + a rate claims voorbelasting a second time —");
{
  const hits = find([entry({ document_id: "d1", btw_rate: 21 })], [bill()]);
  check("the doubled btw is reported", near(hits[0]?.doubleCountedBtw ?? 0, 21));
  check("a rate with NO bon claims nothing (financial-result requires both)",
    near(find([entry({ btw_rate: 21 })], [bill()])[0]?.doubleCountedBtw ?? -1, 0));
}

console.log("\n— what must stay silent —");
{
  check("a cent off is a different purchase", find([entry({ amount: 121.01 })], [bill()]).length === 0);
  check("outside the window is a different month's bill",
    find([entry({ entry_date: "2026-08-01" })], [bill()]).length === 0);
  check(`inside the window (${OVERLAP_WINDOW_DAYS} days) is still offered`,
    find([entry({ entry_date: "2026-06-11" })], [bill()]).length === 1);
  // A date neither side can read is not evidence — silence beats a question nobody can check.
  check("an unreadable entry date is not a pair",
    find([entry({ entry_date: null })], [bill()]).length === 0);
  check("an invoice with no date at all is not a pair",
    find([entry()], [bill({ invoice_date: null, payment_date: null })]).length === 0);
  // The payment date is nearer to when the money moved than a late-arriving invoice date.
  check("a late invoice still pairs through its payment date",
    find([entry()], [bill({ invoice_date: "2026-01-02", payment_date: "2026-05-12" })]).length === 1);
  check("nothing at all → nothing", find([], [bill()]).length === 0 && find([entry()], []).length === 0);
}

console.log("\n— one row is never accused four times —");
{
  // Two identical amounts in one month: two questions about two pairs, not a cross product.
  const hits = find(
    [entry({ id: "k1", description: "enka horeca" }), entry({ id: "k2", entry_date: "2026-05-14", description: "contant" })],
    [bill({ id: "f1" }), bill({ id: "f2", invoice_number: "26701999", invoice_date: "2026-05-14" })],
  );
  check("two pairs, not four", hits.length === 2);
  check("each cash line used once", new Set(hits.map((h) => h.entry.id)).size === 2);
  check("each invoice used once", new Set(hits.map((h) => h.invoice.id)).size === 2);
  // The named supplier is independent evidence and outranks a nearer date, so k1 keeps f1.
  check("the named pairing wins its invoice",
    hits.find((h) => h.entry.id === "k1")?.invoice.id === "f1");

  // Deterministic: the same books must produce the same list, or one question reads as two.
  const again = find(
    [entry({ id: "k1", description: "enka horeca" }), entry({ id: "k2", entry_date: "2026-05-14", description: "contant" })],
    [bill({ id: "f1" }), bill({ id: "f2", invoice_number: "26701999", invoice_date: "2026-05-14" })],
  );
  check("the order is stable across runs",
    JSON.stringify(again.map((h) => [h.entry.id, h.invoice.id])) ===
    JSON.stringify(hits.map((h) => [h.entry.id, h.invoice.id])));
}

console.log("\n— the totals —");
{
  const hits = find(
    [entry({ id: "k1" }), entry({ id: "k2", entry_date: "2026-05-20", amount: 60.5, description: "diesel" })],
    [bill({ id: "f1" }), bill({ id: "f2", invoice_number: "X2", client_name: "Tankstation",
      invoice_date: "2026-05-20", total_ex_btw: 50, total_inc_btw: 60.5, status: "paid", payment_method: "kas" })],
  );
  const t = overlapTotals(hits);
  check("both pairs counted", t.count === 2);
  check("the doubled cost adds up", near(t.cost, 150));
  check("only the cash-settled one moves the drawer figure", near(t.drawer, 60.5));
  check("an empty set is all zeroes", JSON.stringify(overlapTotals([])) === JSON.stringify({ count: 0, cost: 0, btw: 0, drawer: 0 }));
}

console.log("\n— the note the accountant reads on the aangifte —");
{
  const one = doubleCostNote(find([entry()], [bill()]))!;
  check("it opens with LET OP, like the other money-moving notes", /^LET OP/.test(one));
  check("it names the invoice", /26701681/.test(one));
  check("it names what is deducted twice", /€100/.test(one));
  check("it says the app did not correct it", /NIET automatisch/.test(one));
  // The whole reason this is a note and not a block: it is evidence, not proof.
  check("it admits it is not a certainty", /geen zekerheid|twee losse aankopen/.test(one));
  check("it sends the owner where they can act", /Kas-pagina/.test(one));
  check("no btw sentence when no btw was doubled", !/btw/.test(one) || !/twee keer is teruggevraagd/.test(one));
  check("no drawer sentence when the drawer moved once", !/kassaldo/.test(one));

  const worst = doubleCostNote(find([entry({ document_id: "d1", btw_rate: 21 })],
    [bill({ status: "paid", payment_method: "kas" })]))!;
  check("the doubled btw gets its own sentence", /€21 btw/.test(worst));
  check("…and so does the drawer that stands too low", /kassaldo €121 te laag/.test(worst));

  check("nothing found → no note", doubleCostNote([]) === null);
  // Materiality: below half a euro the figure rounds to €0 everywhere, and "1 regel, €0 dubbel"
  // is noise on the page an owner files from.
  const tiny = find([entry({ amount: 0.4 })], [bill({ total_ex_btw: 0.33, total_inc_btw: 0.4 })]);
  check("an immaterial pair is found but not noted",
    tiny.length === 1 && doubleCostNote(tiny) === null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
