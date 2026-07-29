// [LATE-ONE-RULE] Pure node test — run: npx tsx src/lib/quarterly.test.ts
import { buildQuarterlySummary, type InvoiceForQuarterly } from "./quarterly";
import { amsterdamTodayDayNumber, reminderTierDue } from "./invoice-reminders";
import { amsterdamToday } from "./format-nl";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** ISO day, `delta` days from today in Amsterdam. */
function dayFromToday(delta: number): string {
  const [y, m, d] = amsterdamToday().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

const inv = (over: Partial<InvoiceForQuarterly> = {}): InvoiceForQuarterly => ({
  id: "i1", invoice_number: "2026-001", client_name: "Klant", status: "sent",
  direction: "outgoing", total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
  amount_paid: 0, btw_rate: 21, invoice_date: dayFromToday(-30), ...over,
});

console.log("\n— [LATE-ONE-RULE] 'te laat' means the same thing on both screens —");
{
  const today = buildQuarterlySummary([inv({ due_date: dayFromToday(0) })], 2026, 3);
  check("an invoice due TODAY is outstanding, not overdue", near(today.overdue, 0) && near(today.outstanding, 121));

  const yesterday = buildQuarterlySummary([inv({ due_date: dayFromToday(-1) })], 2026, 3);
  check("one day past due IS overdue", near(yesterday.overdue, 121) && near(yesterday.outstanding, 0));

  const tomorrow = buildQuarterlySummary([inv({ due_date: dayFromToday(1) })], 2026, 3);
  check("due tomorrow is outstanding", near(tomorrow.outstanding, 121) && near(tomorrow.overdue, 0));

  // The whole point: the dunning engine and this overview must not disagree about one invoice.
  const todayDay = amsterdamTodayDayNumber();
  const chased = (due: string) => reminderTierDue({
    status: "sent", direction: "outgoing", totalIncBtw: 121, amountPaid: 0,
    clientEmail: "k@x.nl", remindersPaused: false, hasCreditnota: false,
    dueDate: due, offsets: [1, 14, 30], sentOffsets: [], todayDayNumber: todayDay,
  });
  check("due today: the dunning engine does not chase it either", chased(dayFromToday(0)) === null);
  check("…and one day later it does", chased(dayFromToday(-1)) !== null);
  check("BOTH SURFACES AGREE on the day the invoice turns late",
    (chased(dayFromToday(0)) === null) === near(buildQuarterlySummary([inv({ due_date: dayFromToday(0) })], 2026, 3).overdue, 0));
}

console.log("\n— an invoice with no due date is never guessed to be late —");
{
  const none = buildQuarterlySummary([inv({ due_date: undefined })], 2026, 3);
  check("no due date → outstanding, never overdue", near(none.overdue, 0) && near(none.outstanding, 121));
}

console.log("\n— a partly paid invoice splits, and only the REST can be late —");
{
  const part = buildQuarterlySummary([inv({ due_date: dayFromToday(-5), amount_paid: 21 })], 2026, 3);
  check("the settled part counts as paid", near(part.paid, 21));
  check("…and only the remainder is overdue", near(part.overdue, 100));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
