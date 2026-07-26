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

console.log("\n— the normal case: an issued invoice is ARCHIVED, never destroyed —");
{
  const d = decideRemoval(out());
  check("a sent sales invoice archives", d.mode === "archive" && d.allowed === true);
  check("it says what stops counting", /omzet en BTW/.test(d.body));
  check("it says it will not be chased anymore", /aangemaand/.test(d.body));
  check("it promises the 7-year keep", /7 jaar bewaarplicht/.test(d.body));
  check("it promises reversibility", /terugzetten/.test(d.body));
  check("it names the invoice", d.body.includes("20260041"));
  check("it asks the one question only the owner can answer", /al naar je klant gestuurd/.test(d.warning ?? ""));
  check("...and offers the creditnota next to it", d.alternative?.kind === "creditnota");
}
{
  const d = decideRemoval(out({ status: "overdue" }));
  check("an overdue invoice behaves the same", d.mode === "archive");
}
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

console.log("\n— money is the line that is never crossed —");
{
  const d = decideRemoval(out({ status: "paid", amount_paid: 1210 }));
  check("a PAID sales invoice is never removed", d.mode === "creditnota" && d.allowed === false);
  check("it names the legal instrument", /creditnota/.test(d.body));
  check("...and says why", /Belastingdienst|mag niet uit je boekhouding/.test(d.body));
}
{
  // The case the partial-payment engine made possible: still 'sent', but €500 has arrived.
  const d = decideRemoval(out({ amount_paid: 500 }));
  check("a PARTLY paid invoice is not removable either", d.allowed === false);
  check("it states the amount already settled", d.body.includes("500,00"));
  check("it states the total it belongs to", d.body.includes("1.210,00"));
  check("it tells the owner how to get out", /betaling terug/i.test(d.warning ?? ""));
}
{
  const d = decideRemoval(inc({ status: "paid", amount_paid: 605 }));
  check("a paid PURCHASE invoice is blocked", d.mode === "blocked" && d.allowed === false);
  check("it points at the undo path", d.alternative?.kind === "undo-payment");
  check("it explains the money would vanish", /kas- en bankoverzicht/.test(d.body));
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
  const d = decideRemoval(out({ invoice_type: "pro_forma", status: "sent" }));
  check("an offerte is deleted even when sent", d.mode === "delete");
  check("it explains an offerte is not a factuur", /geen factuur/.test(d.body));
}
{
  // A draft that already has money against it is still not a plain delete.
  const d = decideRemoval(out({ status: "draft", amount_paid: 100 }));
  check("money outranks 'it is only a concept'", d.mode !== "delete" && d.allowed === false);
}

console.log("\n— a creditnota —");
{
  const d = decideRemoval(out({ invoice_type: "creditnota", invoice_number: "20260042" }));
  check("an unpaid creditnota archives", d.mode === "archive" && d.allowed === true);
  check("it warns the original becomes chaseable again", /weer als openstaand/.test(d.warning ?? ""));
  check("...and that it will be chased again", /aangemaand/.test(d.warning ?? ""));
}
{
  const d = decideRemoval(out({ invoice_type: "creditnota", status: "paid", amount_paid: 500 }));
  check("a settled creditnota is blocked, not 'creditnota'", d.mode === "blocked");
}

console.log("\n— coming back —");
{
  const d = decideRemoval(out({ status: "archived" }));
  check("an archived invoice offers restore", d.mode === "restore" && d.allowed === true);
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
  check("an open sales invoice may be archived", refuseArchive(out()) === null);
  check("an overdue one too", refuseArchive(out({ status: "overdue" })) === null);
  check("an open purchase invoice too", refuseArchive(inc()) === null);
  check("one in the verify queue too", refuseArchive(inc({ status: "processing" })) === null);
  check("paid is refused", refuseArchive(out({ status: "paid" })) === "money_settled");
  check("partly paid is refused", refuseArchive(out({ amount_paid: 1 })) === "money_settled");
  check("verwerkt is refused", refuseArchive(out({ accountant_status: "verwerkt" })) === "verwerkt");
  check("already archived is refused", refuseArchive(out({ status: "archived" })) === "already_archived");
  check("a draft is not archived (it is deleted)", refuseArchive(out({ status: "draft" })) === "not_archivable");
  check("an unknown status is refused", refuseArchive(out({ status: "zzz" })) === "not_archivable");
  check("the lock is checked before the money", refuseArchive(out({ status: "paid", accountant_status: "verwerkt" })) === "verwerkt");
}

console.log("\n— restoreStatus: derived from what the row proves, never guessed —");
{
  check("incoming always returns to the verify queue", restoreStatus(inc()) === "processing");
  check("...even when it was 'received'", restoreStatus(inc({ status: "archived" })) === "processing");
  check("an outgoing invoice WITH a number was issued → sent", restoreStatus(out({ status: "archived" })) === "sent");
  check("an outgoing invoice WITHOUT a number was a concept → draft",
    restoreStatus(out({ status: "archived", invoice_number: null })) === "draft");
  check("a blank number counts as none", restoreStatus(out({ invoice_number: "   " })) === "draft");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
