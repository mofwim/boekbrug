// [OFFERTE-VERSTUREN] Run: npx tsx --test src/lib/offerte-send.test.ts
//
// The load-bearing test is "already_invoice". Everything else here prevents a bad e-mail; that one
// prevents a customer holding a document marked "vrijblijvend" for work the books already carry as
// an issued, numbered invoice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOfferteSendable, offerteSubject, offerteFileName, offerteEmailHtml } from "./offerte-send";

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

// ─── [OFFERTE-MAILTEKST] What the customer actually opens ──────────────────────────────────────
//
// This body was built inline inside sendOfferteToClient, next to the network call, so nothing here
// could be asserted without sending mail. Three defects reached customers in that state. Now it is
// a pure function and every degradation has a case.

const MAIL = {
  clientName: "Stichting Contour de Twern",
  senderName: "Kiwi Food Market",
  senderEmail: "info@kiwifoodmarket.nl",
  totalInc: 394.99,
  validUntil: "2026-09-07",
  offerteDate: "2026-08-08",
};

/** The body with the tags taken off — what a person reads, not what the client renders. */
const readable = (html: string) =>
  html
    .replace(/<a [^>]*href="mailto:[^"]*"[^>]*>([^<]*)<\/a>/g, "$1")
    .replace(/<\/(p|h2|div)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

test("[OFFERTE-MAILTEKST] the ordinary quote reads the way it should", () => {
  const text = readable(offerteEmailHtml(MAIL));
  assert.match(text, /^Offerte van Kiwi Food Market$/m, "the heading names the sender");
  assert.match(text, /^Beste Stichting Contour de Twern,$/m);
  assert.match(text, /^Datum: 08-08-2026$/m);
  assert.match(text, /^Geldig tot: 07-09-2026$/m);
  assert.match(text, /^Totaal incl\. btw: € 394,99$/m);
  // The closing paragraph wraps in the template, so a sentence assertion has to ignore where the
  // line happens to break — the customer's mail client rewraps it anyway.
  const sentence = text.replace(/\s+/g, " ");
  assert.match(sentence, /Deze offerte is vrijblijvend: er hoeft nog niets betaald te worden en er is nog geen factuur\./);
  assert.match(sentence, /antwoord dan op deze mail of stuur een bericht naar info@kiwifoodmarket\.nl/);
  assert.match(sentence, /dan sturen we de factuur\./);
});

test("[OFFERTE-KOP] the heading falls back exactly like the subject does", () => {
  // It read "Offerte van" with nothing after it. The subject guarded against this and the body did
  // not, so one of the two had to be wrong — and a customer would have seen which.
  const text = readable(offerteEmailHtml({ ...MAIL, senderName: "" }));
  assert.match(text, /^Offerte$/m, "an empty company name gives a heading that still reads");
  assert.doesNotMatch(text, /Offerte van\s*$/m, "never a dangling 'van'");
  // The property that keeps them from drifting again: the heading IS the subject.
  for (const name of ["Kiwi Food Market", "", "   ", "Jan"]) {
    assert.match(
      readable(offerteEmailHtml({ ...MAIL, senderName: name })),
      new RegExp(`^${offerteSubject(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
      `heading and subject must agree for ${JSON.stringify(name)}`,
    );
  }
});

test("[OFFERTE-GELDIGHEID] a quote with no end date says so instead of dropping the line", () => {
  // The row simply disappeared. What the customer then held was an offer that never expires, and
  // they can come back on it a year later at last year's price.
  const text = readable(offerteEmailHtml({ ...MAIL, validUntil: null }));
  assert.match(text, /^Geldig tot: niet afgesproken$/m, "the line must still be there, and honest");
});

test("[OFFERTE-MAILTEKST] no reply address gives no dangling link", () => {
  const text = readable(offerteEmailHtml({ ...MAIL, senderEmail: null }));
  assert.match(text, /Ga je akkoord, laat het ons dan weten — dan sturen we de factuur\./);
  assert.doesNotMatch(offerteEmailHtml({ ...MAIL, senderEmail: null }), /mailto:/, "no empty mailto");
});

test("[OFFERTE-MAILTEKST] an unknown total is left out, never printed as € 0,00", () => {
  // The real amount is in the PDF either way. "€ 0,00" beside a thousand-euro quote is the kind of
  // contradiction a customer rightly phones about.
  const text = readable(offerteEmailHtml({ ...MAIL, totalInc: 0 }));
  assert.doesNotMatch(text, /Totaal incl\. btw/, "no amount row at all");
  assert.doesNotMatch(text, /0,00/);
});

test("[M2] a customer name containing markup renders as text", () => {
  // The name comes from whatever was typed into the invoice, and this body reaches a third party.
  const html = offerteEmailHtml({ ...MAIL, clientName: '<b>Acme</b> & Zn "BV"' });
  assert.doesNotMatch(html, /<b>Acme<\/b>/, "the tag must not survive as markup");
  assert.match(html, /&lt;b&gt;Acme&lt;\/b&gt; &amp; Zn &quot;BV&quot;/, "…it is escaped instead");
});

test("[OFFERTE-MAILTEKST] the mail never calls itself a factuur or asks for payment", () => {
  // The whole point of the document. It promises the invoice comes later.
  const text = readable(offerteEmailHtml(MAIL));
  assert.doesNotMatch(text, /Vervaldatum|Gelieve te betalen|verzoeken u vriendelijk/);
  assert.doesNotMatch(text, /IBAN/, "a quote does not carry payment instructions");
});
