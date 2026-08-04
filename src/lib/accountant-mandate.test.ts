// [MANDAAT] Pure node test — run: npx tsx --test src/lib/accountant-mandate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { isMandateActive, resolveAccountantActing, type MandateFacts } from "./accountant-mandate";
import { canAccessInvoice, canSendInvoice, canAccessScreen, invoiceOwnerId, invoiceCreatedBy, invoiceReadFilter } from "./acting-for";

const ACCOUNTANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const NOW = Date.parse("2026-08-04T12:00:00Z");

function live(): MandateFacts {
  return {
    callerRole: "accountant",
    linked: true,
    mandate: { zzper_id: CLIENT, accountant_id: ACCOUNTANT, revoked_at: null },
  };
}

test("a live mandate makes the accountant act for the client", () => {
  const acting = resolveAccountantActing(ACCOUNTANT, CLIENT, live(), NOW);
  assert.ok(acting, "a linked, mandated accountant must be able to act");
  // The books are the CLIENT's — this is the art. 35 requirement the whole design hangs on.
  assert.equal(invoiceOwnerId(acting!), CLIENT);
  assert.equal(invoiceCreatedBy(acting!), ACCOUNTANT);
  assert.equal(acting!.role, "boekhouder");
});

test("every missing fact ends it, one at a time", () => {
  // Not an accountant at all.
  assert.equal(resolveAccountantActing(ACCOUNTANT, CLIENT, { ...live(), callerRole: "zzper" }, NOW), null);
  assert.equal(resolveAccountantActing(ACCOUNTANT, CLIENT, { ...live(), callerRole: null }, NOW), null);
  // Accountant, but not this client's.
  assert.equal(resolveAccountantActing(ACCOUNTANT, CLIENT, { ...live(), linked: false }, NOW), null);
  // Linked, but never mandated — the common case: most linked accountants may read, not invoice.
  assert.equal(resolveAccountantActing(ACCOUNTANT, CLIENT, { ...live(), mandate: null }, NOW), null);
});

test("revoking lands immediately, and an unreadable date counts as revoked", () => {
  const revoked = { ...live(), mandate: { zzper_id: CLIENT, accountant_id: ACCOUNTANT, revoked_at: "2026-08-04T11:59:59Z" } };
  assert.equal(resolveAccountantActing(ACCOUNTANT, CLIENT, revoked, NOW), null, "no grace period");
  // A revoke scheduled in the future is not yet a revoke.
  const future = { ...live(), mandate: { zzper_id: CLIENT, accountant_id: ACCOUNTANT, revoked_at: "2026-09-01T00:00:00Z" } };
  assert.ok(resolveAccountantActing(ACCOUNTANT, CLIENT, future, NOW));
  // Garbage in the column must not read as "still allowed".
  assert.equal(isMandateActive({ zzper_id: CLIENT, accountant_id: ACCOUNTANT, revoked_at: "niet-een-datum" }, NOW), false);
});

test("a mandate row about someone else grants nothing", () => {
  // The guard against a swapped parameter or a wrong query: the row must be about THIS pair.
  const wrongClient = { ...live(), mandate: { zzper_id: OTHER, accountant_id: ACCOUNTANT, revoked_at: null } };
  assert.equal(resolveAccountantActing(ACCOUNTANT, CLIENT, wrongClient, NOW), null);
  const wrongAccountant = { ...live(), mandate: { zzper_id: CLIENT, accountant_id: OTHER, revoked_at: null } };
  assert.equal(resolveAccountantActing(ACCOUNTANT, CLIENT, wrongAccountant, NOW), null);
});

test("an accountant cannot enter their own administration through this door", () => {
  // It would give them a boekhouder read filter over their own books — they would lose sight of
  // every invoice they did not create through this screen.
  assert.equal(resolveAccountantActing(ACCOUNTANT, ACCOUNTANT, live(), NOW), null);
});

test("the mandate does not extend to invoices the client made", () => {
  const acting = resolveAccountantActing(ACCOUNTANT, CLIENT, live(), NOW)!;
  // Made by the accountant → theirs to finish and send.
  const mine = { sender_id: CLIENT, created_by: ACCOUNTANT };
  assert.equal(canAccessInvoice(acting, mine), true);
  assert.equal(canSendInvoice(acting, mine), true);
  // Made by the client themselves → refused. The database refuses it too
  // (prevent_accountant_amount_changes); this is the half that answers 403 instead of 500.
  const theirs = { sender_id: CLIENT, created_by: CLIENT };
  assert.equal(canAccessInvoice(acting, theirs), false);
  assert.equal(canSendInvoice(acting, theirs), false);
  // And nothing at all from another company.
  assert.equal(canAccessInvoice(acting, { sender_id: OTHER, created_by: ACCOUNTANT }), false);
});

test("the read filter is scoped to the client AND to what the accountant wrote", () => {
  const acting = resolveAccountantActing(ACCOUNTANT, CLIENT, live(), NOW)!;
  assert.deepEqual(invoiceReadFilter(acting), { sender_id: CLIENT, created_by: ACCOUNTANT });
});

test("acting for a client opens the invoice screens and nothing else", () => {
  const acting = resolveAccountantActing(ACCOUNTANT, CLIENT, live(), NOW)!;
  assert.equal(canAccessScreen(acting, "/dashboard/accountant/factuur"), true);
  assert.equal(canAccessScreen(acting, "/dashboard/invoice/abc"), true);
  // Not the client's own money screens, and not the sales member's list.
  assert.equal(canAccessScreen(acting, "/dashboard/resultaat"), false);
  assert.equal(canAccessScreen(acting, "/dashboard/aangifte"), false);
  assert.equal(canAccessScreen(acting, "/dashboard/verkoop"), false);
  // No prefix bleed: a path that merely starts the same is not a subpath.
  assert.equal(canAccessScreen(acting, "/dashboard/accountant/factuurregels"), false);
});
