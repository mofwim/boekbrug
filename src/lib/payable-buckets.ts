// src/lib/payable-buckets.ts
// [BESTE] What you must pay, by when.
//
// Moneybird's "Te betalen" and every bank app's bill view answer one question above the list:
// how much is overdue, how much falls this week, how much later. Crediteuren showed the total and
// left the owner to read the due dates row by row. Pure; the screen hands it the open amount per
// row (openAmountSigned — the app's one definition) and today from the owner's clock.
//
// Only DEBTS are bucketed: a creditnota's negative open amount is netted in the total above the
// list, and "a creditnota that is overdue" is not a sentence. Rows with nothing open are skipped.
//
// Run: npx tsx --test src/lib/payable-buckets.test.ts

import { round2 } from "./invoice-totals";
import { dayNumberFromIso } from "./invoice-reminders";

export interface PayableRow {
  dueDate: string | null;
  /** The open amount, signed; only a positive one is a debt. */
  open: number;
}

export interface Bucket {
  count: number;
  sum: number;
}

export interface PayableBuckets {
  verlopen: Bucket;
  dezeWeek: Bucket;
  later: Bucket;
  zonderDatum: Bucket;
  /** Debts in any bucket — zero means the strip has nothing to say. */
  total: number;
}

/** "This week" is today and the six days after it — a rolling week, not the calendar one. */
const WEEK_DAYS = 7;

export function payableBuckets(rows: readonly PayableRow[], today: string): PayableBuckets {
  const empty = (): Bucket => ({ count: 0, sum: 0 });
  const out: PayableBuckets = { verlopen: empty(), dezeWeek: empty(), later: empty(), zonderDatum: empty(), total: 0 };
  const todayNum = dayNumberFromIso(today);
  for (const r of rows) {
    if (!(r.open > 0)) continue;
    const due = r.dueDate ? dayNumberFromIso(r.dueDate) : null;
    const bucket =
      due === null || todayNum === null ? out.zonderDatum
      : due < todayNum ? out.verlopen
      : due < todayNum + WEEK_DAYS ? out.dezeWeek
      : out.later;
    bucket.count += 1;
    bucket.sum += r.open;
    out.total += 1;
  }
  for (const b of [out.verlopen, out.dezeWeek, out.later, out.zonderDatum]) b.sum = round2(b.sum);
  return out;
}
