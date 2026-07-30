// [INVOICE-REMOVE] Pure node test — run: npx tsx src/lib/invoice-removal.test.ts
import {
  decideRemoval,
  refuseArchive,
  restoreStatus,
  hasSettledMoney,
  type RemovalInvoice,
} from "./invoice-removal";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const out = (o: Partial<RemovalInvoice> = {}): RemovalInvoice => ({
  direction: "outgoing", invoice_type: "factuur", status: "sent",
  invoice_number: "20260041", total_inc_btw: 1210, amount_paid: 0, ...o,
});
const inc = (o: Partial<RemovalInvoice> = {}): RemovalInvoice => ({
  direction: "incoming", invoice_type: "factuur", status: "received",
  invoice_number: "2026-045", total_inc_btw: 605, amount_paid: 0, ...o,
});

console.log("\n— [ISSUED-STAYS] an issued SALES invoice is never removed, in any state —");
{
  // The rule: its number comes from our own doorlopende reeks (art. 35), and a hole in that
  // sequence is what an auditor looks for. It is corrected, not removed.
  const d = decideRemoval(out());
  check("a sent sales invoice is refused", d.allowed === false);
  check("...and pointed at the creditnota", d.mode === "creditnota" && d.alternative?.kind === "creditnota");
  check("the reason named is the numbering itself", /doorlopende reeks|gat/.test(d.body));
  check("it names the invoice", d.body.includes("20260041"));
  check("the never-sent case is acknowledged, not silently refused", /nooit verstuurd/.test(d.warning ?? ""));
}
{
  check("an overdue invoice is refused too", decideRemoval(out({ status: "overdue" })).allowed === false);
  check("a paid one as well", decideRemoval(out({ status: "paid", amount_paid: 1210 })).allowed === false);
  check("and a partly paid one", decideRemoval(out({ amount_paid: 500 })).allowed === false);
  // The rule outranks the money check: the answer is the same either way, and the sequence is
  // the honest reason.
  check("the numbering reason is given even when money moved",
    /doorlopende reeks/.test(decideRemoval(out({ amount_paid: 500 })).body));
}
{
  const d = decideRemoval(out({ invoice_type: "creditnota", invoice_number: "20260042" }));
  check("a creditnota is not removable either (it has its own number)", d.allowed === false && d.mode === "blocked");
  check("...and it says the original would re-open", /openstaand/.test(d.body));
}

console.log("\n— the purchase side: an invoice that isn't yours must be removable —");
{
  const d = decideRemoval(inc());
  check("an incoming invoice archives", d.mode === "archive" && d.allowed === true);
  check("it names the cost side, not omzet", /kosten en voorbelasting/.test(d.body));
  check("it warns about losing the voorbelasting", /voorbelasting/.test(d.warning ?? ""));
  check("no creditnota offer on a purchase invoice", d.alternative === undefined);
}
{
  const d = decideRemoval(inc({ status: "processing" }));
  check("an unverified incoming invoice archives too", d.mode === "archive");
}

console.log("\n— money is the line that is never crossed (purchase side) —");
{
  const d = decideRemoval(inc({ status: "paid", amount_paid: 605 }));
  check("a paid PURCHASE invoice is blocked", d.mode === "blocked" && d.allowed === false);
  check("it points at the undo path", d.alternative?.kind === "undo-payment");
  check("it explains the money would vanish", /kas- en bankoverzicht/.test(d.body));
  check("it states the amount already settled", d.body.includes("605,00") || /betaald/.test(d.body));
}
{
  const half = decideRemoval(inc({ amount_paid: 200 }));
  check("a partly paid purchase invoice is blocked too", half.allowed === false);
  check("it names what was already settled", half.body.includes("200,00"));
  check("it tells the owner how to get out", /betaling terug/i.test(half.warning ?? ""));
}
{
  check("a cent of dust is not a payment", hasSettledMoney(out({ amount_paid: 0.004 })) === false);
  check("a real instalment is", hasSettledMoney(out({ amount_paid: 0.02 })) === true);
  check("status paid counts even without an amount", hasSettledMoney(out({ status: "paid", amount_paid: 0 })) === true);
}

console.log("\n— the accountant's lock outranks the owner's tap —");
{
  const d = decideRemoval(out({ accountant_status: "verwerkt" }));
  check("a verwerkt invoice is blocked", d.mode === "blocked" && d.allowed === false);
  check("it names who locked it", /boekhouder/.test(d.body));
  check("it offers the only way forward", d.alternative?.kind === "ask-accountant");
  // …and it outranks money: a verwerkt PAID invoice reports the lock, not the creditnota.
  const p = decideRemoval(out({ status: "paid", accountant_status: "verwerkt" }));
  check("the lock is reported before the payment", p.title.includes("boekhouder"));
}

console.log("\n— what was never a bookkeeping record is really deleted —");
{
  const d = decideRemoval(out({ status: "draft", invoice_number: null }));
  check("a concept is deleted for real", d.mode === "delete" && d.allowed === true);
  check("it is honest that this is final", /niet ongedaan/.test(d.warning ?? ""));
  check("it says the concept counted nowhere", /telt nergens in mee/.test(d.body));
}
{
  // [OFFERTE-SENT-ARCHIVE] This case used to assert `mode === "delete"`, and that expectation was
  // wrong rather than merely outdated: the delete it locked in could not complete. The RLS delete
  // policy on `invoices` permits status='draft' only, while the one on `invoice_lines` has no
  // status test — so a SENT offerte lost its lines, kept its row, and the screen said "Verwijderd".
  // A sent offerte is archived now; the full rule is exercised in its own block below.
  const d = decideRemoval(out({ invoice_type: "pro_forma", status: "sent" }));
  check("a SENT offerte is archived, not deleted", d.mode === "archive" && d.allowed === true);
  check("it explains an offerte is not a factuur", /geen factuur/.test(d.body));
  const draft = decideRemoval(out({ invoice_type: "pro_forma", status: "draft" }));
  check("a DRAFT offerte is still deleted for real", draft.mode === "delete");
  check("...and it explains an offerte is not a factuur too", /geen factuur/.test(draft.body));
}
{
  // A draft that already has money against it is still not a plain delete.
  const d = decideRemoval(out({ status: "draft", amount_paid: 100 }));
  check("money outranks 'it is only a concept'", d.mode !== "delete" && d.allowed === false);
}

console.log("\n— coming back —");
{
  const d = decideRemoval(inc({ status: "archived" }));
  check("an archived purchase invoice offers restore", d.mode === "restore" && d.allowed === true);
  check("it says the figures come back too", /telt weer mee/.test(d.body));
}
{
  const d = decideRemoval(inc({ status: "archived" }));
  check("a restored purchase invoice goes via the queue", /controlewachtrij/.test(d.warning ?? ""));
}
{
  const d = decideRemoval(out({ status: "archived", replaced_by_number: "20260099" }));
  check("an invoice replaced by a creditnota can NOT come back", d.mode === "blocked" && d.allowed === false);
  check("it names the creditnota that replaced it", d.body.includes("20260099"));
  check("it explains the double-count", /dubbel/.test(d.body));
}

console.log("\n— refuseArchive: the server's own answer (it never trusts the client) —");
{
  check("[ISSUED-STAYS] an open sales invoice is refused", refuseArchive(out()) === "issued_sales_invoice");
  check("...an overdue one too", refuseArchive(out({ status: "overdue" })) === "issued_sales_invoice");
  check("...and a paid one (the rule does not depend on the money)",
    refuseArchive(out({ status: "paid" })) === "issued_sales_invoice");
  check("an open purchase invoice may be archived", refuseArchive(inc()) === null);
  check("one in the verify queue too", refuseArchive(inc({ status: "processing" })) === null);
  check("a paid purchase invoice is refused", refuseArchive(inc({ status: "paid" })) === "money_settled");
  check("a partly paid one is refused", refuseArchive(inc({ amount_paid: 1 })) === "money_settled");
  check("verwerkt is refused", refuseArchive(inc({ accountant_status: "verwerkt" })) === "verwerkt");
  check("already archived is refused", refuseArchive(inc({ status: "archived" })) === "already_archived");
  check("an unknown status is refused", refuseArchive(inc({ status: "zzz" })) === "not_archivable");
  check("the lock is checked before everything else",
    refuseArchive(out({ status: "paid", accountant_status: "verwerkt" })) === "verwerkt");
}

console.log("\n— [OFFERTE-SENT-ARCHIVE] a SENT offerte is archived, never deleted —");
{
  // The delete path strips invoice_lines from the browser, but the RLS delete policy on
  // `invoices` permits status='draft' only — so a sent offerte lost its lines and kept its row.
  // The screen said "Verwijderd"; a refresh brought back an EMPTY offerte, and "Maak factuur aan"
  // (which reads exactly those lines) then produced an invoice with no items.
  const offerte = (o: Partial<RemovalInvoice> = {}): RemovalInvoice =>
    out({ invoice_type: "offerte", invoice_number: null, ...o });

  check("a DRAFT offerte is still really deleted", decideRemoval(offerte({ status: "draft" })).mode === "delete");
  check("a DRAFT pro_forma too", decideRemoval(offerte({ status: "draft", invoice_type: "pro_forma" })).mode === "delete");
  check("a SENT offerte is archived instead", decideRemoval(offerte({ status: "sent" })).mode === "archive");
  check("...and is allowed", decideRemoval(offerte({ status: "sent" })).allowed === true);
  check("a SENT pro_forma too", decideRemoval(offerte({ status: "sent", invoice_type: "pro_forma" })).mode === "archive");
  check("the dialog says it is not a factuur (no omzet/BTW claim)",
    /geen factuur/i.test(decideRemoval(offerte({ status: "sent" })).body));

  // The two layers must agree: the dialog offering an archive that the route refuses is the
  // same class of lie as the delete that silently half-succeeded.
  check("the SERVER allows archiving a sent offerte", refuseArchive(offerte({ status: "sent" })) === null);
  check("...an overdue one too", refuseArchive(offerte({ status: "overdue" })) === null);
  check("a PAID offerte is still refused (money moved)",
    refuseArchive(offerte({ status: "sent", amount_paid: 500 })) === "money_settled");
  check("a DRAFT offerte is NOT archivable (it goes down the delete path)",
    refuseArchive(offerte({ status: "draft" })) === "not_archivable");
  check("verwerkt still outranks it", refuseArchive(offerte({ status: "sent", accountant_status: "verwerkt" })) === "verwerkt");
  // CONTROL: the ordinary sales invoice must be unaffected by the new branch.
  check("CONTROL a sent FACTUUR is still refused", refuseArchive(out()) === "issued_sales_invoice");
}

console.log("\n— restoreStatus: derived from what the row proves, never guessed —");
{
  check("incoming always returns to the verify queue", restoreStatus(inc()) === "processing");
  check("...even when it was 'received'", restoreStatus(inc({ status: "archived" })) === "processing");
  // The pure rule still answers for the outgoing shape (the route refuses those separately —
  // [ISSUED-STAYS] — but a derivation that guesses would be worse than one that is defined).
  check("an outgoing invoice WITH a number derives 'sent'", restoreStatus(out({ status: "archived" })) === "sent");
  check("one WITHOUT a number derives 'draft'", restoreStatus(out({ status: "archived", invoice_number: null })) === "draft");
  check("a blank number counts as none", restoreStatus(out({ invoice_number: "   " })) === "draft");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
