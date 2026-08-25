// [BEHEER] Pure node test — run: npx tsx --test src/lib/beheer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { isBeheerder, buildBeheerOverview } from "./beheer";

test("[BEHEER] the gate is closed by default and opens only for the named addresses", () => {
  const prev = process.env.BEHEER_EMAILS;
  try {
    delete process.env.BEHEER_EMAILS;
    assert.equal(isBeheerder("mofwim@gmail.com"), false, "unset env = the page exists for nobody");

    process.env.BEHEER_EMAILS = "Mofwim@Gmail.com, tweede@voorbeeld.nl";
    assert.equal(isBeheerder("mofwim@gmail.com"), true, "case-insensitive match");
    assert.equal(isBeheerder("  MOFWIM@GMAIL.COM  "), true, "…and whitespace-tolerant");
    assert.equal(isBeheerder("ander@voorbeeld.nl"), false);
    assert.equal(isBeheerder(null), false);
    assert.equal(isBeheerder(""), false);

    // An empty entry in the list must never match an empty email.
    process.env.BEHEER_EMAILS = " , ,";
    assert.equal(isBeheerder(""), false, "empty entries are filtered, not matchable");
  } finally {
    if (prev === undefined) delete process.env.BEHEER_EMAILS;
    else process.env.BEHEER_EMAILS = prev;
  }
});

test("[BEHEER] the overview counts what it shows and names what it can", () => {
  const profiles = [
    { id: "a", company_name: "Kiwi Food Market", full_name: null, email: "kiwi@x.nl", role: null, created_at: "2026-01-05T10:00:00Z", subscription_status: "active", current_period_end: null },
    { id: "b", company_name: null, full_name: "B. Boekhouder", email: "b@k.nl", role: "accountant", created_at: "2026-03-01T10:00:00Z" },
    { id: "c", company_name: null, full_name: null, email: null, role: null, created_at: null },
  ];
  const links = [
    { accountant_id: "b", zzper_id: "a", created_at: "2026-04-01T09:00:00Z" },
    { accountant_id: "b", zzper_id: "weg", created_at: null },
  ];
  const o = buildBeheerOverview(profiles, links, (p) => (p.role === "accountant" ? "boekhouder" : p.subscriptionStatus === "active" ? "plus" : "free"));

  assert.equal(o.counts.total, 3);
  assert.equal(o.counts.accountants, 1);
  assert.equal(o.counts.owners, 2);
  assert.equal(o.counts.links, 2);

  // Newest first; a null date sorts last, never invents a date.
  assert.equal(o.users[0].name, "B. Boekhouder");
  assert.equal(o.users[2].name, "(zonder naam)");
  assert.equal(o.users[2].createdAt, null);

  // The plan label is the OUTCOME.
  assert.equal(o.users.find((u) => u.id === "a")?.plan, "plus");
  assert.equal(o.users.find((u) => u.id === "b")?.plan, "boekhouder");

  // A link to a vanished profile says so instead of crashing or hiding the row.
  assert.equal(o.links[1].clientName, "(onbekend)");
  assert.equal(o.links[0].accountantName, "B. Boekhouder");
  assert.equal(o.links[0].since, "2026-04-01");
});
