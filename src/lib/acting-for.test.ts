// [ACTING-FOR] Pure node test — run: npx tsx --test src/lib/acting-for.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveActingFor,
  isActingForOther,
  canAccessScreen,
  invoiceOwnerId,
  invoiceCreatedBy,
  invoiceReadFilter,
  canAccessInvoice,
  canSendInvoice,
  SALES_SCREENS,
  type MemberLink,
} from "./acting-for";

const BOSS = "11111111-1111-1111-1111-111111111111";
const MEMBER = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";
const NOW = Date.parse("2026-08-01T12:00:00.000Z");

const link = (over: Partial<MemberLink> = {}): MemberLink => ({
  owner_id: BOSS,
  member_id: MEMBER,
  role: "verkoop",
  revoked_at: null,
  ...over,
});

test("without a link you are the owner of your own administration", () => {
  const a = resolveActingFor(BOSS, null, NOW);
  assert.deepEqual(a, { ownerId: BOSS, actorId: BOSS, role: "eigenaar" });
  assert.equal(isActingForOther(a), false);
});

test("with a link you act ON BEHALF OF the boss, and own nothing", () => {
  const a = resolveActingFor(MEMBER, link(), NOW);
  assert.equal(a.ownerId, BOSS, "the administration belongs to the boss");
  assert.equal(a.actorId, MEMBER, "the trail belongs to the member");
  assert.equal(a.role, "verkoop");
  assert.equal(isActingForOther(a), true);
});

test("the invoice number ALWAYS comes from the owner's series", () => {
  // THIS IS THE WHOLE REASON FOR THIS MODULE. invoice-numbering.ts allocates per user_id. If a
  // member booked under their own id, two series would run under one VAT number — and Art. 35
  // Wet OB requires gapless, forward-only numbering. Not reversible.
  const member = resolveActingFor(MEMBER, link(), NOW);
  const boss = resolveActingFor(BOSS, null, NOW);
  assert.equal(invoiceOwnerId(member), BOSS, "one series per company");
  assert.equal(invoiceOwnerId(boss), BOSS, "and the same series for the boss");
  assert.equal(invoiceOwnerId(member), invoiceOwnerId(boss), "literally the same series");

  // But the trail DOES differ — otherwise there is no seeing who made what.
  assert.equal(invoiceCreatedBy(member), MEMBER);
  assert.equal(invoiceCreatedBy(boss), BOSS);
});

test("a revoked link grants nothing, immediately", () => {
  const yesterday = new Date(NOW - 86_400_000).toISOString();
  const a = resolveActingFor(MEMBER, link({ revoked_at: yesterday }), NOW);
  assert.equal(a.ownerId, MEMBER, "back to themselves, not to the boss");
  assert.equal(a.role, "eigenaar");
});

test("a revocation in the FUTURE still lets them in — until that moment", () => {
  const tomorrow = new Date(NOW + 86_400_000).toISOString();
  assert.equal(resolveActingFor(MEMBER, link({ revoked_at: tomorrow }), NOW).ownerId, BOSS);
  // and not a millisecond after
  assert.equal(resolveActingFor(MEMBER, link({ revoked_at: tomorrow }), NOW + 86_400_001).ownerId, MEMBER);
});

test("an unreadable revocation date puts them OUT, not in", () => {
  // Failure direction: better a member locked out too early (they call) than a revoked member
  // who stays inside (nobody calls).
  const a = resolveActingFor(MEMBER, link({ revoked_at: "not a date" }), NOW);
  assert.equal(a.ownerId, MEMBER);
});

test("a row that is not about this session is ignored", () => {
  // If a wrong row ever arrived here — a swapped parameter, a query without .eq() — this is
  // precisely the case where continuing puts a stranger inside someone else's books.
  const a = resolveActingFor(STRANGER, link(), NOW);
  assert.equal(a.ownerId, STRANGER);
  assert.equal(a.role, "eigenaar");
});

test("a self-link is refused", () => {
  const a = resolveActingFor(MEMBER, link({ owner_id: MEMBER }), NOW);
  assert.equal(a.role, "eigenaar");
  assert.equal(a.ownerId, MEMBER);
});

test("an UNKNOWN role grants nothing — it never silently inherits 'verkoop'", () => {
  for (const role of ["inkoop", "admin", "finance", "", "VERKOOP", "eigenaar"]) {
    const a = resolveActingFor(MEMBER, link({ role }), NOW);
    assert.equal(a.ownerId, MEMBER, `role '${role}' must not grant access to the boss's books`);
  }
});

test("the read boundary: a member sees only what they created themselves", () => {
  const member = resolveActingFor(MEMBER, link(), NOW);
  const boss = resolveActingFor(BOSS, null, NOW);

  assert.deepEqual(invoiceReadFilter(boss), { sender_id: BOSS }, "the boss sees everything of their own");
  assert.deepEqual(
    invoiceReadFilter(member),
    { sender_id: BOSS, created_by: MEMBER },
    "the member sees neither the boss's revenue nor a colleague's",
  );
});

test("checking one row differs from filtering a list — and that is where guessed ids arrive", () => {
  const member = resolveActingFor(MEMBER, link(), NOW);
  const boss = resolveActingFor(BOSS, null, NOW);

  const byMember = { sender_id: BOSS, created_by: MEMBER };
  const byBoss = { sender_id: BOSS, created_by: BOSS };
  const byColleague = { sender_id: BOSS, created_by: STRANGER };
  const byAnotherCompany = { sender_id: STRANGER, created_by: MEMBER };

  assert.equal(canAccessInvoice(member, byMember), true);
  assert.equal(canAccessInvoice(member, byBoss), false, "the boss's invoice is not theirs");
  assert.equal(canAccessInvoice(member, byColleague), false, "nor is a colleague's");
  assert.equal(canAccessInvoice(member, byAnotherCompany), false, "let alone another company's");

  assert.equal(canAccessInvoice(boss, byMember), true, "the boss DOES see what their member made");
  assert.equal(canAccessInvoice(boss, byAnotherCompany), false);

  // sending follows exactly the same boundary — no second, wider gate
  for (const inv of [byMember, byBoss, byColleague, byAnotherCompany]) {
    assert.equal(canSendInvoice(member, inv), canAccessInvoice(member, inv));
    assert.equal(canSendInvoice(boss, inv), canAccessInvoice(boss, inv));
  }
});

test("an invoice without created_by does not belong to the member", () => {
  // Every invoice from before this migration has created_by = NULL. Those belong to the owner,
  // not to the first member who happens along.
  const member = resolveActingFor(MEMBER, link(), NOW);
  assert.equal(canAccessInvoice(member, { sender_id: BOSS, created_by: null }), false);
  assert.equal(canAccessInvoice(member, { sender_id: BOSS }), false);
});

test("the screen guard is a CLOSED list — what is not in it, is shut", () => {
  const member = resolveActingFor(MEMBER, link(), NOW);
  const boss = resolveActingFor(BOSS, null, NOW);

  for (const open of SALES_SCREENS) assert.equal(canAccessScreen(member, open), true, open);
  assert.equal(canAccessScreen(member, "/dashboard/verkoop/nieuw"), true, "a subpath is included");

  // The list on their own screen links to the detail screen of a single invoice. Were
  // /dashboard/invoice not open, every row would dead-end on a redirect back to the list — a
  // screen pointing at itself. RLS limits what they see there, not this guard.
  assert.equal(canAccessScreen(member, "/dashboard/invoice/new"), true);
  assert.equal(canAccessScreen(member, "/dashboard/invoice/8f0d2b1c-0000-0000-0000-000000000000"), true);
  assert.equal(canAccessScreen(member, "/dashboard/invoice/8f0d2b1c-0000-0000-0000-000000000000/edit"), true);

  // The company's money and figures: shut.
  for (const shut of [
    "/dashboard/bank",
    "/dashboard/kas",
    "/dashboard/dagomzet",
    "/dashboard/aangifte",
    "/dashboard/resultaat",
    "/dashboard/brug",
    "/dashboard/incoming",
    "/dashboard/settings",
    "/dashboard",
  ]) {
    assert.equal(canAccessScreen(member, shut), false, `${shut} must be shut for a sales member`);
    assert.equal(canAccessScreen(boss, shut), true, `${shut} belongs to the owner themselves`);
  }
});

test("a screen added TOMORROW is shut, not open", () => {
  // The most important property of the guard. A new screen accidentally open is a leak nobody
  // notices; a new screen accidentally shut is a complaint within a day. Opening up should be a
  // deliberate act.
  const member = resolveActingFor(MEMBER, link(), NOW);
  assert.equal(canAccessScreen(member, "/dashboard/nog-niet-bedacht"), false);
  assert.equal(canAccessScreen(member, "/dashboard/winst-2027"), false);
});

test("a prefix without a boundary is how guards silently grow too wide", () => {
  const member = resolveActingFor(MEMBER, link(), NOW);
  // '/dashboard/verkoop' is open. '/dashboard/verkoopcijfers' is a DIFFERENT screen.
  assert.equal(canAccessScreen(member, "/dashboard/verkoopcijfers"), false);
  assert.equal(canAccessScreen(member, "/dashboard/klantenbestand-export"), false);
});

test("without a user nothing passes silently", () => {
  assert.throws(() => resolveActingFor("", link(), NOW), /ACTING-FOR/);
});
