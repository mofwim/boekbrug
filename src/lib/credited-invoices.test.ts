// [CREDITNOTA-NO-CHASE] Pure node test — run: npx tsx src/lib/credited-invoices.test.ts
//
// The regression this file exists to prevent: filtering out the credited ORIGINAL while leaving
// the creditnota row itself in the same receivable list. That turns a total which was correct by
// accident (+X and −X cancelling) into a negative one — a worse number than before the fix.
import {
  isCreditnota,
  isOpenReceivable,
  filterOpenReceivables,
  creditedIdsFrom,
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

console.log("\n— creditedIdsFrom —");
check("collects original ids", creditedIdsFrom([{ original_invoice_id: "a" }, { original_invoice_id: "b" }]).size === 2);
check("skips nulls", creditedIdsFrom([{ original_invoice_id: null }, { original_invoice_id: "a" }]).size === 1);
check("tolerates null input", creditedIdsFrom(null).size === 0);
check("tolerates undefined input", creditedIdsFrom(undefined).size === 0);
check("dedupes", creditedIdsFrom([{ original_invoice_id: "a" }, { original_invoice_id: "a" }]).size === 1);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
