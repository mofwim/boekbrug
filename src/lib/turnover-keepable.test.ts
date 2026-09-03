// Run: npx tsx --test src/lib/turnover-keepable.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { couldBeBookableFile, judgeKeepable } from "./turnover-keepable";

const empty = new Uint8Array([1, 2, 3]);

function readers(over: Partial<Parameters<typeof judgeKeepable>[2]> = {}) {
  return {
    planSheet: () => ({ kind: "unknown" }),
    readPdfText: async () => null,
    looksLikeDailySales: () => false,
    ...over,
  };
}

test("[ARCHIEF-OPEN] only formats a reader can open are considered at all", () => {
  for (const ok of ["z.pdf", "KASSA.XLSX", "boek.xls", "dag.csv"]) {
    assert.equal(couldBeBookableFile(ok), true, `${ok} should be considered`);
  }
  for (const no of ["logo.png", "brief.docx", "data.json", "", "geenextensie"]) {
    assert.equal(couldBeBookableFile(no), false, `${no} must not be kept`);
  }
});

test("[ARCHIEF-OPEN] a recognised turnover sheet is kept as dagomzet", async () => {
  const v = await judgeKeepable("kassa.xlsx", empty, readers({ planSheet: () => ({ kind: "turnover" }) }));
  assert.equal(v.keep, true);
  assert.equal(v.kind, "dagomzet");
  assert.ok(v.reason.length > 0, "a kept file must carry a reason the owner can read");
});

test("[ARCHIEF-OPEN] a recognised ledger sheet is kept as grootboek", async () => {
  const v = await judgeKeepable("grootboek.csv", empty, readers({ planSheet: () => ({ kind: "ledger" }) }));
  assert.equal(v.keep, true);
  assert.equal(v.kind, "grootboek");
});

test("[ARCHIEF-OPEN] a sheet the reader does not recognise is dropped, not shelved", async () => {
  const v = await judgeKeepable("adressen.xlsx", empty, readers());
  assert.deepEqual(v, { keep: false, kind: null, reason: "" });
});

test("[ARCHIEF-OPEN] a PDF is judged on its text layer, never on its name", async () => {
  // The production file is called "Jouw dagafsluiting - 020926 2312.zip". Its NAME is the one thing
  // this module refuses to read: keep on the name and the next till brand is dropped in silence.
  const named = await judgeKeepable("Jouw dagafsluiting 020926.pdf", empty, readers());
  assert.equal(named.keep, false, "the filename alone must never keep a file");

  const read = await judgeKeepable("willekeurige-naam.pdf", empty, readers({
    readPdfText: async () => "OMZET VAN 02-09-2026 ...",
    looksLikeDailySales: (t) => (t ?? "").includes("OMZET VAN"),
  }));
  assert.equal(read.keep, true, "the report's own text is what decides");
  assert.equal(read.kind, "dagomzet");
});

test("[ARCHIEF-OPEN] an unreadable file falls through to the unchanged path instead of throwing", async () => {
  // This runs inside the e-mail sync's PHASE 2. A throw here would abort the batch and, worse,
  // leave the watermark where it was — the same freeze this task's own bug had.
  const sheet = await judgeKeepable("kapot.xlsx", empty, readers({
    planSheet: () => { throw new Error("not a zip"); },
  }));
  assert.equal(sheet.keep, false);
  const pdf = await judgeKeepable("kapot.pdf", empty, readers({
    readPdfText: async () => { throw new Error("no text layer"); },
  }));
  assert.equal(pdf.keep, false);
});

test("[ARCHIEF-OPEN] a scan with no text layer is dropped, never guessed at", async () => {
  const v = await judgeKeepable("foto.pdf", empty, readers({
    readPdfText: async () => "",
    looksLikeDailySales: (t) => (t ?? "").includes("OMZET VAN"),
  }));
  assert.equal(v.keep, false);
});
