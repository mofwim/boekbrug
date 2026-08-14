// [OFFERTE-AKKOORD] Run: npx tsx --test src/lib/offerte-akkoord.test.ts
//
// Two properties carry this file:
//
//   1. THE FIRST ANSWER STANDS. The recorded moment is the evidence, and evidence the other party
//      can overwrite is not evidence.
//   2. THE PUBLIC VIEW IS AN ALLOWLIST. Anything not named here does not reach a stranger holding
//      a link that works forever.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  answerRefusal,
  canAnswer,
  answerOf,
  isQuoteAnswer,
  answeredAfterExpiry,
  cleanResponderName,
  toPublicQuoteView,
  MAX_NAME_LENGTH,
} from "./offerte-akkoord";

const quote = (over: Record<string, unknown> = {}) =>
  ({ invoice_type: "pro_forma", status: "sent", due_date: "2026-09-01", ...over });

test("[OFFERTE-AKKOORD] an unanswered, sent quote may be answered", () => {
  assert.equal(answerRefusal(quote()), null);
  assert.equal(canAnswer(quote()), true);
});

test("[OFFERTE-AKKOORD] the first answer stands — a second click changes nothing", () => {
  const beantwoord = quote({ offerte_response: "accepted", offerte_responded_at: "2026-08-14T10:00:00Z" });
  assert.equal(answerRefusal(beantwoord), "already_answered");
  assert.equal(canAnswer(beantwoord), false);
  // Also after a decline: someone who changes their mind calls, and then a human records it.
  assert.equal(answerRefusal(quote({ offerte_response: "declined", offerte_responded_at: "x" })), "already_answered");
});

test("[OFFERTE-AKKOORD] only a sent quote can be answered", () => {
  assert.equal(answerRefusal(quote({ status: "draft" })), "not_sent");
  assert.equal(answerRefusal(quote({ status: "archived" })), "not_sent", "already converted");
  assert.equal(answerRefusal(quote({ invoice_type: "factuur" })), "not_a_quote");
  assert.equal(answerRefusal(quote({ invoice_type: "creditnota" })), "not_a_quote");
});

test("[OFFERTE-AKKOORD] an EXPIRED quote may still be accepted", () => {
  // Refusing would throw away work over one day, and the owner is bound to nothing: they invoice
  // themselves. The lateness is recorded, not used as a reason to say no.
  const verlopen = quote({ due_date: "2026-01-01" });
  assert.equal(answerRefusal(verlopen), null);
  assert.equal(
    answeredAfterExpiry({ ...verlopen, offerte_response: "accepted", offerte_responded_at: "2026-08-14T09:00:00Z" }),
    true,
  );
  assert.equal(
    answeredAfterExpiry({ ...quote(), offerte_response: "accepted", offerte_responded_at: "2026-08-14T09:00:00Z" }),
    false,
    "answered well within the validity date",
  );
  assert.equal(answeredAfterExpiry(quote()), false, "no answer, nothing to judge");
});

test("[OFFERTE-AKKOORD] only the two known answers count", () => {
  assert.equal(isQuoteAnswer("accepted"), true);
  assert.equal(isQuoteAnswer("declined"), true);
  for (const bad of ["misschien", "yes", "", null, undefined, 1, {}]) {
    assert.equal(isQuoteAnswer(bad), false, `${JSON.stringify(bad)} is not an answer`);
  }
  // A stray value in the column must never read as an answer.
  assert.equal(answerOf(quote({ offerte_response: "maybe" })), null);
  assert.equal(answerRefusal(quote({ offerte_response: "maybe" })), null, "…so the quote is still open");
});

test("[OFFERTE-AKKOORD] the typed name is cleaned, bounded, and optional", () => {
  assert.equal(cleanResponderName("  Jan   de  Vries "), "Jan de Vries");
  assert.equal(cleanResponderName(""), null, "clicking accept without a name is still an acceptance");
  assert.equal(cleanResponderName("   "), null);
  assert.equal(cleanResponderName(null), null);
  assert.equal(cleanResponderName(42), null);
  assert.equal(cleanResponderName("x".repeat(500))?.length, MAX_NAME_LENGTH, "free text from a public page is bounded");
});

test("[OFFERTE-AKKOORD] the public view shows the quote and nothing else about the owner", () => {
  const view = toPublicQuoteView({
    quote: {
      ...quote(),
      invoice_number: "OF-2026-004",
      invoice_date: "2026-08-10",
      client_name: "Klant BV",
      total_inc_btw: 1210,
      // Deliberately present on the row and deliberately absent from the view:
      ...({ client_btw_number: "NL001234567B01", pay_token: "secret", sender_id: "owner-uuid" } as object),
    },
    lines: [{ description: "Advies", quantity: 2, unit: "uur", line_total: 1000 }],
    senderName: "Mijn BV",
    todayIso: "2026-08-14",
  })!;
  assert.equal(view.quoteNumber, "OF-2026-004");
  assert.equal(view.totalIncBtw, 1210);
  assert.equal(view.lines[0].description, "Advies");
  assert.equal(view.open, true);
  assert.equal(view.expired, false);

  // The allowlist: nothing else travelled.
  const json = JSON.stringify(view);
  for (const geheim of ["NL001234567B01", "secret", "owner-uuid"]) {
    assert.ok(!json.includes(geheim), `${geheim} must never reach the customer's page`);
  }
});

test("[OFFERTE-AKKOORD] the view says an expired quote is expired, and still lets it be answered", () => {
  const view = toPublicQuoteView({
    quote: { ...quote({ due_date: "2026-08-01" }), total_inc_btw: 100 },
    lines: [],
    senderName: "Mijn BV",
    todayIso: "2026-08-14",
  })!;
  assert.equal(view.expired, true);
  assert.equal(view.open, true, "expired is a fact the page states, never a door it closes");
});

test("[OFFERTE-AKKOORD] an answered quote still renders — the customer may see what they said", () => {
  const view = toPublicQuoteView({
    quote: {
      ...quote(),
      total_inc_btw: 100,
      offerte_response: "accepted",
      offerte_responded_at: "2026-08-12T14:03:00Z",
      offerte_response_name: "Jan de Vries",
    },
    lines: [],
    senderName: "Mijn BV",
    todayIso: "2026-08-14",
  })!;
  assert.equal(view.answer, "accepted");
  assert.equal(view.answeredBy, "Jan de Vries");
  assert.equal(view.open, false, "…but the answer is fixed");
});

test("[OFFERTE-AKKOORD] anything that is not a sent quote renders nothing at all", () => {
  for (const over of [{ invoice_type: "factuur" }, { invoice_type: "creditnota" }, { status: "draft" }, { status: "archived" }]) {
    assert.equal(
      toPublicQuoteView({ quote: quote(over), lines: [], senderName: "Mijn BV", todayIso: "2026-08-14" }),
      null,
      `${JSON.stringify(over)} must not be public`,
    );
  }
});

// ─── [AKKOORD-VERLOPEN] The fact that was computed and never told ──────────────────────────────
//
// answeredAfterExpiry was implemented, documented as "de ondernemer ziet het en beslist", covered
// by the tests above — and called from nowhere in the app. So the owner never saw it: a quote
// valid until 30 June, accepted on 14 August, arrived as a plain "Offerte geaccepteerd — zet hem
// om in een factuur wanneer je wilt", on the screen whose next button issues that invoice at
// March's price. The app still refuses nothing; the answer is valid and the decision is the
// owner's. It just stops being invisible.

test("[AKKOORD-VERLOPEN] the answer is still valid — nothing is refused for being late", () => {
  const laat = {
    invoice_type: "pro_forma", status: "sent", due_date: "2026-06-30",
    offerte_response: null, offerte_responded_at: null,
  };
  assert.equal(canAnswer(laat), true, "an expired quote may still be answered");
  assert.equal(answerRefusal(laat), null, "…and the route must not turn it away");
});

test("[AKKOORD-VERLOPEN] …and the lateness is a fact the owner is handed", () => {
  const beantwoord = {
    invoice_type: "pro_forma", status: "sent", due_date: "2026-06-30",
    offerte_response: "accepted", offerte_responded_at: "2026-08-14T09:00:00Z",
  };
  assert.equal(answeredAfterExpiry(beantwoord), true);
  // Same day is not late: a quote valid "until 30 June" is valid on 30 June.
  assert.equal(
    answeredAfterExpiry({ ...beantwoord, offerte_responded_at: "2026-06-30T23:59:00Z" }), false,
    "the last day of validity is a day of validity",
  );
});

test("[AKKOORD-VERLOPEN] it reaches the two places the owner decides", () => {
  // A pure module can be right and still change nothing — this one was, for as long as it existed.
  // The route's notification is what reaches them at the moment it happens; the detail screen is
  // where the button that issues the invoice sits.
  const route = readFileSync("src/app/api/offerte/[token]/route.ts", "utf8");
  assert.match(route, /const teLaat = answeredAfterExpiry\(/, "the route must ask");
  assert.match(route, /Let op: dit kwam ná de geldigheidsdatum/, "…and say so in the notification");
  const detail = readFileSync("src/app/dashboard/invoice/[id]/page.tsx", "utf8");
  assert.match(detail, /answeredAfterExpiry\(\{/, "the detail screen must ask too");
  assert.match(detail, /detail\.offerte\.naVervaldatum/, "…in the owner's language");
  const messages = readFileSync("src/lib/i18n/messages.ts", "utf8");
  assert.match(messages, /'detail\.offerte\.naVervaldatum'/);
  assert.match(messages, /Controleer of je prijs nog klopt/, "…and name what to check");
});
