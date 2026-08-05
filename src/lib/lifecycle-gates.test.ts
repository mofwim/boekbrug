// [LIFECYCLE] Pure node test — run: npx tsx --test src/lib/lifecycle-gates.test.ts
//
// Findings from the end-to-end audit of an invoice's life, held as gates.
//
// Every one of these is the same shape: a refusal that was WRITTEN, argued for at length in its own
// comment, and then made unreachable by a sibling line — a nested guard, or a newer code path that
// returns before it. Nothing turns red when that happens. The invoice imports, the payment books,
// the screen looks right, and the only trace is a number in the books that nobody will question
// until an accountant does, a year later.
//
// They are source-level because that is where the defect lives. Both of these are about the ORDER
// and the PLACEMENT of code, not about what any function returns when you call it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Source with comments stripped — these files explain the very mistakes the gates look for. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

// ─── [DEDUP-READ-HONEST] A failed duplicate probe must not read as "no duplicate" ─────
//
// supabase-js does not throw. A timed-out probe on a busy invoices table gives { data: null } →
// `?? []` → no candidate found → possibleDup null. If the "we could not run the check" marker is
// only written when a candidate WAS found, it can never be written at all — and the invoice then
// reads 'clean' to classifyImportHealth and AUTO-BOOKS.
//
// The cost, concretely: a paper invoice photographed after the same invoice arrived by e-mail (the
// bytes differ, so the hash gate correctly misses) becomes a second purchase invoice with no human
// in the loop — a second cost in the P&L and a second voorbelasting claim, discoverable only by
// reading the inkoopboek line by line.

test("[DEDUP-READ-HONEST] the intake path can actually WRITE the flag it computes", () => {
  const src = code("src/app/api/intake/route.ts");

  // The bug in one line: the merge nested inside "a candidate was found".
  assert.doesNotMatch(
    src, /if \(possibleDup\) \{\s*const merged = \(dedupCheckFailed/,
    "the duplicate-check-unavailable marker is nested inside `if (possibleDup)` again. It exists " +
      "for the case where the probe FAILED and therefore found nothing, so nesting it there makes " +
      "it provably unwritable — and a failed probe then auto-books a second copy of a bill.",
  );

  // Both handlers in this file — the photo/upload path and the UBL e-invoice path.
  const merges = [...src.matchAll(/dedupCheckFailed\s*\?\s*markDuplicateCheckUnavailable/g)];
  assert.equal(
    merges.length, 2,
    `expected the marker on BOTH intake handlers (photo/upload and UBL), found ${merges.length}`,
  );

  // And it must be computed, not just referenced: three reads that nothing writes is how this
  // started.
  assert.match(src, /if \(dedupErr\) dedupCheckFailed = true/, "the failure must still be recorded");
});

test("[DEDUP-READ-HONEST] the sibling paths still apply it unconditionally", () => {
  // These two were always right, and they are the shape intake now matches. If a later change
  // nests them the same way, the same silent double-booking comes back through those doors.
  // The invariant, not the syntax: these two doors reach it differently — upload with a ternary on
  // the field_confidence it is about to store, email-integration with its own `if (dedupCheckFailed)`
  // over an accumulating safecore. Both are correct. What must hold in either shape is that the
  // marker is reachable when the probe FAILED, which is exactly when no candidate exists.
  for (const f of ["src/app/api/email/upload/route.ts", "src/lib/email-integration.ts"]) {
    const src = code(f);
    assert.match(
      src, /markDuplicateCheckUnavailable\(/,
      `${f} no longer applies the duplicate-check-unavailable marker on a failed probe`,
    );
    assert.doesNotMatch(
      src, /if \(possibleDup\)[\s\S]{0,200}?markDuplicateCheckUnavailable/,
      `${f} has put the marker inside "a candidate was found" — the intake bug, in a second door`,
    );
  }
});

// ─── [DECLARED-INVOICE] The double-payment refusal must precede the booking ───────────
//
// The refusal exists for the ATAPACK case: a payment whose description names TWO invoices while
// only one is in the administration. Booking the whole line onto the one we hold spends the money
// for the other, and when that invoice arrives it reads fully open, gets dunned, and is paid a
// second time.
//
// It was written, argued for ("waiting is reversible and a wrong booking is not"), and then a newer
// atomic RPC was added ABOVE it that books and returns. From the moment bank_confirm_atomic.sql was
// applied, the refusal was unreachable — it survived only on the pre-migration fall-through. A
// guard that runs after the write is not a guard.

test("[DECLARED-INVOICE] the refusal runs before EVERY booking path, not just the legacy one", () => {
  const src = code("src/app/api/bank/confirm/route.ts");

  const guard = src.indexOf("declared_invoice_missing");
  const atomic = src.search(/rpc as any\)\("confirm_bank_payment"|rpc\("confirm_bank_payment"/);
  const legacy = src.indexOf('rpc("apply_bank_payment"');

  assert.ok(guard > 0, "the declared-invoice refusal is gone entirely");
  assert.ok(atomic > 0, "the atomic confirm path is gone");
  assert.ok(legacy > 0, "the legacy apply path is gone");

  assert.ok(
    guard < atomic,
    "the declared-invoice refusal sits AFTER the atomic confirm_bank_payment call, which books and " +
      "returns — so on any database where bank_confirm_atomic.sql is applied the refusal is dead " +
      "code, and a payment naming an invoice you do not hold is booked in full onto the one you do.",
  );
  assert.ok(
    guard < legacy,
    "the refusal must precede the legacy booking path too",
  );
});

test("[DECLARED-INVOICE] and it still knows how much of the line the booking would take", () => {
  // The refusal only fires when the booking would swallow the WHOLE line (`!moneyLeftOver`), no
  // amount was stated, and the owner did not override. Hoisting it above the atomic call is only
  // correct while that arithmetic is hoisted with it — otherwise the condition silently reads
  // `undefined` and the guard never fires for a different reason than before.
  const src = code("src/app/api/bank/confirm/route.ts");
  const money = src.indexOf("const moneyLeftOver = paymentExceedsOpenBalance");
  const guard = src.indexOf("declared_invoice_missing");
  assert.ok(money > 0 && money < guard, "moneyLeftOver must be computed before the refusal reads it");
  assert.match(
    src, /requestedAmount == null && !force && !moneyLeftOver/,
    "the refusal's three conditions must be intact: no stated amount, no override, whole line consumed",
  );
});

// ─── The import itself, end to end on the expression that now runs on every intake ────
//
// The source gates above hold the PLACEMENT. This holds the BEHAVIOUR, and above all the half that
// a fix in an import path has to prove first: that a healthy invoice still imports exactly as it
// did. Moving a merge out of a guard makes it run on every single import — including the millions
// where nothing is wrong — so "unchanged for a clean invoice" is not an assumption to make.

import { mergePossibleDuplicate, markDuplicateCheckUnavailable } from "./possible-duplicate-collect";
import type { PossibleDuplicate } from "./safecore";

/** The exact expression /api/intake now runs, unconditionally, on both handlers. */
function intakeMerge(
  fc: Record<string, unknown>,
  dedupCheckFailed: boolean,
  possibleDup: PossibleDuplicate | null,
): Record<string, unknown> {
  const merged = (dedupCheckFailed
    ? markDuplicateCheckUnavailable(mergePossibleDuplicate(fc, possibleDup))
    : mergePossibleDuplicate(fc, possibleDup)) as Record<string, unknown> | null;
  if (merged?._safecore) fc._safecore = merged._safecore;
  return fc;
}

const readField = () => ({ vendor: 0.93, invoice_number: 0.98, _safecore: { arithmetic_ok: true } }) as Record<string, unknown>;
const LOOKALIKE: PossibleDuplicate = {
  match: { id: "x", invoice_number: "2026-4471", client_name: "Atapack" } as PossibleDuplicate["match"],
  reason: "zelfde bedrag en datum",
};

test("[DEDUP-READ-HONEST] a healthy import is byte-for-byte what it was before the fix", () => {
  // The one that matters most. This expression now runs on EVERY import, so the ordinary case —
  // a clean invoice, a probe that answered, no look-alike — must come out untouched.
  const before = JSON.stringify(readField());
  const after = intakeMerge(readField(), false, null);
  assert.equal(JSON.stringify(after), before, "a clean import must not gain a single key");
});

test("[DEDUP-READ-HONEST] a probe that could not run now reaches the row", () => {
  // The whole point. Before the fix this produced nothing at all, and the invoice auto-booked.
  const sc = intakeMerge(readField(), true, null)._safecore as Record<string, unknown>;
  assert.equal(sc.possible_duplicate, true, "classifyImportHealth reads this → needs-review → no auto-advance");
  assert.equal(sc.possible_duplicate_reason, "we konden de dubbelcheck niet uitvoeren");
  assert.equal(sc.arithmetic_ok, true, "and it does not trample what the reader already stored");
});

test("[DEDUP-READ-HONEST] a NAMED look-alike outranks the generic reason", () => {
  // The precedence markDuplicateCheckUnavailable's own comment argues for: a run that found a
  // look-alike and then failed its second probe must keep naming the invoice it did find. "Lijkt op
  // factuur 2026-4471" is something the owner can act on; "we konden het niet nagaan" is not.
  const found = intakeMerge(readField(), false, LOOKALIKE)._safecore as Record<string, unknown>;
  const both = intakeMerge(readField(), true, LOOKALIKE)._safecore as Record<string, unknown>;
  assert.equal(found.possible_duplicate_of, "2026-4471");
  assert.deepEqual(both, found, "a failed second probe must not overwrite a real find");
});

// ─── [WATERMARK-SERVER-TIME] The mailbox must not be stoppable by a sender ────────────
//
// The sync watermark is the point every LATER sync starts from. It walks the dates of the messages
// in the window and stores the newest complete one; the next run then asks the provider for mail
// after it.
//
// The Gmail path took that date from the `Date:` header — written by whoever sent the mail. One
// message stamped 1 January 2027 does not import one wrong invoice: it moves the mark to 2027 and
// the mailbox imports NOTHING for a year and a half, while every sync reports success. It needs no
// attacker; a sending server with a wrong clock is enough, and the app cannot tell them apart.
//
// Microsoft has always used receivedDateTime — the server's own receipt time. Gmail now uses
// internalDate, its exact analogue. And because a third provider will one day be added by someone
// who has not read that sentence, a second belt drops future-dated messages from the walk
// regardless of where the date came from.

test("[WATERMARK-SERVER-TIME] the Gmail walk is fed the server's receipt time, not the sender's header", () => {
  const src = code("src/lib/email-integration.ts");
  assert.match(
    src, /const internalMs = Number\(msg\.internalDate\)/,
    "the Gmail message date no longer comes from internalDate — a sender's `Date:` header can move " +
      "the sync watermark, which stops the mailbox importing for as long as that date is away",
  );
  // The header stays as a FALLBACK, which is correct — a message with neither is caught by the
  // existing NaN guard. What must not come back is the header as the primary source.
  assert.doesNotMatch(
    src, /const date = headerVal\('date'\)/,
    "the header is the primary source again",
  );
  // Microsoft's side must keep using the server's own timestamp.
  assert.match(src, /date: m\.receivedDateTime as string/, "the Microsoft path lost receivedDateTime");
});

test("[WATERMARK-SERVER-TIME] a future-dated message is dropped from the walk, whatever the provider", () => {
  const src = code("src/lib/email-integration.ts");
  assert.match(src, /const futureFloorMs = Date\.now\(\)/, "the future clamp is gone");
  assert.match(
    src, /t <= futureFloorMs/,
    "the walk no longer excludes future-dated messages — the belt that protects a mailbox when a " +
      "provider returns something odd, and when a third provider is added later",
  );
});

// ─── Every import door still reaches the books ────────────────────────────────────────
//
// The doors are: the camera/upload intake, the UBL e-invoice intake, the manual file upload, and
// the two mailbox syncs. They share nothing but the shape of what they must produce, so a change in
// one is exactly the kind that silently skips another — and an invoice that never becomes a row
// makes no noise at all.

test("[IMPORT-COMPLETE] every door still writes an invoice row, and still holds its guards", () => {
  const doors: Array<[string, string[]]> = [
    // [file, phrases that must survive]
    ["src/app/api/intake/route.ts", ['from("invoices")', "shouldAutoAdvanceInvoice", "markDuplicateCheckUnavailable"]],
    ["src/app/api/email/upload/route.ts", ['from("invoices")', "markDuplicateCheckUnavailable"]],
    ["src/lib/email-integration.ts", ["from('invoices')", "markDuplicateCheckUnavailable"]],
  ];
  for (const [f, phrases] of doors) {
    const src = code(f);
    for (const p of phrases) {
      assert.ok(
        src.includes(p),
        `${f} no longer contains \`${p}\` — an import door that stopped writing, or stopped ` +
          `checking, is invisible: the owner simply never sees the invoice again`,
      );
    }
  }
});

test("[IMPORT-COMPLETE] the byte-hash gate is still the first thing every file meets", () => {
  // The gate that makes re-uploading the same file harmless. If it moves after the AI read, a
  // re-upload costs a paid extraction; if it disappears, the same bytes become a second cost.
  for (const f of ["src/app/api/intake/route.ts", "src/app/api/email/upload/route.ts"]) {
    const src = code(f);
    assert.match(
      src, /content_hash|contentHash/,
      `${f} no longer consults the byte hash — the same file re-uploaded becomes a second invoice`,
    );
  }
});
