import test from "node:test";
import assert from "node:assert/strict";
import { isMachineCode, serverSentence, failureText } from "./server-message";

// ─── [SERVER-ZIN] The codes that were reaching real screens ─────────────────────────────────────

test("[SERVER-ZIN] every code these routes actually emit is recognised as one", () => {
  // Read off the routes, not invented. Each of these was rendered verbatim on a money screen:
  // /api/bank/allocate on the payment-allocation screen, /api/cash in the kasboek,
  // /api/bank/delete-statement in the bank list, /api/invoice/pay-toggle on /vandaag.
  for (const code of [
    "unauthorized", "invalid_body", "invalid_transaction", "invalid_invoice_id",
    "transaction_not_found", "invoice_read_failed", "verwerkt", "lookup_failed",
    "opening_balance_lookup_failed", "invoice_already_paid", "not_payable", "pay_failed",
    "client_key_conflict", "money_check_failed", "read_failed", "archive_failed",
  ]) {
    assert.equal(isMachineCode(code), true, `${code} must never reach a phone`);
  }
});

test("[SERVER-ZIN] every sentence these routes actually emit survives", () => {
  // Also read off the routes. Suppressing these would trade a visible problem for an invisible one:
  // the owner would lose a reason that names what to do.
  for (const sentence of [
    "Niet ingelogd",
    "Ongeldig verzoek",
    "Bankafschrift niet gevonden",
    "Dit is geen bankafschrift",
    "Kies eerst minstens één factuur.",
    "Een betaling verdelen over meer dan 5 facturen gaat niet in één keer.",
    "Controleer de datum — een kasboeking kan niet in de toekomst liggen.",
    // Lowercase Dutch, which a "must start with a capital" rule would have thrown away.
    "direction moet 'in' of 'out' zijn",
    "amount moet groter dan 0 zijn",
    "ongeldige categorie",
  ]) {
    assert.equal(isMachineCode(sentence), false, `${sentence} is for the owner`);
  }
});

test("[SERVER-ZIN] the boundary cases the rule has to survive", () => {
  assert.equal(isMachineCode(""), false, "nothing is not a code");
  assert.equal(isMachineCode("   "), false);
  assert.equal(isMachineCode(null), false);
  assert.equal(isMachineCode(undefined), false);
  assert.equal(isMachineCode(42), false, "a non-string cannot be a code");
  assert.equal(isMachineCode({}), false);
  // A single lowercase word IS a code in this codebase — `verwerkt` is the live example.
  assert.equal(isMachineCode("verwerkt"), true);
  // …but a capitalised single word is a word.
  assert.equal(isMachineCode("Verwerkt"), false);
  // Trailing space around a code still makes it a code.
  assert.equal(isMachineCode(" invoice_not_found "), true);
  // A code with digits, which several routes use.
  assert.equal(isMachineCode("pgrst204"), true);
});

// ─── [SERVER-ZIN] What the screen is handed ──────────────────────────────────────────────────────

test("[SERVER-ZIN] a code is replaced by the screen's own line", () => {
  assert.equal(failureText(409, { error: "invoice_read_failed" }, "Boeken is niet gelukt"), "Boeken is niet gelukt");
  assert.equal(serverSentence(409, { error: "invoice_read_failed" }), null);
});

test("[SERVER-ZIN] a sentence the server wrote is kept", () => {
  assert.equal(
    failureText(409, { error: "Bankafschrift niet gevonden" }, "Mislukt"),
    "Bankafschrift niet gevonden",
  );
});

test("[SERVER-ZIN] a written detail beats the general line", () => {
  // A route that attaches a detail is carrying a fact the code cannot.
  assert.equal(
    failureText(409, { error: "not_payable", detail: "status 'draft' kan niet als betaald worden gemarkeerd" }, "Mislukt"),
    "status 'draft' kan niet als betaald worden gemarkeerd",
  );
});

test("[SERVER-ZIN] a 5xx detail is a raw database string and never shown", () => {
  const raw = "[MANUAL-PARTIAL-PAY] caller 99999999-… may not book for 11111111-…";
  assert.equal(serverSentence(500, { error: "pay_failed", detail: raw }), null);
  assert.equal(failureText(500, { error: "pay_failed", detail: raw }, "Er ging iets mis"), "Er ging iets mis");
  // …and a 4xx detail still is, because that one was written on purpose.
  assert.equal(serverSentence(400, { detail: "De betaaldatum kan niet kloppen." }), "De betaaldatum kan niet kloppen.");
});

test("[SERVER-ZIN] a missing, empty or junk body falls back cleanly", () => {
  for (const body of [null, undefined, {}, { error: "" }, { error: "   " }, { error: 42 }, { detail: [] }] as const) {
    assert.equal(failureText(500, body as never, "Mislukt"), "Mislukt", JSON.stringify(body));
  }
});

test("[SERVER-ZIN] the fallback is the caller's, so it can be translated", () => {
  // This module holds no language of its own: a Dutch string in here would render underneath an
  // Arabic interface, which is the half-finished translation AGENTS.md describes.
  const mod = "" + failureText(409, { error: "unauthorized" }, "جلستك انتهت");
  assert.equal(mod, "جلستك انتهت");
});
