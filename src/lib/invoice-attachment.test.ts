// [FACTUUR-BIJLAGE] Run: npx tsx --test src/lib/invoice-attachment.test.ts
//
// The rule that carries this file is about ORDER, not about files: every refusal here must be
// reachable BEFORE the send route mints a number. Once a number exists there is no good outcome
// left — send without the attachment and the customer gets an incomplete package, or stop and
// leave a permanent gap in the Art. 35 series.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  attachmentRefusal,
  canAttach,
  attachmentRefusalText,
  safeAttachmentName,
  formatMegabytes,
  MAX_ATTACHMENT_BYTES,
} from "./invoice-attachment";

const OWNER = "owner-uuid";
const doc = (over: Record<string, unknown> = {}) => ({
  id: "doc-1",
  user_id: OWNER,
  file_name: "werkbon-augustus.pdf",
  file_url: "owner/bestanden/werkbon.pdf",
  file_size: 240_000,
  file_type: "application/pdf",
  trashed: false,
  ...over,
});

test("[FACTUUR-BIJLAGE] an ordinary file of the owner's goes along", () => {
  assert.equal(attachmentRefusal(doc(), OWNER), null);
  assert.equal(canAttach(doc(), OWNER), true);
});

test("[FACTUUR-BIJLAGE] someone else's file never goes to a third party", () => {
  // The owner here is the OWNER of the invoice, not whoever is logged in: a sales member sending
  // on their employer's behalf attaches a file of that company, never one of their own.
  assert.equal(attachmentRefusal(doc({ user_id: "iemand-anders" }), OWNER), "not_owned");
  assert.equal(attachmentRefusal(doc({ user_id: null }), OWNER), "not_owned");
});

test("[FACTUUR-BIJLAGE] a file in the bin is refused, though it is still readable", () => {
  // That is exactly why it is checked: trashed rows are still there, so nothing would fail.
  assert.equal(attachmentRefusal(doc({ trashed: true }), OWNER), "trashed");
});

test("[FACTUUR-BIJLAGE] a missing or empty file is refused, never silently skipped", () => {
  assert.equal(attachmentRefusal(null, OWNER), "not_found");
  assert.equal(attachmentRefusal(undefined, OWNER), "not_found");
  assert.equal(attachmentRefusal(doc({ file_url: null }), OWNER), "not_found");
  assert.equal(attachmentRefusal(doc({ file_size: 0 }), OWNER), "empty");
  assert.equal(attachmentRefusal(doc({ file_size: null }), OWNER), "empty");
  assert.equal(attachmentRefusal(doc({ file_size: Number.NaN }), OWNER), "empty");
});

test("[FACTUUR-BIJLAGE] the ceiling is about the customer's mailbox, not our storage", () => {
  // Base64 makes a file a third bigger in transit, and the invoice PDF has to fit beside it. The
  // number is well under the 25 MB most mailboxes refuse.
  assert.ok(MAX_ATTACHMENT_BYTES > 8 * 1024 * 1024, "big enough for a real worksheet or photo set");
  assert.ok(MAX_ATTACHMENT_BYTES < 20 * 1024 * 1024, "…and small enough that the mail still arrives");
  assert.equal(MAX_ATTACHMENT_BYTES % (1024 * 1024), 0, "a whole MB — this number is shown to a human");

  assert.equal(attachmentRefusal(doc({ file_size: MAX_ATTACHMENT_BYTES }), OWNER), null, "exactly at the line fits");
  assert.equal(attachmentRefusal(doc({ file_size: MAX_ATTACHMENT_BYTES + 1 }), OWNER), "too_large");
});

test("[FACTUUR-BIJLAGE] every refusal says what is wrong AND what to do about it", () => {
  for (const reason of ["not_found", "not_owned", "trashed", "too_large", "empty"] as const) {
    const text = attachmentRefusalText(reason);
    assert.ok(text.length > 30, `${reason} needs a real sentence, not a code`);
    assert.match(text, /[.!]$/, `${reason} must read as a sentence`);
  }
  // The size refusal must name the limit — "too big" without a number is not actionable.
  assert.match(attachmentRefusalText("too_large"), /\d+,\d MB/);
});

test("[FACTUUR-BIJLAGE] the file keeps its own name, minus what breaks a mail", () => {
  assert.equal(safeAttachmentName("werkbon-augustus.pdf"), "werkbon-augustus.pdf");
  // A slash lands as a folder in some mail clients; a newline can break a header.
  assert.equal(safeAttachmentName("map/werkbon.pdf"), "map-werkbon.pdf");
  assert.equal(safeAttachmentName('werk"bon\n.pdf'), "werkbon .pdf");
  assert.equal(safeAttachmentName(""), "bijlage");
  assert.equal(safeAttachmentName(null), "bijlage");
  assert.equal(safeAttachmentName("x".repeat(400)).length, 120);
});

test("[FACTUUR-BIJLAGE] megabytes are shown the Dutch way", () => {
  assert.equal(formatMegabytes(1024 * 1024), "1,0 MB");
  assert.equal(formatMegabytes(2.5 * 1024 * 1024), "2,5 MB");
  assert.equal(formatMegabytes(0), "0,0 MB");
  assert.equal(formatMegabytes(-5), "0,0 MB", "a negative size is not a negative file");
});
