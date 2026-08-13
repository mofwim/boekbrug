// [CREDITNOTA-NO-CHASE] Pure node test — run: npx tsx src/lib/credited-invoices.test.ts
//
// The regression this file exists to prevent: filtering out the credited ORIGINAL while leaving
// the creditnota row itself in the same receivable list. That turns a total which was correct by
// accident (+X and −X cancelling) into a negative one — a worse number than before the fix.
import {
  isCreditnota,
  isOpenReceivable,
  filterOpenReceivables,
  creditedTotalsFrom,
  fullyCreditedIdsFrom,
  openAfterCredit,
} from "./credited-invoices";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// The pair a credited invoice always produces: the original stays 'sent' and positive,
// the creditnota is ALSO outgoing + 'sent' but negative.
const ORIGINAL = { id: "inv-1", invoice_type: "factuur", status: "sent", total_inc_btw: 1000 };
const CREDIT = { id: "cr-1", invoice_type: "creditnota", status: "sent", total_inc_btw: -1000 };
const OPEN_OTHER = { id: "inv-2", invoice_type: "factuur", status: "sent", total_inc_btw: 250 };

console.log("\n— isCreditnota —");
check("creditnota row detected", isCreditnota(CREDIT) === true);
check("normal invoice is not a creditnota", isCreditnota(ORIGINAL) === false);
check("missing type is not a creditnota", isCreditnota({ id: "x" }) === false);

console.log("\n— isOpenReceivable —");
{
  const credited = new Set(["inv-1"]);
  check("a withdrawn original is not a receivable", isOpenReceivable(ORIGINAL, credited) === false);
  check("the creditnota itself is never a receivable", isOpenReceivable(CREDIT, credited) === false);
  check("an unrelated open invoice still is", isOpenReceivable(OPEN_OTHER, credited) === true);
  check("no creditnotas at all → everything stays", isOpenReceivable(ORIGINAL, new Set()) === true);
}

console.log("\n— the regression: both sides go, or neither —");
{
  const credited = new Set(["inv-1"]);
  const rows = filterOpenReceivables([ORIGINAL, CREDIT], credited);
  check("both rows of a credited pair are dropped", rows.length === 0);
  const total = rows.reduce((s, r) => s + (r.total_inc_btw ?? 0), 0);
  check("receivable total is 0, not -1000", total === 0);
  check("receivable COUNT is 0, not 2", rows.length === 0);
}
{
  // The exact bug: dropping only the original leaves the -1000 alone.
  const credited = new Set(["inv-1"]);
  const naive = [ORIGINAL, CREDIT].filter((r) => !credited.has(r.id));
  const naiveTotal = naive.reduce((s, r) => s + (r.total_inc_btw ?? 0), 0);
  check("(guard) the naive filter really does go negative", naiveTotal === -1000);
  check("the shared rule does not", filterOpenReceivables([ORIGINAL, CREDIT], credited)
    .reduce((s, r) => s + (r.total_inc_btw ?? 0), 0) === 0);
}
{
  const credited = new Set(["inv-1"]);
  const rows = filterOpenReceivables([ORIGINAL, CREDIT, OPEN_OTHER], credited);
  check("an unrelated invoice survives alongside", rows.length === 1 && rows[0].id === "inv-2");
  check("its amount is untouched", rows[0].total_inc_btw === 250);
}
{
  // A standalone creditnota whose original is not in this list (paid, archived, older page)
  // must STILL never count as money owed to the owner.
  const rows = filterOpenReceivables([CREDIT, OPEN_OTHER], new Set<string>());
  check("a lone creditnota is dropped even with an empty credited set", rows.length === 1 && rows[0].id === "inv-2");
}

console.log("\n— creditedTotalsFrom —");
check("adds several credits against one invoice",
  creditedTotalsFrom([{ original_invoice_id: "a", total_inc_btw: -50 }, { original_invoice_id: "a", total_inc_btw: -30 }]).get("a") === 80);
check("takes magnitudes — a creditnota is stored negative",
  creditedTotalsFrom([{ original_invoice_id: "a", total_inc_btw: -121 }]).get("a") === 121);
check("skips nulls", creditedTotalsFrom([{ original_invoice_id: null, total_inc_btw: -5 }]).size === 0);
check("tolerates null input", creditedTotalsFrom(null).size === 0);
check("tolerates undefined input", creditedTotalsFrom(undefined).size === 0);

console.log("\n— fullyCreditedIdsFrom [DEEL-CREDIT] —");
{
  // The case the whole feature turns on: credit EUR 50 of a EUR 1.000 invoice. The invoice is not
  // withdrawn — EUR 950 is still owed — so it must stay on every chase list.
  const partial = fullyCreditedIdsFrom([{ original_invoice_id: "inv-1", total_inc_btw: -50 }], [ORIGINAL]);
  check("a PARTIAL credit does not withdraw the invoice", partial.has("inv-1") === false);
  check("…so it is still an open receivable", isOpenReceivable(ORIGINAL, partial) === true);

  const full = fullyCreditedIdsFrom([{ original_invoice_id: "inv-1", total_inc_btw: -1000 }], [ORIGINAL]);
  check("a credit that covers the invoice DOES withdraw it", full.has("inv-1") === true);
  check("…and it leaves the receivable list", isOpenReceivable(ORIGINAL, full) === false);

  // Several partial credits that together cover it.
  const both = fullyCreditedIdsFrom(
    [{ original_invoice_id: "inv-1", total_inc_btw: -400 }, { original_invoice_id: "inv-1", total_inc_btw: -600 }],
    [ORIGINAL],
  );
  check("two credits that add up to the whole withdraw it together", both.has("inv-1") === true);

  // Rounding noise must not keep an invoice alive for a cent.
  const almost = fullyCreditedIdsFrom([{ original_invoice_id: "inv-1", total_inc_btw: -999.996 }], [ORIGINAL]);
  check("half a cent short still counts as covered", almost.has("inv-1") === true);

  check("an invoice with no credit at all is untouched",
    fullyCreditedIdsFrom([], [ORIGINAL]).size === 0);
  check("a credit against an unknown invoice is ignored",
    fullyCreditedIdsFrom([{ original_invoice_id: "ghost", total_inc_btw: -10 }], [ORIGINAL]).size === 0);
}

console.log("\n— openAfterCredit —");
check("total minus paid minus credited", openAfterCredit(1000, 200, 50) === 750);
check("never negative", openAfterCredit(100, 80, 80) === 0);
check("no credit behaves exactly like before", openAfterCredit(1000, 200, 0) === 800);
check("magnitudes — a negative total is read as its size", openAfterCredit(-1000, 0, 100) === 900);
check("rounds to cents", openAfterCredit(100, 0, 33.333) === 66.67);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
