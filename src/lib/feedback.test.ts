// [FEEDBACK] Run: npx tsx --test src/lib/feedback.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFeedback,
  normalizeFeedbackPath,
  feedbackImageExtension,
  FEEDBACK_MAX_CHARS,
  FEEDBACK_MAX_IMAGE_BYTES,
} from "./feedback";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PDF = Buffer.from("%PDF-1.7\nrest");

test("a plain message is accepted", () => {
  const r = parseFeedback({ message: "  De knop doet niets  ", path: "/dashboard/bank" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.message, "De knop doet niets", "trimmed");
  assert.equal(r.value.path, "/dashboard/bank");
  assert.equal(r.value.image, null);
});

test("an empty or near-empty message is refused in its own words", () => {
  for (const message of ["", "   ", "ok"]) {
    const r = parseFeedback({ message });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /kort wat er misging/, "the refusal says what to do, not just 'ongeldig'");
  }
});

test("an overlong message is refused with the limit named", () => {
  const r = parseFeedback({ message: "a".repeat(FEEDBACK_MAX_CHARS + 1) });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, new RegExp(String(FEEDBACK_MAX_CHARS)));
});

test("the path keeps the screen and drops the query string", () => {
  // Ids and focus targets live in the query string. A report about a screen does not need to carry
  // them into a table a human reads later.
  assert.equal(normalizeFeedbackPath("/dashboard/incoming?focus=abc-123#top"), "/dashboard/incoming");
  assert.equal(normalizeFeedbackPath("/dashboard/bank"), "/dashboard/bank");
});

test("anything that is not one of our own paths becomes null", () => {
  // Never an absolute URL: this field says which of OUR screens it was, and storing a link out
  // would make it a place someone could put one.
  assert.equal(normalizeFeedbackPath("https://evil.example/x"), null);
  assert.equal(normalizeFeedbackPath("dashboard/bank"), null);
  assert.equal(normalizeFeedbackPath(""), null);
  assert.equal(normalizeFeedbackPath(undefined), null);
  assert.equal(normalizeFeedbackPath(42), null);
});

test("a long path is bounded", () => {
  assert.equal(normalizeFeedbackPath("/" + "a".repeat(500))?.length, 200);
});

test("an image is accepted and typed from its BYTES", () => {
  const r = parseFeedback({ message: "zie plaatje", image: PNG.toString("base64") });
  assert.equal(r.ok, true);
  if (!r.ok || !r.value.image) return assert.fail("expected an image");
  assert.equal(r.value.image.mimeType, "image/png");
  assert.equal(r.value.image.bytes.length, PNG.length);
});

test("a data: URL is accepted — a browser FileReader produces one", () => {
  const r = parseFeedback({ message: "zie plaatje", image: `data:image/jpeg;base64,${JPEG.toString("base64")}` });
  assert.equal(r.ok, true);
  if (!r.ok || !r.value.image) return assert.fail("expected an image");
  assert.equal(r.value.image.mimeType, "image/jpeg");
});

test("a lying content type does not decide the answer", () => {
  // The declared type is a claim. This file lands in the bucket the owner's own documents live in,
  // so accepting the claim is how something that is not an image gets stored there under a
  // trustworthy name.
  const r = parseFeedback({ message: "hier", image: `data:image/png;base64,${PDF.toString("base64")}` });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /png, jpg, webp of gif/, "and the refusal names what IS accepted");
});

test("an oversized image is refused on the DECODED size", () => {
  // base64 is ~33% larger, so a limit on the string would be a different — and wrong — number.
  const big = Buffer.concat([PNG, Buffer.alloc(FEEDBACK_MAX_IMAGE_BYTES)]);
  const r = parseFeedback({ message: "groot", image: big.toString("base64") });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /te groot/);
});

test("an image just under the cap still passes", () => {
  const ok = Buffer.concat([PNG, Buffer.alloc(FEEDBACK_MAX_IMAGE_BYTES - PNG.length - 1)]);
  assert.equal(parseFeedback({ message: "net goed", image: ok.toString("base64") }).ok, true);
});

test("no image at all is a normal report, not a failure", () => {
  for (const image of [null, undefined, ""]) {
    const r = parseFeedback({ message: "alleen tekst", image });
    assert.equal(r.ok, true, `image=${String(image)} must be fine`);
  }
});

test("the stored name matches what the bytes really are", () => {
  assert.equal(feedbackImageExtension("image/png"), "png");
  assert.equal(feedbackImageExtension("image/webp"), "webp");
  assert.equal(feedbackImageExtension("image/gif"), "gif");
  assert.equal(feedbackImageExtension("image/jpeg"), "jpg");
});

test("a non-object body is refused", () => {
  assert.equal(parseFeedback(null).ok, false);
  assert.equal(parseFeedback("bericht").ok, false);
});
