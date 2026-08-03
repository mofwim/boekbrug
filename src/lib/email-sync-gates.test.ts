// [EMAIL-SYNC] Pure node test — run: npx tsx --test src/lib/email-sync-gates.test.ts
//
// WHY THIS TEST EXISTS
//
// The email sync is the door most invoices actually arrive through, and it is the one door with
// nobody standing at it. Its gates live inside one very large async function that reaches Gmail,
// Outlook, Storage, the AI and four tables, so no unit test calls them — which is why two of them
// had been quietly wrong for as long as they had existed.
//
// Both were invisible for the same reason: they fail by returning a normal-looking value.
//
//   · The byte-hash gate read `const { data: existingByHash } = …`. supabase-js answers a failed
//     read with { data: null, error }, and null here means "this file is new". A read that could
//     not run therefore imported the identical file again — same cost, same voorbelasting, twice —
//     with nothing saying so. The manual doors have a human who at least sees a confusing message;
//     here there is no one.
//
//   · When the (user_id, content_hash) unique index then refused the second document row, the
//     generic error branch deleted the storage object, set document_id and pdf_url to null, and
//     saved the invoice anyway. The closing package resolves the evidence PDF through
//     invoices.document_id, so that is a cost in the books with no paper behind it — the state
//     /api/intake calls unacceptable in its own [R1] note, produced by the door next to it.
//
// A source-level gate is the honest instrument for code a unit test cannot reach. It does not
// prove the sync behaves; it proves the specific lines that make it honest are still there, so a
// refactor cannot silently undo them the way one already undid the [IBAN-CHECK-HONEST] throw.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SYNC = readFileSync("src/lib/email-integration.ts", "utf8");

/** The source of one `const { … } = await supabase.from('X')…` read, by the variable it binds. */
function readBinding(varName: string): string {
  const at = SYNC.indexOf(`const { data: ${varName}`);
  assert.notEqual(at, -1, `the read binding ${varName} must still exist — this gate is worthless otherwise`);
  return SYNC.slice(at, at + 700);
}

test("[DEDUP-READ-HONEST] the sync's two hard dedup gates cannot mistake a failed read for 'new'", () => {
  for (const { name, flagged } of [
    { name: "existingByHash", flagged: "hashErr" },
    { name: "existingByMessage", flagged: "messageErr" },
  ]) {
    const src = readBinding(name);
    assert.match(
      src, new RegExp(`error:\\s*${flagged}`),
      `the ${name} gate must destructure its error — without it "we could not look" reads as "not a duplicate"`,
    );
    assert.match(
      src, new RegExp(`if\\s*\\(${flagged}\\)[\\s\\S]{0,400}?dedupCheckFailed\\s*=\\s*true`),
      `${name}'s error must actually set dedupCheckFailed — destructuring it and dropping it is the same silence`,
    );
  }
});

test("[DEDUP-READ-HONEST] the flag is declared before the first gate that can set it", () => {
  // It used to sit halfway down, beside the semantic probes, so the two gates that run FIRST had no
  // way to report a failed read even in principle. Order is the whole fix here.
  const decl = SYNC.indexOf("let dedupCheckFailed = false");
  const firstGate = SYNC.indexOf("const { data: existingByHash");
  assert.notEqual(decl, -1, "dedupCheckFailed must still be declared");
  assert.ok(decl < firstGate, "dedupCheckFailed is declared AFTER the byte-hash gate — that gate cannot report");
});

test("[DEDUP-READ-HONEST] a failed check reaches the card instead of dying in a variable", () => {
  assert.match(
    SYNC, /if \(dedupCheckFailed\)[\s\S]{0,300}?markDuplicateCheckUnavailable/,
    "dedupCheckFailed must be turned into the needs-review marker the queue prints",
  );
});

test("[EVIDENCE-KEEP] a hash collision links to the stored document instead of booking without paper", () => {
  const at = SYNC.indexOf("const isHashCollision");
  assert.notEqual(at, -1, "the sync must still distinguish a duplicate-key refusal from a real failure");
  const block = SYNC.slice(at, at + 1600);

  assert.match(block, /23505/, "the collision test must key on the SQLSTATE, not only on a message");
  assert.match(block, /content_hash/, "it must resolve the document that already holds these bytes");
  assert.match(
    block, /documentId = recovered\.id/,
    "the invoice must point at the document that exists — an invoice with no document_id has unreachable evidence",
  );

  // Ordering is the substance: the generic branch nulls documentId, so it must not run first.
  const recoverAt = block.indexOf("if (recovered)");
  const genericAt = block.indexOf("} else if (docErr || !doc)");
  assert.ok(recoverAt !== -1 && genericAt !== -1, "both branches must be present");
  assert.ok(
    recoverAt < genericAt,
    "the recovery branch must come BEFORE the generic failure branch, or the invoice loses its paper anyway",
  );
});

test("[IBAN-CHECK-HONEST] the fraud lookup still has no catch to swallow its own signal", () => {
  // The instance this gate remembers: two `if (error) throw` lines written so a failed supplier
  // lookup could not read as "no IBAN on record", and a `catch { return null }` three lines below
  // that returned exactly the null they were written to prevent. Both the throws and the comments
  // survived; only the behaviour was gone. iban-change.test.ts proves the OUTCOME with a stub —
  // this proves the shape, because the shape is what a refactor restores by reflex.
  const src = readFileSync("src/lib/iban-change.ts", "utf8");
  const at = src.indexOf("export async function knownIbanForVendor");
  assert.notEqual(at, -1, "knownIbanForVendor must still exist");
  const body = src.slice(at, src.indexOf("export async function detectIbanChange"));
  assert.match(body, /if \(error\) throw/, "a failed read must still leave as a throw");
  assert.doesNotMatch(
    body, /\bcatch\b/,
    "knownIbanForVendor must not catch: its only caller turns the throw into a stated 'unavailable', " +
      "and a catch here silently restores the bug where a skipped fraud check reads as a clean one",
  );
});
