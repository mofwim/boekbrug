// [BEVEILIGING] Run: npx tsx --test src/lib/security-overview.test.ts
//
// This screen answers "who can read my books". Every test below names what a wrong answer would
// tell the owner, because on this one screen the difference between a degraded answer and a false
// one is the difference between "we could not check" and "nobody else, you are safe".

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSecurityOverview,
  profileName,
  sharedWithOthers,
  type MemberRow,
  type ReadState,
} from "./security-overview";

const ok = <T,>(value: T): ReadState<T> => ({ state: "ok", value });
const failed = <T,>(): ReadState<T> => ({ state: "unreadable" });

const base = {
  ownerEmail: "kiwi@example.nl",
  ownerName: "Kiwi Diensten",
  bookkeepers: ok<Array<{ link: { id?: string | null; created_at?: string | null }; profile: null }>>([]),
  members: ok<MemberRow[]>([]),
};

// ─── The rule the whole screen rests on ──────────────────────────────────────────────

test("[BEVEILIGING] a failed read never becomes a smaller number of people", () => {
  // The one that matters. If the bookkeeper link cannot be read and this still answers "1", the
  // screen tells an owner that nobody else can see his administration — on the screen he opened to
  // check exactly that. A wrong "2" would be a bug; a wrong "1" is a false reassurance.
  const partial = buildSecurityOverview({ ...base, bookkeepers: failed() });
  assert.equal(partial.count, null, "a count was produced from an incomplete read");
  assert.equal(partial.complete, false);

  const alsoPartial = buildSecurityOverview({ ...base, members: failed() });
  assert.equal(alsoPartial.count, null);

  // And when everything answered, the number is said plainly.
  assert.equal(buildSecurityOverview(base).count, 1);
  assert.equal(buildSecurityOverview(base).complete, true);
});

test("[BEVEILIGING] 'only you' is never said on a read that did not finish", () => {
  // The sentence version of the same failure, and the one an owner actually reads.
  assert.equal(sharedWithOthers(buildSecurityOverview(base)), false);
  assert.equal(sharedWithOthers(buildSecurityOverview({ ...base, members: failed() })), null);
  assert.equal(sharedWithOthers(buildSecurityOverview({ ...base, bookkeepers: failed() })), null);
});

test("[BEVEILIGING] once someone else is on the list, a failed read cannot unsay it", () => {
  // The other direction, and it is not symmetric: a source we could not read might ADD a person, so
  // it can never turn a shared administration back into a private one. Answering null here would
  // hide a fact we are certain of behind a failure that has nothing to do with it.
  const overview = buildSecurityOverview({
    ...base,
    bookkeepers: failed(),
    members: ok([{ id: "m1", naam: "Sam", sinds: "2026-03-01", ingetrokken: null }]),
  });
  assert.equal(sharedWithOthers(overview), true);
  // Still no count: how MANY remains unknown even when THAT is settled.
  assert.equal(overview.count, null);
});

// ─── Who is on the list ──────────────────────────────────────────────────────────────

test("[BEVEILIGING] the owner is always first and can never be removed", () => {
  // A list of who can see your books that does not start with you has lost the plot — and a revoke
  // button on your own row is a button that locks you out of your own administration.
  const overview = buildSecurityOverview({
    ...base,
    members: ok([{ id: "m1", naam: "Sam", sinds: "2026-03-01", ingetrokken: null }]),
  });
  assert.equal(overview.holders[0].kind, "owner");
  assert.equal(overview.holders[0].revokeId, null);
  assert.equal(overview.holders[0].email, "kiwi@example.nl");
});

test("[BEVEILIGING] a revoked member is not shown as still holding a key", () => {
  // The screen's single worst sentence would be an ex-employee listed under "wie kan hierbij".
  const overview = buildSecurityOverview({
    ...base,
    members: ok([
      { id: "m1", naam: "Sam", sinds: "2026-03-01", ingetrokken: "2026-06-01" },
      { id: "m2", naam: "Noor", sinds: "2026-04-01", ingetrokken: null },
    ]),
  });
  assert.deepEqual(overview.holders.map((h) => h.name), ["Kiwi Diensten", "Noor"]);
  assert.equal(overview.count, 2);
});

test("[BEVEILIGING] the revoke button points at the LINK, not at the person", () => {
  // Ending a bookkeeper's access removes one row from accountant_clients. Handing the button the
  // accountant's own id would aim it at the wrong record entirely.
  const overview = buildSecurityOverview({
    ...base,
    bookkeepers: ok([{
      link: { id: "link-9", accountant_id: "person-1", created_at: "2026-01-15" },
      profile: { id: "person-1", company_name: "Boekhouder BV", email: "bh@example.nl" },
    }]),
  });
  const bookkeeper = overview.holders.find((h) => h.kind === "bookkeeper");
  assert.equal(bookkeeper?.revokeId, "link-9");
  assert.equal(bookkeeper?.name, "Boekhouder BV");
  assert.equal(bookkeeper?.since, "2026-01-15");
});

test("[BEVEILIGING] a name we could not read stays null instead of becoming a person called Onbekend", () => {
  // Two different facts, and only the screen knows how to say the second one in the owner's
  // language. A fallback word here would also be a Dutch sentence baked into a pure module.
  const overview = buildSecurityOverview({
    ...base,
    bookkeepers: ok([{ link: { id: "l1", created_at: "2026-01-15" }, profile: null }]),
    members: ok([{ id: "m1", naam: "   ", sinds: "2026-04-01", ingetrokken: null }]),
  });
  assert.equal(overview.holders[1].name, null);
  assert.equal(overview.holders[2].name, null);
  // But they ARE counted: we know someone is there, we just cannot name them.
  assert.equal(overview.count, 3);
});

test("[BEVEILIGING] the business name wins over the person's, and blank is not a name", () => {
  assert.equal(profileName({ company_name: "Kiwi BV", full_name: "K. Iwi" }), "Kiwi BV");
  assert.equal(profileName({ full_name: "K. Iwi" }), "K. Iwi");
  assert.equal(profileName({ company_name: "  ", full_name: "" }), null);
  assert.equal(profileName(null), null);
  assert.equal(profileName(undefined), null);
});

test("[BEVEILIGING] a row with no id gets no revoke button rather than a broken one", () => {
  // A button that cannot work is worse than no button: it teaches the owner that ending access
  // does not work here, on the screen where that is the only thing he can actually do.
  const overview = buildSecurityOverview({
    ...base,
    members: ok([{ naam: "Sam", sinds: "2026-03-01", ingetrokken: null }]),
  });
  assert.equal(overview.holders[1].revokeId, null);
});
