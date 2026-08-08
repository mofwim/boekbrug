// [OFFERTE-VERSTUREN] Run: npx tsx --test src/lib/offerte-send.test.ts
//
// The load-bearing test is "already_invoice". Everything else here prevents a bad e-mail; that one
// prevents a customer holding a document marked "vrijblijvend" for work the books already carry as
// an issued, numbered invoice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOfferteSendable, offerteSubject, offerteFileName } from "./offerte-send";

const ok = {
  invoiceType: "pro_forma",
  invoiceNumber: null,
  clientEmail: "klant@voorbeeld.nl",
  lineCount: 2,
};

test("a quote with lines and an address may go out", () => {
  assert.deepEqual(checkOfferteSendable(ok), { ok: true });
  assert.deepEqual(checkOfferteSendable({ ...ok, invoiceType: "offerte" }), { ok: true });
});

test("a FACTUUR may never go out through this door", () => {
  // This route cannot mint a number and does not touch invoice_type. Letting an invoice through it
  // would mail a legal document under quote wording, with "vrijblijvend" on it.
  for (const t of ["factuur", "creditnota", "", null, undefined, "onzin"]) {
    const r = checkOfferteSendable({ ...ok, invoiceType: t });
    assert.equal(r.ok, false, `type ${String(t)}`);
    if (!r.ok) assert.equal(r.code, "not_a_quote");
  }
});

test("a quote that ALREADY carries a number is refused", () => {
  // The send route converts on send (isConversion), so a number means this quote is already an
  // invoice. Mailing it as a quote afterwards puts a "vrijblijvend" document in the customer's
  // inbox for work the books hold as issued and numbered.
  const r = checkOfferteSendable({ ...ok, invoiceNumber: "2026-014" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "already_invoice");
  assert.match(r.error, /al omgezet naar een factuur/);
});

test("whitespace is not a number", () => {
  assert.equal(checkOfferteSendable({ ...ok, invoiceNumber: "   " }).ok, true);
  assert.equal(checkOfferteSendable({ ...ok, invoiceNumber: "" }).ok, true);
});

test("no usable client address, no send", () => {
  for (const e of ["", "   ", null, undefined, "geen-adres", "a@b", "twee@@apen.nl", "met spatie@x.nl", "@x.nl", "x@.nl", "x@nl."]) {
    const r = checkOfferteSendable({ ...ok, clientEmail: e });
    assert.equal(r.ok, false, `email ${JSON.stringify(e)} must be refused`);
    if (!r.ok) assert.equal(r.code, "no_client_email");
  }
});

test("an address the provider can actually deliver is accepted, even an unusual one", () => {
  // Deliberately loose: the mail provider is the real judge, and a stricter pattern refuses valid
  // addresses that Resend delivers without complaint.
  for (const e of ["klant+offerte@voorbeeld.nl", "a.b-c@sub.domein.co.uk", "x@y.io"]) {
    assert.equal(checkOfferteSendable({ ...ok, clientEmail: e }).ok, true, e);
  }
});

test("an empty quote is not sent", () => {
  for (const n of [0, -1, NaN]) {
    const r = checkOfferteSendable({ ...ok, lineCount: n });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "no_lines");
  }
});

test("each refusal has its own sentence — four reasons need four actions", () => {
  const messages = new Set<string>();
  for (const bad of [
    { ...ok, invoiceType: "factuur" },
    { ...ok, invoiceNumber: "2026-1" },
    { ...ok, clientEmail: "" },
    { ...ok, lineCount: 0 },
  ]) {
    const r = checkOfferteSendable(bad);
    assert.equal(r.ok, false);
    if (!r.ok) messages.add(r.error);
  }
  assert.equal(messages.size, 4, "no two refusals may share a sentence");
});

test("the subject names the sender, because a customer asked several suppliers", () => {
  assert.equal(offerteSubject("Jansen Bouw"), "Offerte van Jansen Bouw");
  assert.equal(offerteSubject("  "), "Offerte", "no dangling 'van'");
  assert.equal(offerteSubject(""), "Offerte");
});

test("the attachment is not called factuur-something", () => {
  assert.equal(offerteFileName("Klant BV", "2026-08-08"), "offerte-Klant-BV-2026-08-08.pdf");
  assert.equal(offerteFileName(null, null), "offerte.pdf");
  assert.equal(offerteFileName("Van der Berg & Zn.", "2026-08-08"), "offerte-Van-der-Berg-Zn-2026-08-08.pdf");
  assert.doesNotMatch(offerteFileName("Klant", "2026-08-08"), /factuur/);
});

test("a very long customer name cannot make an unusable filename", () => {
  const name = offerteFileName("A".repeat(200), "2026-08-08");
  assert.ok(name.length < 80, `filename is ${name.length} chars`);
  assert.match(name, /^offerte-A+-2026-08-08\.pdf$/);
});
