// [TRUST-CONFIDENT-FALSE] Pure node test — run: npx tsx src/lib/ai-rescue.test.ts
// Locks the rule that a confident "not an invoice" verdict carrying a strong invoice signal
// (vendor + amount) and a non-statement filename is RESCUED to the verify queue, never
// silently discarded — while a genuine statement or a signal-less document is not rescued.
import { shouldRescueNonInvoice, isReminderFilename } from "./ai";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— rescue: strong signal + non-statement filename → keep (the HVO verzamelfactuur case) —");
check("vendor + total_inc_btw, numeric filename → rescue",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_inc_btw: 3186.42 }, "2216671.pdf") === true);
check("vendor + total_ex_btw only → rescue",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_ex_btw: 2632.0 }, "factuur.pdf") === true);
check("vendor + legacy amount field → rescue",
  shouldRescueNonInvoice({ vendor: "Sligro", amount: 812.5 }, "bon.pdf") === true);

console.log("\n— NOT rescued: an unmistakable statement filename stays rejected (no double-count) —");
check("rekeningoverzicht filename → not rescued even with signal",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_inc_btw: 3186.42 }, "rekeningoverzicht-mei.pdf") === false);
check("openstaande posten filename → not rescued",
  shouldRescueNonInvoice({ vendor: "HVO meat bv", total_inc_btw: 3186.42 }, "openstaande posten.pdf") === false);

console.log("\n— NOT rescued: weak signal (a newsletter/ad is genuinely not an invoice) —");
check("vendor but NO amount → not rescued",
  shouldRescueNonInvoice({ vendor: "Nieuwsbrief BV", total_inc_btw: null, amount: null }, "nieuwsbrief.pdf") === false);
check("amount but NO vendor → not rescued",
  shouldRescueNonInvoice({ vendor: null, total_inc_btw: 50 }, "flyer.pdf") === false);
check("no vendor, no amount → not rescued",
  shouldRescueNonInvoice({}, "banner.pdf") === false);
check("empty vendor string counts as no vendor",
  shouldRescueNonInvoice({ vendor: "   ", total_inc_btw: 100 }, "x.pdf") === false);

console.log("\n— [REMINDER] filename backstop flags a payment reminder (a real invoice, but check for a duplicate) —");
check("betalingsherinnering → reminder", isReminderFilename("betalingsherinnering-2216671.pdf") === true);
check("herinnering → reminder", isReminderFilename("Herinnering factuur 2216671.pdf") === true);
check("aanmaning → reminder", isReminderFilename("2e aanmaning.pdf") === true);
check("reminder (EN) → reminder", isReminderFilename("payment reminder.pdf") === true);
check("plain factuur is NOT a reminder", isReminderFilename("factuur-2216671.pdf") === false);
check("a vendor named 'Herinneringen BV' invoice is still caught (acceptable — flagged, not dropped)",
  isReminderFilename("herinnering.pdf") === true);
check("empty filename → not a reminder", isReminderFilename("") === false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
