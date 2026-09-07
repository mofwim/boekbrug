// [BIJLAGE-BIJ-REGEL] Run: npx tsx --test src/lib/bank-attachments.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentsByTransaction, attachmentTypeAllowed, ATTACHMENT_MAX_BYTES } from "./bank-attachments";

test("[BIJLAGE-BIJ-REGEL] the file types the owner may attach: pdf, photo, text — by mime or by name, never a spreadsheet", () => {
  assert.equal(attachmentTypeAllowed("application/pdf", "x.bin"), true);
  assert.equal(attachmentTypeAllowed("image/heic", "IMG_1.HEIC"), true);
  assert.equal(attachmentTypeAllowed("application/octet-stream", "bon.JPG"), true, "a phone that sends no mime is judged by the name");
  assert.equal(attachmentTypeAllowed("application/vnd.ms-excel", "kas.xls"), false);
  assert.equal(attachmentTypeAllowed("", "script.exe"), false);
  assert.equal(ATTACHMENT_MAX_BYTES, 15 * 1024 * 1024);
});

function fakeClient(rows: unknown[] | Error) {
  const q = {
    select: () => q, eq: () => q, in: () => q, order: () => q,
    range: async () => rows instanceof Error ? { data: null, error: { message: rows.message } } : { data: rows, error: null },
  };
  return { from: () => q };
}

test("[BIJLAGE-BIJ-REGEL] attachments are grouped per line, oldest first; a missing table is 'none', never a throw", async () => {
  const rows = [
    { id: "b", transaction_id: "t1", document_id: "d2", created_at: "2026-09-02T00:00:00Z", documents: { file_name: "two.pdf", file_type: "application/pdf" } },
    { id: "a", transaction_id: "t1", document_id: "d1", created_at: "2026-09-01T00:00:00Z", documents: { file_name: "one.jpg", file_type: "image/jpeg" } },
    { id: "c", transaction_id: "t2", document_id: "d3", created_at: "2026-09-03T00:00:00Z", documents: null },
  ];
  const m = await attachmentsByTransaction(fakeClient(rows), "u", ["t1", "t2", "t3"]);
  assert.deepEqual(m.get("t1")?.map((a) => a.fileName), ["one.jpg", "two.pdf"]);
  assert.equal(m.get("t2")?.[0].fileName, "bestand", "a document row that could not be joined still names the attachment");
  assert.equal(m.get("t3"), undefined);
  const missing = await attachmentsByTransaction(fakeClient(new Error('relation "public.bank_tx_attachments" does not exist')), "u", ["t1"]);
  assert.equal(missing.size, 0);
  const empty = await attachmentsByTransaction(fakeClient([]), "u", []);
  assert.equal(empty.size, 0);
});
