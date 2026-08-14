// [OFFERTE-OPVOLGING] Run: npx tsx --test src/lib/offerte-followup.test.ts
//
// The property that matters most here is the QUIET one: this rule must say nothing about almost
// every quote. A list that names them all is a list nobody reads twice, and then the one quote
// that was about to lapse is buried under twenty that were fine.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  quoteFollowupState,
  quotesNeedingFollowup,
  isOpenQuote,
  daysUntilExpiry,
  daysBetweenIso,
  DEFAULT_SOON_DAYS,
} from "./offerte-followup";

const TODAY = "2026-08-14";
const quote = (over: Record<string, unknown> = {}) =>
  ({ invoice_type: "pro_forma", status: "sent", due_date: "2026-09-01", ...over });

test("[OFFERTE-OPVOLGING] a quote with time left is not mentioned", () => {
  assert.equal(quoteFollowupState(quote(), TODAY), null, "18 days out — nothing to say");
  assert.equal(quoteFollowupState(quote({ due_date: "2026-08-18" }), TODAY), null, "4 days is not yet soon");
});

test("[OFFERTE-OPVOLGING] a quote about to lapse, and one that already has", () => {
  assert.equal(quoteFollowupState(quote({ due_date: "2026-08-17" }), TODAY), "verloopt-binnenkort", "3 days");
  assert.equal(quoteFollowupState(quote({ due_date: "2026-08-14" }), TODAY), "verloopt-binnenkort", "today");
  assert.equal(quoteFollowupState(quote({ due_date: "2026-08-13" }), TODAY), "verlopen", "yesterday");
  assert.equal(quoteFollowupState(quote({ due_date: "2026-01-01" }), TODAY), "verlopen", "long gone");
});

test("[OFFERTE-OPVOLGING] only a SENT quote can lapse", () => {
  // A concept was never out the door: there is no "Geldig tot" on a customer's desk, so nothing
  // has run out and there is nobody to follow up with.
  assert.equal(quoteFollowupState(quote({ status: "draft", due_date: "2026-01-01" }), TODAY), null);
  assert.equal(isOpenQuote(quote({ status: "draft" })), false);
  assert.equal(isOpenQuote(quote()), true);
});

test("[OFFERTE-OPVOLGING] a quote that became an invoice is finished, in both ways it can be", () => {
  // Converted via the create screen: the quote row is set to 'archived'.
  assert.equal(quoteFollowupState(quote({ status: "archived", due_date: "2026-01-01" }), TODAY), null);
  // Converted on sending: the SAME row becomes a factuur, so it is not a quote any more.
  assert.equal(quoteFollowupState(quote({ invoice_type: "factuur", due_date: "2026-01-01" }), TODAY), null);
});

test("[OFFERTE-OPVOLGING] an invoice is never a quote, whatever its dates say", () => {
  for (const type of ["factuur", "creditnota", null, undefined, ""]) {
    assert.equal(quoteFollowupState(quote({ invoice_type: type, due_date: "2026-01-01" }), TODAY), null,
      `${String(type)} must not be followed up as a quote`);
  }
});

test("[OFFERTE-OPVOLGING] no validity date means no deadline was ever agreed", () => {
  // Inventing one would put a term on a document the customer never saw one on.
  assert.equal(quoteFollowupState(quote({ due_date: null }), TODAY), null);
  assert.equal(quoteFollowupState(quote({ due_date: "" }), TODAY), null);
  assert.equal(quoteFollowupState(quote({ due_date: "geen datum" }), TODAY), null, "unparseable is not expired");
  assert.equal(daysUntilExpiry(quote({ due_date: null }), TODAY), null);
});

test("[OFFERTE-OPVOLGING] a timestamp is read as the day it falls on", () => {
  assert.equal(daysUntilExpiry(quote({ due_date: "2026-08-13T23:00:00Z" }), TODAY), -1);
});

test("[OFFERTE-OPVOLGING] the window is adjustable and defaults to three days", () => {
  assert.equal(DEFAULT_SOON_DAYS, 3);
  assert.equal(quoteFollowupState(quote({ due_date: "2026-08-21" }), TODAY, 7), "verloopt-binnenkort");
  assert.equal(quoteFollowupState(quote({ due_date: "2026-08-21" }), TODAY), null, "outside the default window");
});

test("[OFFERTE-OPVOLGING] the list is the ones that need attention, coldest first", () => {
  const rows = [
    quote({ due_date: "2026-08-17" }),                        // 3 days out
    quote({ due_date: "2026-12-01" }),                        // fine — must not appear
    quote({ due_date: "2026-07-01" }),                        // long expired
    quote({ due_date: "2026-08-13" }),                        // expired yesterday
    quote({ status: "draft", due_date: "2026-01-01" }),       // never sent
    quote({ invoice_type: "factuur", due_date: "2026-01-01" }), // an invoice
  ];
  const out = quotesNeedingFollowup(rows, TODAY);
  assert.equal(out.length, 3, "only the three that are actually at risk");
  assert.deepEqual(out.map((r) => r.quote.due_date), ["2026-07-01", "2026-08-13", "2026-08-17"],
    "the ones left longest come first — they go cold fastest");
  assert.deepEqual(out.map((r) => r.state), ["verlopen", "verlopen", "verloopt-binnenkort"]);
});

test("[OFFERTE-OPVOLGING] an empty list, and a list with nothing at risk, both say nothing", () => {
  assert.deepEqual(quotesNeedingFollowup([], TODAY), []);
  assert.deepEqual(quotesNeedingFollowup([quote({ due_date: "2027-01-01" })], TODAY), []);
});

test("[OFFERTE-OPVOLGING] the day arithmetic survives a DST change", () => {
  // Amsterdam moves the clock on the last Sunday of October. Counted in local hours, the days
  // across it are 23 or 25 hours long, and a naive division drops or gains one.
  assert.equal(daysBetweenIso("2026-10-24", "2026-10-26"), 2);
  assert.equal(daysBetweenIso("2026-03-28", "2026-03-30"), 2);
  assert.equal(daysBetweenIso("nonsense", "2026-01-01"), null);
});

// ─── [OFFERTE-AKKOORD] Het antwoord van de klant gaat vóór elke datum ─────────

test("[OFFERTE-AKKOORD] an accepted quote is the most urgent thing on the list", () => {
  // Signed work that has not been invoiced, and the invoice only exists once the owner makes it.
  const ja = quote({ offerte_response: "accepted", due_date: "2026-12-01" });
  assert.equal(quoteFollowupState(ja, TODAY), "geaccepteerd", "even with months of validity left");
  const jaVerlopen = quote({ offerte_response: "accepted", due_date: "2026-01-01" });
  assert.equal(quoteFollowupState(jaVerlopen, TODAY), "geaccepteerd",
    "an accepted quote that also lapsed was not left lying around — it was WON");
});

test("[OFFERTE-AKKOORD] a declined quote stops being chased", () => {
  // Nagging about a quote the customer already said no to is giving the owner work that is not there.
  assert.equal(quoteFollowupState(quote({ offerte_response: "declined", due_date: "2026-01-01" }), TODAY), null);
  assert.equal(quoteFollowupState(quote({ offerte_response: "declined", due_date: "2026-08-15" }), TODAY), null);
});

test("[OFFERTE-AKKOORD] accepted quotes sort above the ones running out", () => {
  const rows = [
    quote({ due_date: "2026-07-01" }),                                  // long expired
    quote({ offerte_response: "accepted", due_date: "2026-11-01" }),    // won
    quote({ due_date: "2026-08-16" }),                                  // 2 days left
  ];
  const out = quotesNeedingFollowup(rows, TODAY);
  assert.deepEqual(out.map((r) => r.state), ["geaccepteerd", "verlopen", "verloopt-binnenkort"]);
});

test("[OFFERTE-AKKOORD] an accepted quote WITHOUT a validity date still shows up", () => {
  // No date means nothing lapses — but the acceptance is what puts it on the list, not the date.
  const out = quotesNeedingFollowup([quote({ offerte_response: "accepted", due_date: null })], TODAY);
  assert.equal(out.length, 1);
  assert.equal(out[0].state, "geaccepteerd");
});
