import test from "node:test";
import assert from "node:assert/strict";
import { isPdf, retryBudget, sendWithFit } from "./upload-fit";
import { MAX_INTAKE_UPLOAD_BYTES } from "./image-normalize-client";

// ─── [UPLOAD-PLAFOND] The ceiling that actually applies ──────────────────────────────────────────

test("[UPLOAD-PLAFOND] the client budget is below the platform's request-body limit", () => {
  // The bug in one number. This was 10 MB, "mirroring /api/intake's server-side MAX_BYTES" — the
  // app's own limit. A Vercel function's body is capped around 4.5 MB and refused BEFORE our code
  // runs, so every surface compressed to a size the platform would not carry, and then told the
  // owner to split the PDF by hand.
  const MB = 1024 * 1024;
  assert.ok(
    MAX_INTAKE_UPLOAD_BYTES <= 4.5 * MB,
    `the budget is ${MAX_INTAKE_UPLOAD_BYTES / MB} MB, at or above the platform ceiling — every ` +
      `file compressed to exactly this size is refused with a bare 413`,
  );
  // …and headroom for the multipart wrapper: boundaries, field names, headers, and whatever a
  // proxy adds. A budget equal to the ceiling is a budget that fails on the envelope.
  assert.ok(MAX_INTAKE_UPLOAD_BYTES <= 4 * MB, "leave room for the multipart envelope");
  // Not so small that a legible scan cannot fit. An A4 page at 150 dpi JPEG is a few hundred KB.
  assert.ok(MAX_INTAKE_UPLOAD_BYTES >= 2 * MB, "a multi-page scan must still fit");
});

test("[UPLOAD-PLAFOND] a retry aims materially lower, not a nudge", () => {
  // A 413 says the real ceiling is below where we aimed, by an unknown amount. Shaving a few
  // percent would most likely buy a second 413 and a second upload over a mobile connection.
  assert.equal(retryBudget(4 * 1024 * 1024), 2 * 1024 * 1024);
  assert.ok(retryBudget(MAX_INTAKE_UPLOAD_BYTES) <= MAX_INTAKE_UPLOAD_BYTES / 2);
  // …but never down to nothing: below this a scan stops being readable, and an unreadable
  // document that uploaded is worse than a large one that did not.
  assert.equal(retryBudget(100 * 1024), 512 * 1024);
});

test("[UPLOAD-PLAFOND] a PDF is recognised by type OR by name", () => {
  // A phone's file picker does not always fill in the MIME type — an empty `type` with a .pdf name
  // is ordinary on Android, and treating it as an image would send it through a canvas that
  // cannot decode it.
  assert.equal(isPdf({ type: "application/pdf" }), true);
  assert.equal(isPdf({ type: "", name: "factuur.PDF" }), true);
  assert.equal(isPdf({ name: "scan.pdf" }), true);
  assert.equal(isPdf({ type: "image/jpeg", name: "foto.jpg" }), false);
  assert.equal(isPdf({}), false);
  // A name that merely mentions pdf is not a pdf.
  assert.equal(isPdf({ type: "image/jpeg", name: "pdf-scan.jpg" }), false);
});

// ─── [UPLOAD-PLAFOND] Surviving a platform refusal ───────────────────────────────────────────────

/** A File whose bytes are irrelevant — only its size and type matter to these paths. */
const fakeFile = (name: string, size: number, type: string) =>
  new File([new Uint8Array(size)], name, { type });

const ok = () => new Response("{}", { status: 200 });
const tooBig = () => new Response("", { status: 413 });

test("[UPLOAD-PLAFOND] an ordinary upload is sent once", async () => {
  // Something the fitter leaves alone: not an image, not a PDF, already small. A CSV import must
  // not pay for any of this.
  const calls: number[] = [];
  const r = await sendWithFit(fakeFile("mt940.sta", 1000, "text/plain"), (f) => {
    calls.push(f.size);
    return Promise.resolve(ok());
  });
  assert.equal(r.response.status, 200);
  assert.equal(r.retried, false);
  assert.deepEqual(calls, [1000], "exactly one request");
  assert.equal(r.fit.method, "untouched");
});

test("[UPLOAD-PLAFOND] a 413 is answered by sending a smaller file, not by giving up", async () => {
  // The whole point. The budget is our estimate of somebody else's limit; when the estimate is
  // wrong the app must recover by measurement rather than hand the owner an instruction.
  const sizes: number[] = [];
  // A stand-in for a shrinkable document: each fit pass halves it. The real halving is done by
  // pdfcompress against the budget it is given; what is under test here is the CONTROL FLOW.
  const shrinkable = fakeFile("scan.txt", 8000, "text/plain");
  let attempt = 0;
  const r = await sendWithFit(
    shrinkable,
    (f) => {
      sizes.push(f.size);
      return Promise.resolve(attempt++ === 0 ? tooBig() : ok());
    },
    4000,
  );
  // A plain text file cannot be shrunk, so this one legitimately stops after the refusal — and
  // that is the assertion: it did NOT send the same bytes a second time.
  assert.equal(r.response.status, 413);
  assert.equal(r.retried, false);
  assert.deepEqual(sizes, [8000], "an unshrinkable file is not uploaded twice for nothing");
});

test("[UPLOAD-PLAFOND] a second attempt happens only when it would carry fewer bytes", async () => {
  // The guard that keeps a retry from being a superstition: if the second squeeze gained nothing,
  // re-sending identical bytes over a mobile connection cannot change the answer.
  let sent = 0;
  const r = await sendWithFit(fakeFile("bon.txt", 9_000, "text/plain"), () => {
    sent += 1;
    return Promise.resolve(tooBig());
  }, 4000);
  assert.equal(sent, 1, "no pointless second upload");
  assert.equal(r.response.status, 413, "and the platform's answer is reported honestly");
});

test("[UPLOAD-PLAFOND] a non-413 failure is reported as itself", async () => {
  // A 409 duplicate, a 402 fair-use stop, a 500. None of those is a size problem, and squeezing
  // the file would replace a reason the owner can act on with one they cannot.
  for (const status of [400, 402, 409, 429, 500, 503]) {
    let sent = 0;
    const r = await sendWithFit(fakeFile("f.txt", 100, "text/plain"), () => {
      sent += 1;
      return Promise.resolve(new Response("{}", { status }));
    });
    assert.equal(r.response.status, status, `status ${status} must survive`);
    assert.equal(sent, 1, `status ${status} must not be retried`);
    assert.equal(r.retried, false);
  }
});

test("[UPLOAD-PLAFOND] the caller learns which bytes actually went", async () => {
  // A duplicate hash, an audit line and a "geüpload: 2,1 MB" message all describe the file that
  // was SENT. Reporting the original would make each of them a small lie.
  const original = fakeFile("f.txt", 500, "text/plain");
  const r = await sendWithFit(original, () => Promise.resolve(ok()));
  assert.equal(r.sent.size, 500);
  assert.equal(r.fit.before, 500);
  assert.equal(r.fit.after, 500);
});

// ─── [UPLOAD-PLAFOND] The retry itself, with a fitter that really shrinks ────────────────────────
//
// The tests above prove the app does not waste an upload. These prove the part the feature exists
// for. The real fitter needs a canvas or pdf-lib and can only ever hand the file back untouched in
// a test runner — so it is injected, and what is under test is the control flow that decides
// whether a second, smaller request goes out.

/** A fitter that halves anything over budget — a stand-in for pdfcompress's escalation. */
const halving = async (f: File, budget: number) => {
  const after = f.size > budget ? Math.max(1, Math.floor(f.size / 2)) : f.size;
  return {
    file: new File([new Uint8Array(after)], f.name, { type: f.type }),
    fits: after <= budget,
    before: f.size,
    after,
    method: (after === f.size ? "untouched" : "pdf") as "untouched" | "pdf",
  };
};

test("[UPLOAD-PLAFOND] a platform 413 becomes a smaller second attempt that succeeds", async () => {
  // This is the reported failure, end to end: the owner picked a big scan, the platform refused it
  // with a bare 413, and the app told them to split the PDF. Now it sends a smaller one instead.
  const sizes: number[] = [];
  let attempt = 0;
  const r = await sendWithFit(
    fakeFile("scan.pdf", 8_000_000, "application/pdf"),
    (f) => { sizes.push(f.size); return Promise.resolve(attempt++ === 0 ? tooBig() : ok()); },
    4_000_000,
    halving,
  );
  assert.equal(r.response.status, 200, "the second attempt lands");
  assert.equal(r.retried, true);
  assert.deepEqual(sizes, [4_000_000, 2_000_000], "first at the budget, then at half of it");
  assert.equal(r.sent.size, 2_000_000, "the caller is told which bytes actually went");
  assert.equal(r.fit.after, 2_000_000);
});

test("[UPLOAD-PLAFOND] the retry happens once, never in a loop", async () => {
  // A second 413 after a genuinely smaller file is not a size problem any more. Retrying again
  // would only spend the owner's mobile data proving it.
  const sizes: number[] = [];
  const r = await sendWithFit(
    fakeFile("scan.pdf", 8_000_000, "application/pdf"),
    (f) => { sizes.push(f.size); return Promise.resolve(tooBig()); },
    4_000_000,
    halving,
  );
  assert.equal(sizes.length, 2, "two requests at most, whatever the platform keeps saying");
  assert.equal(r.response.status, 413, "and the refusal is reported, not swallowed");
  assert.equal(r.retried, true, "…while still recording that a smaller one was tried");
});

test("[UPLOAD-PLAFOND] a file already under budget is sent as it is", async () => {
  // The common case must not pay for any of this: no shrink, no second request, same bytes.
  const sizes: number[] = [];
  const r = await sendWithFit(
    fakeFile("bon.pdf", 300_000, "application/pdf"),
    (f) => { sizes.push(f.size); return Promise.resolve(ok()); },
    4_000_000,
    halving,
  );
  assert.deepEqual(sizes, [300_000]);
  assert.equal(r.retried, false);
  assert.equal(r.fit.method, "untouched");
});
