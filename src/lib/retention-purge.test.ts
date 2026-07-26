// [A1] Tests for the retention-purge decision.
//   run: npx tsx --test src/lib/retention-purge.test.ts
//
// This decision authorises an IRREVERSIBLE deletion of a company's bookkeeping.
// The two failure modes are not remotely symmetric:
//   · a WRONGLY-KEPT file costs some storage and a paperwork question;
//   · a WRONGLY-DELETED file is gone, and if it was inside the Dutch 7-year
//     bewaarplicht window the owner is now unable to answer the Belastingdienst.
// There is no undo, no backup story that helps, and no apology that fixes it.
//
// So almost every test below is a REFUSAL test. Only one shape of input is
// allowed to come back `purge: true`, and it has to satisfy every condition at
// once. If a future change makes any of these refusals start purging, that is a
// data-loss bug and these tests are the last thing standing in front of it.

import {
  decidePurge,
  partitionPurgeCandidates,
  storagePrefixForUser,
  type DeletionRequestRow,
} from "./retention-purge";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const NOW = new Date("2033-08-01T00:00:00.000Z");
const USER = "11111111-2222-3333-4444-555555555555";

/** A row that SHOULD purge: deactivated in 2026, seven years up. */
function base(overrides: Partial<DeletionRequestRow> = {}): DeletionRequestRow {
  return {
    id: "req-1",
    user_id: USER,
    deleted_at: "2026-07-01T00:00:00.000Z",
    data_eligible_for_deletion_at: "2033-07-01T00:00:00.000Z",
    purged_at: null,
    ...overrides,
  };
}

console.log("\n[A1] the one shape that IS allowed to purge");

check("a fully-expired, deactivated, un-purged row purges", decidePurge(base(), NOW).purge === true);

console.log("\n[A1] refusals — each one prevents an unrecoverable deletion");

check(
  "an account that was never deactivated is NEVER purged",
  // The deletion_requests row is created at EXPORT time, before the user
  // confirms. Someone who exported their data and kept using BoekBrug has a row
  // with no deleted_at — erasing their files would destroy a LIVE business.
  (() => {
    const v = decidePurge(base({ deleted_at: null }), NOW);
    return v.purge === false && v.reason === "not_deactivated";
  })()
);

check(
  "a row already purged is not purged again",
  (() => {
    const v = decidePurge(base({ purged_at: "2033-07-02T00:00:00.000Z" }), NOW);
    return v.purge === false && v.reason === "already_purged";
  })()
);

check(
  "an orphan row with no user_id is refused",
  (() => {
    const v = decidePurge(base({ user_id: null }), NOW);
    return v.purge === false && v.reason === "no_user_id";
  })()
);

check(
  "a missing eligible date is refused — we cannot PROVE seven years passed",
  (() => {
    const v = decidePurge(base({ data_eligible_for_deletion_at: null }), NOW);
    return v.purge === false && v.reason === "no_eligible_date";
  })()
);

check(
  "an unparseable eligible date is refused, never guessed",
  (() => {
    const v = decidePurge(base({ data_eligible_for_deletion_at: "not-a-date" }), NOW);
    return v.purge === false && v.reason === "unparseable_date";
  })()
);

check(
  "an unparseable deleted_at is refused",
  (() => {
    const v = decidePurge(base({ deleted_at: "garbage" }), NOW);
    return v.purge === false && v.reason === "unparseable_date";
  })()
);

console.log("\n[A1] the clock — one day early is still a catastrophe");

check(
  "one day before the eligible date: refused",
  decidePurge(base(), new Date("2033-06-30T23:59:59.000Z")).purge === false
);

check(
  "years early: refused",
  decidePurge(base(), new Date("2027-01-01T00:00:00.000Z")).purge === false
);

check(
  "exactly at the eligible instant: allowed",
  decidePurge(base(), new Date("2033-07-01T00:00:00.000Z")).purge === true
);

console.log("\n[A1] a tampered eligible-date can only ever DELAY, never hasten");

check(
  "a stored date brought forward is overruled by recomputing from deleted_at",
  // Someone (or something) sets the eligible date to yesterday while the account
  // was only deactivated last month. The recomputed +7y still says no, so the
  // answer is no. The two checks must AND, never OR.
  (() => {
    const row = base({
      deleted_at: "2033-06-01T00:00:00.000Z",           // deactivated 2 months ago
      data_eligible_for_deletion_at: "2033-07-01T00:00:00.000Z", // claims it is due
    });
    return decidePurge(row, NOW).purge === false;
  })()
);

check(
  "a stored date pushed FURTHER out is respected (delay is always safe)",
  (() => {
    const row = base({ data_eligible_for_deletion_at: "2040-01-01T00:00:00.000Z" });
    const v = decidePurge(row, NOW);
    return v.purge === false && v.reason === "retention_not_expired";
  })()
);

console.log("\n[A1] partitioning a page keeps the reason for every skip");

check(
  "a mixed page splits correctly and every skip carries a reason",
  (() => {
    const { purge, skip } = partitionPurgeCandidates(
      [
        base({ id: "ok" }),
        base({ id: "live", deleted_at: null }),
        base({ id: "done", purged_at: "2033-07-05T00:00:00.000Z" }),
        base({ id: "early", data_eligible_for_deletion_at: "2040-01-01T00:00:00.000Z" }),
      ],
      NOW
    );
    return (
      purge.length === 1 &&
      purge[0].id === "ok" &&
      skip.length === 3 &&
      skip.every((s) => typeof s.reason === "string" && s.reason.length > 0)
    );
  })()
);

check("an empty page purges nothing", partitionPurgeCandidates([], NOW).purge.length === 0);

console.log("\n[A1] the storage prefix is the ONLY thing bounding the blast radius");

check("a valid uuid yields exactly that user's prefix", storagePrefixForUser(USER) === `${USER}/`);

check(
  "a traversal attempt yields null, not a wider prefix",
  storagePrefixForUser("../") === null && storagePrefixForUser(`${USER}/../other`) === null
);

check("an empty id yields null", storagePrefixForUser("") === null);
check("a non-uuid yields null", storagePrefixForUser("all") === null);
check(
  "a uuid with a trailing slash is rejected rather than normalised",
  storagePrefixForUser(`${USER}/`) === null
);


console.log("\n[KLUIS] a paid Bewaarkluis outranks an expired retention window");

// Erasing something somebody PAID to keep is the worst thing this cron can do, so the
// vault check sits at the very bottom of decidePurge: even when every other check says
// "erase", the vault wins.
check(
  "an expired row with a vault running through 2033 is kept, with a reason",
  JSON.stringify(decidePurge(base({ kluis_keep_through_year: 2033 }), NOW)) ===
    JSON.stringify({ purge: false, reason: "bewaarkluis_actief" })
);

check(
  "the final year still counts — 'through 2033' means all of 2033",
  decidePurge(base({ kluis_keep_through_year: 2033 }), NOW).purge === false
);

check(
  "a vault that ended last year holds nothing back",
  decidePurge(base({ kluis_keep_through_year: 2032 }), NOW).purge === true
);

// null/undefined means "we looked and there is no vault" — that may purge. An UNKNOWN
// state never reaches here: the cron route itself fails CLOSED when it cannot read
// kluis_subscriptions, so "we could not check" stops the run instead of purging.
check(
  "no vault (null/undefined) still purges",
  decidePurge(base({ kluis_keep_through_year: null }), NOW).purge === true &&
    decidePurge(base({ kluis_keep_through_year: undefined }), NOW).purge === true
);

check(
  "garbage in the vault year protects nothing, but never crashes",
  decidePurge(base({ kluis_keep_through_year: NaN }), NOW).purge === true
);

console.log(`\n[A1] ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
