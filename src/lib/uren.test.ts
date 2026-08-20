// [UREN] Pure node test — run: npx tsx --test src/lib/uren.test.ts
//
// The rules that decide which hour goes on which invoice, and for how much. The one thing these
// tests exist to protect: an hour is billed EXACTLY once. Billing it twice is a customer dispute;
// billing it zero times is the leak this whole feature was built to close.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  entryValue,
  isBillable,
  groupBillable,
  linesFromEntries,
  lineDescription,
  parseTimeEntryIds,
  verifyStamped,
  DEFAULT_HOUR_BTW_RATE,
  HOUR_UNIT,
  MAX_ENTRIES_PER_INVOICE,
  normalizeTimeEntryInput,
  MAX_HOURS_PER_ENTRY,
  type TimeEntry,
} from "./uren";
import { validateDraftLines, ALLOWED_BTW_RATES } from "./draft-totals";
import { computeInvoiceTotals } from "./invoice-totals";
// The route's own line_total, so this test measures what gets STORED and not what a test author
// thought would be stored.
import { lineNetEx } from "./invoice-discount";
import { isKnownUnit } from "./units";

/** A recorded hour, with only the fields a test cares about spelled out. */
function entry(over: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: over.id ?? "e1",
    client_id: over.client_id !== undefined ? over.client_id : "c1",
    worked_on: over.worked_on ?? "2026-08-03",
    description: over.description ?? "Werk",
    hours: over.hours ?? 1,
    hourly_rate: over.hourly_rate !== undefined ? over.hourly_rate : 100,
    invoice_id: over.invoice_id !== undefined ? over.invoice_id : null,
  };
}

test("[CENT] one rounding, and it is the app's", () => {
  // THE MEASURED CASE, and the reason this module imports round2 instead of writing its own.
  // 1,5 x EUR 33,33 is 49,995. The draft route's own comment describes what happens when the two
  // ends of that sum round differently: "de PDF drukt dan twee regels van EUR 50,00 met een
  // subtotaal van EUR 99,99" — and in the UBL it is worse, because Peppol BR-CO-10 rejects an
  // invoice whose lines do not add up to its total, so the e-factuur never arrives.
  assert.equal(entryValue({ hours: 1.5, hourly_rate: 33.33 }), 50);

  // The same half cent, twice on one invoice. Two lines of 50,00 must total 100,00 — not 99,99.
  const lines = linesFromEntries([
    entry({ id: "a", worked_on: "2026-08-03", hours: 1.5, hourly_rate: 33.33 }),
    entry({ id: "b", worked_on: "2026-08-04", hours: 1.5, hourly_rate: 33.33 }),
  ]).lines;
  // Through the route's OWN line_total computation, not a hand-rolled multiplication: lineNetEx is
  // what /api/invoice/draft stores in the column, so this is the number that reaches the PDF and
  // the UBL. Multiplying by hand here gives 99,99 — which is precisely the bug, and precisely why
  // this module never computes line_total itself.
  const totals = computeInvoiceTotals(lines.map((l) => ({ ...l, line_total: lineNetEx(l) })));
  assert.equal(totals.total_ex_btw, 100, "two half cents do not become a missing cent");
  assert.equal(lineNetEx(lines[0]), 50, "and each stored line is the 50,00 the customer reads");

  // A quarter of an hour is the smallest unit the column can hold (numeric(6,2)), and it has to
  // survive the multiplication: 0,25 x 85 = 21,25 exactly.
  assert.equal(entryValue({ hours: 0.25, hourly_rate: 85 }), 21.25);
});

test("[UREN] a rate of zero is a rate; a missing rate is not", () => {
  // Zero is a real decision — goodwill, an hour redone at our own cost — and the owner may make
  // it. It produces a line of EUR 0,00 that they meant to send.
  assert.equal(entryValue({ hours: 2, hourly_rate: 0 }), 0);
  // Missing is the OTHER thing, and the difference is the whole point: Number(null) is 0, so a
  // naive read would bill two hours of real work at nothing and the owner would find out from
  // the invoice their customer already has.
  assert.equal(entryValue({ hours: 2, hourly_rate: null }), null);
  // Nonsense out of a bad row never becomes an amount.
  assert.equal(entryValue({ hours: 2, hourly_rate: Number.NaN }), null);
  assert.equal(entryValue({ hours: Number.POSITIVE_INFINITY, hourly_rate: 10 }), null);
  assert.equal(entryValue({ hours: 0, hourly_rate: 10 }), null, "zero hours is not work");
  assert.equal(entryValue({ hours: -1, hourly_rate: 10 }), null, "negative hours is a correction, not a line");
});

test("[UREN-EENMALIG] billable is the column, never a guess", () => {
  assert.equal(isBillable(entry({ invoice_id: null })), true);
  assert.equal(isBillable(entry({ invoice_id: "inv-1" })), false);

  // The rule that carries the feature: an hour already on an invoice cannot be put back in the
  // pool by anything else about it. Old, recent, expensive, cheap — the foreign key decides.
  const billed = entry({ id: "old", worked_on: "2020-01-01", hours: 8, hourly_rate: 200, invoice_id: "inv-1" });
  assert.equal(groupBillable([billed]).length, 0, "a billed hour is not a candidate");
  assert.deepEqual(linesFromEntries([billed]).lines, [], "…and never becomes a line");
  assert.deepEqual(linesFromEntries([billed]).billedIds, [], "…so nothing gets stamped a second time");
});

test("[UREN] a group's amount never silently swallows an unpriced hour", () => {
  const groups = groupBillable([
    entry({ id: "a", client_id: "c1", worked_on: "2026-08-01", hours: 2, hourly_rate: 90 }),
    entry({ id: "b", client_id: "c1", worked_on: "2026-08-05", hours: 3, hourly_rate: null }),
  ]);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.hours, 5, "all five hours are counted — they were worked");
  assert.equal(g.amountExBtw, 180, "but only the two that carry a rate are priced");
  assert.equal(g.withoutRate, 1, "and the screen is TOLD that one is missing");
  assert.equal(g.entries.length, 2, "the unpriced hour is still in the list beside the amount");
  // Newest first inside the group: the hour the owner just logged is the one they are looking at.
  assert.equal(g.entries[0].id, "b");
  assert.equal(g.entries[1].id, "a");
});

test("[UREN] hours without a customer card are still hours", () => {
  // Refusing them would force the owner to do administration before they may write down their
  // work, which is exactly the friction that sends people back to Excel.
  const groups = groupBillable([
    entry({ id: "a", client_id: null, hours: 4, hourly_rate: 50 }),
    entry({ id: "b", client_id: "c1", hours: 1, hourly_rate: 50 }),
  ]);
  assert.equal(groups.length, 2, "they group on their own, not into someone else's total");
  const loose = groups.find((g) => g.clientId === null);
  assert.ok(loose, "the group with no customer exists");
  assert.equal(loose.amountExBtw, 200);
  // Biggest amount first — that is the invoice worth sending today.
  assert.equal(groups[0].clientId, null);
  assert.equal(groups[1].clientId, "c1");
});

test("[UREN] the biggest INVOICE sorts first, not the longest week", () => {
  // The two orders have to disagree here or the assertion cannot tell them apart: one hour of
  // specialist work at EUR 500 outranks ten hours at EUR 10, and money is what the owner is
  // deciding about when they look at this list.
  const groups = groupBillable([
    entry({ id: "a", client_id: "duur", hours: 1, hourly_rate: 500 }),
    entry({ id: "b", client_id: "lang", hours: 10, hourly_rate: 10 }),
  ]);
  assert.equal(groups[0].clientId, "duur", "EUR 500 before EUR 100, even though it is one hour");
  assert.equal(groups[0].amountExBtw, 500);
  assert.equal(groups[1].hours, 10);

  // A tie on money falls back to hours, so a set of unpriced groups does not sort at random —
  // an owner who reloads the screen must see the same list in the same order.
  const unpriced = groupBillable([
    entry({ id: "c", client_id: "kort", hours: 2, hourly_rate: null }),
    entry({ id: "d", client_id: "veel", hours: 9, hourly_rate: null }),
  ]);
  assert.equal(unpriced[0].clientId, "veel");
  assert.equal(unpriced[0].amountExBtw, 0);
  assert.equal(unpriced[0].withoutRate, 1, "…and each of them says its amount is incomplete");
});

test("[UREN] one line per day, oldest first, and the customer can check it", () => {
  const { lines, billedIds } = linesFromEntries([
    entry({ id: "b", worked_on: "2026-08-05", description: "Ontwerp", hours: 3, hourly_rate: 80 }),
    entry({ id: "a", worked_on: "2026-08-03", description: "Analyse", hours: 2, hourly_rate: 80 }),
  ]);
  assert.equal(lines.length, 2, "two days is two lines — not one lump of 5 uur");
  assert.equal(lines[0].description, "03-08 · Analyse", "oldest first, the way a statement reads");
  assert.equal(lines[1].description, "05-08 · Ontwerp");
  assert.deepEqual(billedIds, ["a", "b"], "the ids to stamp come back in the same order");
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].unit_price, 80);
});

test("[UREN] an hour with no rate is refused, not billed at zero", () => {
  const { lines, skippedWithoutRate, billedIds } = linesFromEntries([
    entry({ id: "a", worked_on: "2026-08-03", hours: 2, hourly_rate: 95 }),
    entry({ id: "b", worked_on: "2026-08-04", hours: 4, hourly_rate: null }),
  ]);
  assert.equal(lines.length, 1, "only the priced hour becomes a line");
  assert.equal(skippedWithoutRate.length, 1, "and the other one is NAMED");
  assert.equal(skippedWithoutRate[0].id, "b");
  // The stamp follows the lines, not the selection. An hour left off the invoice must stay
  // billable, or four hours of real work disappear the moment the invoice is created.
  assert.deepEqual(billedIds, ["a"], "only what is actually on the invoice gets marked billed");
  assert.equal(billedIds.includes("b"), false, "the refused hour is still there to bill later");
});

test("[UREN] the lines are the shape /api/invoice/draft actually accepts", () => {
  // Not "a plausible line" — the real validator, the one standing between these hours and an
  // invoice. A line this route refuses does not produce a cheaper invoice; it produces none, and
  // the owner is told their hours "kloppen niet".
  const { lines } = linesFromEntries([
    entry({ id: "a", worked_on: "2026-08-03", description: "Analyse", hours: 2, hourly_rate: 95 }),
  ]);
  const checked = validateDraftLines(lines, "factuur");
  assert.equal(checked.ok, true, "the invoice route accepts what this module builds");

  const line = lines[0];
  assert.ok(ALLOWED_BTW_RATES.includes(line.btw_rate), "a rate that exists in the Netherlands");
  assert.equal(line.btw_rate, DEFAULT_HOUR_BTW_RATE, "21 by default — the same rate the editor seeds");
  assert.notEqual(line.btw_rate, 0, "never 0: that reads as vrijgesteld and takes turnover out of the aangifte");
  // [UNIT] The route drops any unit it does not know, and an unknown unit lands on the e-factuur
  // as C62 ("piece") — an invoice that bills 2 PIECES of consultancy.
  assert.equal(line.unit, HOUR_UNIT);
  assert.equal(isKnownUnit(line.unit), true, "'uur' survives to the UBL as HUR");
});

test("[UREN] the owner may bill hours at 9%, but not at a rate that does not exist", () => {
  assert.equal(linesFromEntries([entry()], 9).lines[0].btw_rate, 9);
  assert.equal(linesFromEntries([entry()], 0).lines[0].btw_rate, 0, "0% is a real rate the owner may choose");
  // A rate out of a broken request does not become an invoice line the route would refuse, and it
  // does not become a cheaper one either.
  assert.equal(linesFromEntries([entry()], 6).lines[0].btw_rate, DEFAULT_HOUR_BTW_RATE);
  assert.equal(linesFromEntries([entry()], Number.NaN).lines[0].btw_rate, DEFAULT_HOUR_BTW_RATE);
});

test("[UREN] the description on the line is what the customer reads", () => {
  // Dutch on purpose: the invoice is never translated (AGENTS.md), because it is read by a Dutch
  // customer and their accountant, not by whoever set the owner's language.
  assert.equal(lineDescription({ worked_on: "2026-08-03", description: "Analyse" }), "03-08 · Analyse");
  // A row whose date cannot be read still produces the work, never an empty line: art. 35a Wet OB
  // wants the nature of the service on the invoice, and "" would be refused by the route anyway.
  assert.equal(lineDescription({ worked_on: "", description: "Analyse" }), "Analyse");
  assert.equal(lineDescription({ worked_on: "2026-08-03", description: "  Analyse  " }), "03-08 · Analyse");
});

test("[UREN] nothing to bill is an empty answer, never a crash", () => {
  assert.deepEqual(groupBillable([]), []);
  assert.deepEqual(linesFromEntries([]).lines, []);
  assert.deepEqual(linesFromEntries([]).billedIds, []);
  // A row the database should not have held: no hours. It stays visible on the screen (it is a
  // real row) but it cannot become a quantity.
  assert.deepEqual(groupBillable([entry({ hours: 0 })]), []);
});

test("[UREN-EENMALIG] a request that cannot say which hours it means is refused", () => {
  const ok = parseTimeEntryIds([
    "AAAAAAAA-0000-0000-0000-000000000001",
    "aaaaaaaa-0000-0000-0000-000000000001", // the same hour, said twice
    "bbbbbbbb-0000-0000-0000-000000000002",
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.ids.length, 2, "the same hour twice is one hour, not an error the owner can act on");

  assert.equal(parseTimeEntryIds("aaaaaaaa-0000-0000-0000-000000000001").ok, false, "a string is not a list");
  assert.equal(parseTimeEntryIds(null).ok, false);
  assert.equal(parseTimeEntryIds([]).ok, false, "billing nothing is not billing");
  // The dangerous one: anything that is not an id would surface as a Postgres error INSIDE the
  // stamping step, at the one moment when an invoice already exists and the only way out is to
  // undo it. Caught here instead, while there is still nothing to roll back.
  assert.equal(parseTimeEntryIds(["not-a-uuid"]).ok, false);
  assert.equal(parseTimeEntryIds(["aaaaaaaa-0000-0000-0000-000000000001; DROP TABLE"]).ok, false);
  assert.equal(parseTimeEntryIds([123]).ok, false);
  assert.equal(parseTimeEntryIds([null]).ok, false);

  const many = Array.from({ length: MAX_ENTRIES_PER_INVOICE + 1 }, (_, i) =>
    `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`);
  const tooMany = parseTimeEntryIds(many);
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.ok === false && tooMany.code, "too_many");
  // …and the ceiling is the invoice route's own, so the refusal never arrives as a message about
  // "regels" on a screen that is talking about uren.
  assert.equal(MAX_ENTRIES_PER_INVOICE, 200);
});

test("[UREN-EENMALIG] an hour that was not stamped undoes the invoice", () => {
  assert.deepEqual(verifyStamped(["a", "b"], ["a", "b"]), { ok: true });
  assert.deepEqual(verifyStamped([], []), { ok: true }, "nothing billed, nothing to stamp");
  // Case matters not at all — Postgres hands uuids back lower-case whatever was sent in.
  assert.deepEqual(verifyStamped(["AAAA-b"], ["aaaa-B"]), { ok: true });

  // THE failure this exists for. The invoice has two lines; only one hour was marked billed. The
  // other is back in the billable pool with an invoice already carrying it — so it gets billed a
  // second time, and the customer is the one who notices.
  const bad = verifyStamped(["a", "b"], ["a"]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.ok === false && bad.missing, ["b"], "the hour that got away is NAMED");

  // A stamp that hit MORE rows than we billed is not silently fine either way round: the check is
  // about every billed hour being covered, and extra ids never make a missing one acceptable.
  assert.equal(verifyStamped(["a", "b"], ["a", "c"]).ok, false);
});

test("[UREN] a refusal names one field, and an empty rate is not a refusal", () => {
  const good = normalizeTimeEntryInput({
    worked_on: "2026-08-03", description: "  Analyse  ", hours: "2,0".replace(",", "."), hourly_rate: "85",
  });
  assert.equal(good.ok, true);
  assert.equal(good.ok === true && good.entry.description, "Analyse");
  assert.equal(good.ok === true && good.entry.hours, 2);
  assert.equal(good.ok === true && good.entry.hourly_rate, 85);
  assert.equal(good.ok === true && good.entry.client_id, null, "no customer is a real answer");

  // Writing down work before the price is agreed is normal, and refusing it would force the owner
  // to invent a rate — a number that then ends up on an invoice.
  const noRate = normalizeTimeEntryInput({ worked_on: "2026-08-03", description: "Werk", hours: 2 });
  assert.equal(noRate.ok, true);
  assert.equal(noRate.ok === true && noRate.entry.hourly_rate, null, "unknown stays unknown, never 0");
  assert.equal(
    normalizeTimeEntryInput({ worked_on: "2026-08-03", description: "Werk", hours: 2, hourly_rate: "" }).ok,
    true, "an empty field is not a typo");
  // …but a FILLED field that cannot be a price is a question, not a silent null. A null would park
  // the hour as "no rate yet" and the owner would never learn their 85 did not arrive.
  assert.equal(normalizeTimeEntryInput({ worked_on: "2026-08-03", description: "Werk", hours: 2, hourly_rate: "tachtig" }).ok, false);
  assert.equal(normalizeTimeEntryInput({ worked_on: "2026-08-03", description: "Werk", hours: 2, hourly_rate: -5 }).ok, false);
  // Zero survives: goodwill is a decision the owner may record.
  const free = normalizeTimeEntryInput({ worked_on: "2026-08-03", description: "Werk", hours: 2, hourly_rate: 0 });
  assert.equal(free.ok === true && free.entry.hourly_rate, 0);

  const codes: Array<[Record<string, unknown>, string]> = [
    [{ description: "W", hours: 1 }, "no_date"],
    [{ worked_on: "03-08-2026", description: "W", hours: 1 }, "bad_date"],
    // A shape the calendar does not have. numeric checks would never see this one.
    [{ worked_on: "2026-02-30", description: "W", hours: 1 }, "bad_date"],
    [{ worked_on: "2026-08-03", description: "   ", hours: 1 }, "no_description"],
    [{ worked_on: "2026-08-03", description: "x".repeat(501), hours: 1 }, "description_too_long"],
    [{ worked_on: "2026-08-03", description: "W" }, "no_hours"],
    [{ worked_on: "2026-08-03", description: "W", hours: 0 }, "no_hours"],
    [{ worked_on: "2026-08-03", description: "W", hours: -2 }, "no_hours"],
    [{ worked_on: "2026-08-03", description: "W", hours: "acht" }, "no_hours"],
    [{ worked_on: "2026-08-03", description: "W", hours: 25 }, "hours_too_many"],
  ];
  for (const [input, code] of codes) {
    const r = normalizeTimeEntryInput(input);
    assert.equal(r.ok, false, `${code} should have been refused: ${JSON.stringify(input).slice(0, 60)}`);
    assert.equal(r.ok === false && r.code, code);
  }
});

test("[UREN] the validator refuses exactly what the database refuses", () => {
  // The two are a pair: this one gives the owner a sentence, the CHECK gives the app a guarantee.
  // If they disagree, one of them is decoration — and it is always the one nobody tested.
  // tests/sql/time_entries.test.sql asserts the same five boundaries against a real PostgreSQL.
  assert.equal(MAX_HOURS_PER_ENTRY, 24, "the same ceiling the migration writes");
  assert.equal(normalizeTimeEntryInput({ worked_on: "2026-08-03", description: "W", hours: 24 }).ok, true,
    "24 is allowed on both sides — a full day is a day someone worked");
  assert.equal(normalizeTimeEntryInput({ worked_on: "2026-08-03", description: "W", hours: 24.01 }).ok, false);

  // [CENT] Rounded HERE, not by numeric(6,2) on the way in: 1,005 stored silently as 1,01 is a
  // number the owner did not type, on the row an invoice line is built from.
  const r = normalizeTimeEntryInput({ worked_on: "2026-08-03", description: "W", hours: 1.005 });
  assert.equal(r.ok === true && r.entry.hours, 1.01);
});
