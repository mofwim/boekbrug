// src/lib/demo-tenant.test.ts
// [DEMO-DICHT] Where the fence around the published account runs.
// Run: npx tsx --test src/lib/demo-tenant.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_TENANT_ID, isDemoTenant, demoRefusalFor, demoRefusalMessage,
} from "./demo-tenant";

test("[DEMO-DICHT] only the seeded demo id is the demo tenant", () => {
  assert.equal(isDemoTenant(DEMO_TENANT_ID), true);
  // The real owner of this administration must never be fenced.
  assert.equal(isDemoTenant("ac22189e-7052-4c48-b4ec-90947cf92ecc"), false);
  assert.equal(isDemoTenant(null), false);
  assert.equal(isDemoTenant(undefined), false);
  assert.equal(isDemoTenant(""), false);
  // Not a prefix or case match: an id is an id.
  assert.equal(isDemoTenant(DEMO_TENANT_ID.toUpperCase()), false);
  assert.equal(isDemoTenant(DEMO_TENANT_ID + "1"), false);
});

test("[DEMO-DICHT] reading is never refused", () => {
  // The whole point of the tenant is that someone can look around in it. A reviewer who opens the
  // invoice screen and gets a 403 reports a broken app, which is the failure this guard exists to
  // prevent rather than to cause.
  for (const path of ["/api/invoice/send", "/api/intake", "/api/messages", "/api/email/sync"]) {
    assert.equal(demoRefusalFor(path, "GET"), null, `${path} mag gelezen worden`);
    assert.equal(demoRefusalFor(path, "HEAD"), null);
  }
});

test("[DEMO-DICHT] mail that leaves the building is refused", () => {
  for (const path of [
    "/api/invoice/send", "/api/invoice/creditnota", "/api/invite/client",
    "/api/invite/accountant", "/api/messages", "/api/closing-package/share",
    "/api/accountant/vraag-stukken", "/api/account/export", "/api/draft-queue",
    "/api/invoice/8f14e45f-ceea-467a-9c1e-000000000001/reminder",
    "/api/invoice/8f14e45f-ceea-467a-9c1e-000000000001/send-offerte",
  ]) {
    assert.equal(demoRefusalFor(path, "POST"), "outbound_mail", `${path} moet dicht`);
  }
});

test("[DEMO-DICHT] reads that cost money are refused", () => {
  // Every door into the mailbox counts: the derived gate found these after the first hand-written
  // list named four and missed fifteen.
  for (const path of [
    "/api/intake", "/api/ai/draft-email", "/api/email/sync", "/api/email/connect",
    "/api/email/backfill", "/api/email/upload", "/api/email/callback/gmail",
    "/api/email/reimport/8f14e45f-ceea-467a-9c1e-000000000001",
    "/api/bestanden/classify", "/api/tools/scan-invoice", "/api/bank/attach-invoice",
    "/api/eft/import", "/api/invoice/audit",
    "/api/documents/8f14e45f-ceea-467a-9c1e-000000000001/read-as-invoice",
  ]) {
    assert.equal(demoRefusalFor(path, "POST"), "paid_read", `${path} moet dicht`);
  }
});

test("[DEMO-DICHT] a signed webhook is the provider calling, not the demo user", () => {
  // Both verify a signature over the body and fail closed without their secret — proven by the
  // [DEMO-DICHT] gate, not assumed here.
  assert.equal(demoRefusalFor("/api/email/webhook", "POST"), null);
  assert.equal(demoRefusalFor("/api/billing/webhook", "POST"), null);
});

test("[DEMO-DICHT] a prefix never swallows a neighbouring route", () => {
  // /api/invoice/send is fenced; a route whose name merely starts with those letters is not.
  assert.equal(demoRefusalFor("/api/invoice/sendings-report", "POST"), null);
  assert.equal(demoRefusalFor("/api/intake-report", "POST"), null);
  assert.equal(demoRefusalFor("/api/aiaiai", "POST"), null);
  // …while the real children stay fenced.
  assert.equal(demoRefusalFor("/api/invoice/send", "POST"), "outbound_mail");
  assert.equal(demoRefusalFor("/api/ai/draft-email", "POST"), "paid_read");
});

test("[DEMO-DICHT] ordinary local work is untouched", () => {
  // Typing, editing and deleting invented rows reaches nobody and costs nothing. Fencing it would
  // make the demo look broken for no gain.
  for (const path of ["/api/invoice", "/api/uren", "/api/klanten", "/api/settings", "/api/kas"]) {
    assert.equal(demoRefusalFor(path, "POST"), null, `${path} hoort gewoon te werken`);
  }
});

test("[DEMO-DICHT] the refusal says which of the two it is, in words a reader can use", () => {
  const mail = demoRefusalMessage("outbound_mail");
  const read = demoRefusalMessage("paid_read");
  assert.notEqual(mail, read, "twee verschillende weigeringen, twee verschillende zinnen");
  for (const m of [mail, read]) {
    assert.match(m, /demoaccount/, "de lezer moet weten dát dit het demoaccount is");
    // [NO-SILENT-EMPTY], op een foutmelding: zeggen dat iets niet mag zonder te zeggen waarom
    // leest als een kapotte knop.
    assert.match(m, /openbaar/, "en waarom het dicht staat");
  }
});
