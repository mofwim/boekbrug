// [INTAKE-VOORTGANG] Pure node test — run: npx tsx --test src/lib/upload-xhr.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { postFormWithProgress, parseHeaders, type XhrLike } from "./upload-xhr";

type Listener = (e: { lengthComputable: boolean; loaded: number; total: number }) => void;

/** A fake XHR that records what was asked of it and lets the test fire its events. */
function fakeXhr(reply: { status: number; statusText?: string; body?: string; headers?: string }) {
  const listeners: Record<string, Array<() => void>> = {};
  const uploadListeners: Record<string, Listener[]> = {};
  const calls: { open?: [string, string]; sent?: unknown } = {};
  const xhr: XhrLike & { fire(type: string): void; fireUpload(type: string, e?: { lengthComputable: boolean; loaded: number; total: number }): void } = {
    open: (m, u) => { calls.open = [m, u]; },
    send: (b) => { calls.sent = b; },
    addEventListener: (t, l) => { (listeners[t] ??= []).push(l); },
    upload: { addEventListener: (t, l) => { (uploadListeners[t] ??= []).push(l); } },
    responseType: "",
    status: reply.status,
    statusText: reply.statusText ?? "",
    responseText: reply.body ?? "",
    getAllResponseHeaders: () => reply.headers ?? "",
    fire: (t) => { for (const l of listeners[t] ?? []) l(); },
    fireUpload: (t, e) => { for (const l of uploadListeners[t] ?? []) l(e ?? { lengthComputable: false, loaded: 0, total: 0 }); },
  };
  return { xhr, calls };
}

test("[INTAKE-VOORTGANG] the reply comes back as a Response fetch would have given", async () => {
  const { xhr, calls } = fakeXhr({ status: 409, statusText: "Conflict", body: '{"duplicate":true}', headers: "content-type: application/json\r\nx-a: 1\r\n" });
  const fd = new FormData();
  const p = postFormWithProgress("/api/intake", fd, {}, () => xhr);
  xhr.fire("load");
  const res = await p;
  assert.equal(res.status, 409);
  assert.equal(res.statusText, "Conflict");
  assert.deepEqual(await res.json(), { duplicate: true });
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.deepEqual(calls.open, ["POST", "/api/intake"]);
  assert.equal(calls.sent, fd, "the very FormData handed in is what goes up");
  assert.equal(xhr.responseType, "text");
});

test("[INTAKE-VOORTGANG] progress is forwarded only when the browser knows the total, and 'uploaded' once", async () => {
  const { xhr } = fakeXhr({ status: 200, body: "{}" });
  const seen: Array<[number, number]> = [];
  let uploaded = 0;
  const p = postFormWithProgress("/api/intake", new FormData(), { onProgress: (s, t) => seen.push([s, t]), onUploaded: () => { uploaded += 1; } }, () => xhr);
  xhr.fireUpload("progress", { lengthComputable: true, loaded: 10, total: 100 });
  xhr.fireUpload("progress", { lengthComputable: false, loaded: 50, total: 0 });
  xhr.fireUpload("progress", { lengthComputable: true, loaded: 100, total: 100 });
  xhr.fireUpload("load");
  xhr.fire("load");
  await p;
  assert.deepEqual(seen, [[10, 100], [100, 100]], "a progress event without a total is not a percentage");
  assert.equal(uploaded, 1);
});

test("[INTAKE-VOORTGANG] a failed connection rejects the way fetch does, so the caller's catch still means what it meant", async () => {
  const { xhr } = fakeXhr({ status: 0 });
  const p = postFormWithProgress("/api/intake", new FormData(), {}, () => xhr);
  xhr.fire("error");
  await assert.rejects(p, (e: unknown) => e instanceof TypeError);
  // …and a load with status 0 is the same failure, not a Response with an impossible status.
  const second = fakeXhr({ status: 0 });
  const q = postFormWithProgress("/api/intake", new FormData(), {}, () => second.xhr);
  second.xhr.fire("load");
  await assert.rejects(q, (e: unknown) => e instanceof TypeError);
});

test("[INTAKE-VOORTGANG] a 204 comes back without a body — the Response constructor refuses one", async () => {
  const { xhr } = fakeXhr({ status: 204, body: "ignored" });
  const p = postFormWithProgress("/api/intake", new FormData(), {}, () => xhr);
  xhr.fire("load");
  const res = await p;
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
});

test("[INTAKE-VOORTGANG] raw header text becomes Headers, and a line without a colon is skipped", () => {
  const h = parseHeaders("content-type: text/plain\r\nbroken line\r\nx-two:  2 \r\n");
  assert.equal(h.get("content-type"), "text/plain");
  assert.equal(h.get("x-two"), "2");
});
