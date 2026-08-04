// src/content/legal/invoice-mandate.test.ts
// [MANDAAT] What the Terms say about letting your accountant invoice in your name.
//
// WHY A TEST GUARDS PROSE HERE TOO
// §5.9 is not a feature description. It is the clause that keeps a legal fact visible: art. 35 lid 1
// Wet OB permits a third party to issue the invoice, and art. 35a leaves the responsibility with the
// entrepreneur. Those two travel together or not at all. A rewrite that keeps the first sentence and
// loses the second turns an accurate clause into a sales pitch — and it would do so silently, with a
// green build, because prose has no type.
//
// The assertions below are therefore about SUBSTANCE, not wording. Each one names a thing the client
// must still be told after any future edit: what they are giving away, that the liability does not
// move with it, that they are notified, and that they can stop it instantly.
//
// Asserts the RENDERED document, like the other two files here, so it covers what /voorwaarden says.
import test from "node:test";
import assert from "node:assert/strict";
import voorwaarden from "./algemene-voorwaarden";

test("the mandate clause exists and is off by default", () => {
  assert.ok(
    voorwaarden.includes("### 5.9 Je boekhouder laten factureren op jouw naam"),
    "§5.9 — the invoice mandate, distinct from §5.8 which is about the accountant PORTAL",
  );
  assert.match(
    voorwaarden,
    /Dit staat standaard \*\*uit\*\*/,
    "opt-in, and said so: a permission this large may never be the default",
  );
});

test("both halves of the law are stated — the permission AND the liability", () => {
  // Half one: this is allowed, and by what.
  assert.match(
    voorwaarden,
    /artikel 35 lid 1 Wet OB/,
    "the basis for a third party issuing the invoice",
  );
  assert.match(
    voorwaarden,
    /op jouw naam en voor jouw rekening/,
    "the law's own phrase — it is what the client is agreeing to",
  );
  // Half two, the one that is easy to drop because it does not sell anything.
  assert.match(
    voorwaarden,
    /artikel 35a Wet OB/,
    "the article that keeps the responsibility with the entrepreneur",
  );
  assert.match(
    voorwaarden,
    /verhuist niet mee met de machtiging/,
    "and it must be said plainly, not only by article number",
  );
});

test("what we give back in return is promised, not implied", () => {
  // A mandate the client cannot observe is a mandate they cannot police. These two are the reason
  // the feature is defensible at all, so they belong in the contract and not only in the code.
  assert.match(voorwaarden, /krijg je bericht in de app/, "notified on every invoice sent in their name");
  assert.match(voorwaarden, /wie hem heeft gemaakt/, "and the trail says who made it");
});

test("revoking is immediate, and does not come back by itself", () => {
  assert.match(
    voorwaarden,
    /Er is geen opzegtermijn en geen wachttijd/,
    "no notice period on withdrawing a permission",
  );
  // The bug this sentence describes is a real one that had to be fixed in both unlink routes:
  // unlinking removed the LINK while the mandate row stayed live, so re-inviting the same
  // accountant silently resurrected it.
  assert.match(
    voorwaarden,
    /komt niet vanzelf terug als je hem later opnieuw uitnodigt/,
    "a permission that returns on its own is not a permission",
  );
});

test("the clause draws the boundary of what the mandate is NOT", () => {
  // Without this the client has to guess how far they just went — and a client who guesses wide
  // does not grant it at all.
  assert.match(voorwaarden, /geen toegang tot je bankrekening/, "no bank access");
  assert.match(voorwaarden, /dient geen aangifte in/, "does not file the BTW return");
  assert.match(
    voorwaarden,
    /facturen die jij zelf hebt gemaakt/,
    "and never touches the invoices the client made themselves",
  );
});

test("an issued invoice number is still irreversible when the accountant issued it", () => {
  // Art. 35 does not soften because someone else pressed the button. The screen says this; the
  // terms have to agree, or the first correction becomes a support conversation about deleting a
  // legally issued invoice.
  assert.match(
    voorwaarden,
    /Een uitgereikte factuur komt niet terug/,
    "the point of no return applies to a mandated invoice too",
  );
  assert.match(voorwaarden, /gecorrigeerd met een creditnota/, "and the real remedy is named");
});

test("the mandate covers reminders, and says where that stops", () => {
  // [DEBITEUREN] Added when the accountant portal got a chase-list. §5.9.5 used to say the mandate
  // was invoices "and nothing else" — true when it was written, false the day reminders shipped. A
  // clause that quietly outgrows its own description is the failure this whole file guards against.
  assert.match(
    voorwaarden,
    /De machtiging dekt ook betalingsherinneringen/,
    "§5.9.7 — reminding is named, not left to be inferred from 'invoicing'",
  );
  assert.match(
    voorwaarden,
    /óók aan facturen die jij zelf hebt gemaakt/,
    "and the wider scope is admitted plainly: debiteurenbeheer over the client's OWN invoices",
  );
  assert.match(
    voorwaarden,
    /Een herinnering verandert niets aan de factuur/,
    "…which is only defensible because a reminder touches no number, amount or status",
  );
  assert.match(voorwaarden, /van elke verstuurde herinnering bericht/, "and the client is told each time");
});

test("the ceilings on reminding are published, including the one the client controls", () => {
  assert.match(voorwaarden, /hoogstens drie per factuur/, "the cap");
  assert.match(voorwaarden, /minstens drie dagen ertussen/, "the cooldown");
  assert.match(
    voorwaarden,
    /herinneringen voor een factuur stilgezet/,
    "reminders_paused is a promise to the client, not an internal flag",
  );
  // The WIK step is where a reminder stops being a nudge and starts costing the customer money.
  assert.match(
    voorwaarden,
    /artikel 6:96 BW/,
    "a formal aanmaning is never sent by a mandated third party",
  );
});

test("[WAARSCHUWING] §5.7.5 describes a mechanism, not an intention", () => {
  // This clause promised 30 days' notice before deletion and NOTHING implemented it: decidePurge()
  // returned true the instant the seven years were up. It is now a precondition — no provable
  // letter, no deletion — and the clause says so, because a client cannot verify code.
  assert.match(
    voorwaarden,
    /minstens 30 dagen vooraf per e-mail/,
    "the notice period itself",
  );
  assert.match(
    voorwaarden,
    /geen voornemen maar een voorwaarde/,
    "…and that it gates the deletion rather than merely preceding it",
  );
  assert.match(
    voorwaarden,
    /blijft je administratie staan/,
    "…including which way it fails when the mail does not go out",
  );
});
