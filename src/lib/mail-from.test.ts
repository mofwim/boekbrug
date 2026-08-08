// [AFZENDERNAAM] Pure node test — run: npx tsx --test src/lib/mail-from.test.ts
//
// The load-bearing cases are the hostile ones. This value is built from a name a user typed and it
// becomes a mail header that reaches strangers, so the tests that matter are the ones where the
// name is trying to be something other than a name.

import { test } from "node:test";
import assert from "node:assert/strict";

import { customerMailFrom, sanitizeSenderName, MAIL_FROM_ADDRESS } from "./mail-from";

test("[AFZENDERNAAM] the customer sees the business, and how it was sent", () => {
  // The report: an inbox row reading "BoekBrug" about an amount the recipient is asked to pay, from
  // a name they have no relationship with.
  assert.equal(
    customerMailFrom("Kiwi Food Market"),
    '"Kiwi Food Market via BoekBrug" <noreply@boekbrug.nl>',
  );
});

test("[AFZENDERNAAM] the address is never the owner's own — it cannot be", () => {
  // Mail is authenticated per domain. Sending as kfmtilburg@hotmail.com would fail their DMARC and
  // land in spam or nowhere, because boekbrug.nl is the only verified domain.
  assert.match(customerMailFrom("Kiwi Food Market"), /<noreply@boekbrug\.nl>$/);
  assert.equal(MAIL_FROM_ADDRESS, "noreply@boekbrug.nl");
});

test("[AFZENDERNAAM] no usable name falls back instead of producing a dangling 'via'", () => {
  for (const empty of ["", "   ", null, undefined, "@@@", '"']) {
    assert.equal(customerMailFrom(empty), '"BoekBrug" <noreply@boekbrug.nl>', `for ${JSON.stringify(empty)}`);
  }
});

test("[AFZENDERNAAM] a business actually called BoekBrug is not 'BoekBrug via BoekBrug'", () => {
  assert.equal(customerMailFrom("BoekBrug"), '"BoekBrug" <noreply@boekbrug.nl>');
});

test("[AFZENDERNAAM] a newline cannot open a second header", () => {
  // Header injection. The provider builds the header from JSON, so this is defence in depth — but
  // a From value is the last place to rely on someone else's escaping.
  const evil = customerMailFrom("Kiwi\r\nBcc: victim@example.com");
  assert.doesNotMatch(evil, /[\r\n]/, "no control characters survive");
  assert.doesNotMatch(evil, /Bcc:.*\n/, "and nothing became a header");
  // The @ goes too — the address rule catches it on the way past, so the smuggled recipient is not
  // even a valid address by the time it is (harmlessly) sitting inside the display name.
  assert.equal(evil, '"Kiwi Bcc: victim example.com via BoekBrug" <noreply@boekbrug.nl>');
  assert.equal((evil.match(/@/g) ?? []).length, 1, "one @ in the header, and it is ours");
});

test("[AFZENDERNAAM] a name cannot dress itself up as the sending address", () => {
  // The classic spoof: a display name that reads like an address, so a narrow client shows the
  // fake and hides the real one.
  const spoof = customerMailFrom('service@bank.nl <security@bank.nl>');
  assert.doesNotMatch(spoof, /@bank\.nl/, "the @ and the brackets must not survive");
  assert.match(spoof, /<noreply@boekbrug\.nl>$/, "exactly one address, and it is ours");
  assert.equal((spoof.match(/@/g) ?? []).length, 1, "exactly one @ in the whole header");
});

test("[AFZENDERNAAM] a comma in a trade name does not become two senders", () => {
  // RFC 5322 reads `,` as an address separator. "Jansen, Pietersen & Co" is an ordinary Dutch
  // name, and unquoted it would split the header — which is why the label is always quoted.
  const from = customerMailFrom("Jansen, Pietersen & Co");
  assert.equal(from, '"Jansen, Pietersen & Co via BoekBrug" <noreply@boekbrug.nl>');
  assert.equal((from.match(/"/g) ?? []).length, 2, "the quotes are balanced and the comma is inside");
});

test("[AFZENDERNAAM] 'via BoekBrug' is never droppable", () => {
  // It is what keeps the display name from being a free-form claim about who sent the mail.
  for (const n of ["Kiwi Food Market", "A", "Ölhandel Über", "Jansen, Pietersen & Co"]) {
    assert.match(customerMailFrom(n), /via BoekBrug" </, `missing for ${n}`);
  }
});

test("[AFZENDERNAAM] an absurd name is cut where we control the result", () => {
  const from = customerMailFrom("X".repeat(400));
  assert.ok(from.length < 120, `header stays sane — it is ${from.length} chars`);
  assert.match(from, /via BoekBrug" <noreply@boekbrug\.nl>$/, "…and still well-formed");
});

test("[AFZENDERNAAM] accents and ordinary punctuation are left alone", () => {
  // Only what is dangerous comes out. A trade name is a name.
  assert.equal(sanitizeSenderName("Café Zonneschijn B.V."), "Café Zonneschijn B.V.");
  assert.equal(sanitizeSenderName("  Kiwi   Food  Market  "), "Kiwi Food Market");
});
