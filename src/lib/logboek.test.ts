// [LOGBOEK] Run: npx tsx --test src/lib/logboek.test.ts
//
// Three properties carry this file, and they are the three ways this screen could lie:
//
//   1. NOTHING IS DROPPED. Whatever the table holds — an action from before this union existed, one
//      nobody has written a sentence for, a row with no timestamp — comes back as an entry with
//      something true to render. A trail with silent gaps reads as a complete story.
//   2. NOTHING IS INVENTED. No link to a page that does not exist, no "someone else" assembled out
//      of a missing session, no date where the row has none.
//   3. THE VOCABULARY COVERS THE WRITERS. audit.ts is read here as data: an action added there and
//      classified nowhere would land in 'system', where an owner filtering on Geld never sees it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  logboekKindOf,
  toLogboekEntry,
  hasSentence,
  LOGBOEK_KINDS,
  type AuditRowLike,
  type LogboekKind,
} from "./logboek";
import { MESSAGES, type MessageKey } from "./i18n/messages";
import { translate } from "./i18n/t";

/** The 89 actions audit.ts can write, read out of the union itself rather than from memory. */
function auditActions(): string[] {
  const src = readFileSync("src/lib/audit.ts", "utf8");
  const start = src.indexOf("export type AuditAction =");
  const end = src.indexOf("export interface AuditParams");
  assert.ok(start >= 0 && end > start, "the AuditAction union moved — this gate finds it by name");
  const actions = [...src.slice(start, end).matchAll(/^\s*\|\s*'([^']+)'/gm)].map((m) => m[1]);
  assert.ok(actions.length >= 89, `only ${actions.length} actions parsed — the union's shape changed`);
  return actions;
}

/** The catalogue keys that belong to the SCREEN rather than to an action. */
const SCREEN_KEYS = [
  "log.titel", "log.uitleg", "log.leeg", "log.mislukt", "log.onbekend", "log.doorAnder",
  "log.meer", "log.filter.alles", "log.filter.geld", "log.filter.document", "log.filter.toegang",
  "log.spoorOnvolledig",
];

const row = (over: Partial<AuditRowLike> = {}): AuditRowLike => ({
  id: "a1",
  action: "invoice.created",
  entity_type: "invoice",
  entity_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  created_at: "2026-08-18T09:00:00Z",
  user_id: "owner",
  ...over,
});

/** What the copy layer will render for a row — the fallback this whole design rests on. */
const renderedKey = (action: string): string =>
  hasSentence(action) ? `log.${action}` : "log.onbekend";

// ─── The four buckets ───────────────────────────────────────────────────────────────────────────

test("[LOGBOEK] each domain lands in the bucket its filter chip promises", () => {
  // Failure direction: a money action classified as 'access' disappears from the Geld filter, and
  // the owner concludes the payment was never recorded — the exact doubt this screen exists to end.
  for (const action of [
    "invoice.created", "creditnota.created", "offerte.sent", "bank.confirmed", "cash.entry_added",
    "btw.filed", "turnover.day_removed", "ledger.auto_imported", "supplier.auto_incasso_on",
    "snelstart.pushed",
  ]) {
    assert.equal(logboekKindOf(action), "money", action);
  }
  for (const action of ["document.uploaded", "folder.renamed", "article.bulk_deleted"]) {
    assert.equal(logboekKindOf(action), "document", action);
  }
  for (const action of [
    "accountant.client_linked", "accountant.invoice_mandate_revoked", "member.invited",
    "user.password_changed", "email.connection_created",
  ]) {
    assert.equal(logboekKindOf(action), "access", action);
  }
  // The one action in the whole union with no domain of its own. It is on this list deliberately:
  // when a second one appears, the coverage test below is the one that says so.
  assert.equal(logboekKindOf("retention.warning_sent"), "system");
});

test("[LOGBOEK] an action nobody classified is 'system' — never quietly money", () => {
  // Failure direction: defaulting to 'money' (the biggest bucket) would file an unknown action
  // under Geld, which is the app claiming to understand a row it has never been told about.
  assert.equal(logboekKindOf("payroll.salary_paid"), "system");
  assert.equal(logboekKindOf("legacy.creditnota_created"), "system");
  // A domain that merely BEGINS with a known one. A startsWith rule files this under Geld; matching
  // the whole first segment is what keeps 'invoiced.*' from inheriting invoice's bucket.
  assert.equal(logboekKindOf("invoicex.created"), "system");
  assert.equal(logboekKindOf("invoice_bulk.created"), "system");
  // No dot at all, and the empty string. Both are shapes a database can hold and a screen must
  // survive; neither may throw.
  assert.equal(logboekKindOf("nodot"), "system");
  assert.equal(logboekKindOf(""), "system");
  assert.equal(logboekKindOf("."), "system");
});

test("[LOGBOEK] LOGBOEK_KINDS names every kind exactly once", () => {
  assert.deepEqual([...LOGBOEK_KINDS].sort(), ["access", "document", "money", "system"]);
  assert.equal(new Set(LOGBOEK_KINDS).size, LOGBOEK_KINDS.length, "no kind is listed twice");
  // 'system' has no filter chip of its own ('log.filter.*' names the other three plus Alles), so a
  // system row is reachable under Alles only. That is a design decision, not a gap — see the type.
  for (const k of ["log.filter.alles", "log.filter.geld", "log.filter.document", "log.filter.toegang"]) {
    assert.ok(k in MESSAGES, `${k} is the filter row's vocabulary`);
  }
});

// ─── The vocabulary covers the writers ──────────────────────────────────────────────────────────

test("[LOGBOEK] every action audit.ts can write is classified, and only the known one falls through", () => {
  // Failure direction: a new domain ('payroll.*', 'loan.*') added to audit.ts inherits 'system'
  // silently. Nothing breaks, nothing is empty — the rows simply never appear under any filter the
  // owner uses, which is the quietest way for this screen to become incomplete.
  const unclassified = auditActions().filter((a) => logboekKindOf(a) === "system");
  assert.deepEqual(
    unclassified.sort(),
    ["retention.warning_sent"],
    "a new action domain reached audit.ts without a bucket in logboek.ts — classify it",
  );
});

test("[LOGBOEK] every action audit.ts can write has a Dutch sentence", () => {
  // Failure direction: an action written by 60 files but missing from the catalogue renders as the
  // neutral 'Handeling vastgelegd' for every occurrence. Honest, but it hides what happened, and
  // nothing else would ever point at the gap.
  for (const action of auditActions()) {
    const key = `log.${action}`;
    assert.ok(key in MESSAGES, `${key} is missing from the catalogue`);
    assert.equal(hasSentence(action), true, `hasSentence does not know ${action}`);
    const dutch = translate("nl", key as MessageKey);
    assert.notEqual(dutch, key, `${key} falls through to its own key`);
    assert.ok(dutch.trim().length > 0, `${key} is blank in Dutch`);
  }
});

test("[LOGBOEK] the sentences and the actions are the same set, in both directions", () => {
  // The other half of the previous test: a key for an action that no longer exists is a sentence
  // nothing can ever render, and hasSentence would keep answering yes for a string the app cannot
  // produce. Reading both lists from their own files is what keeps the two from drifting apart.
  const actions = new Set(auditActions());
  const orphans = Object.keys(MESSAGES)
    .filter((k) => k.startsWith("log.") && !SCREEN_KEYS.includes(k))
    .filter((k) => !actions.has(k.slice("log.".length)));
  assert.deepEqual(orphans, [], "catalogue sentences for actions audit.ts cannot write");

  // And every screen key really is a screen key — if one of the twelve disappears, the fallback
  // this whole design rests on ('log.onbekend') may be the one that went.
  for (const k of SCREEN_KEYS) assert.ok(k in MESSAGES, `${k} is gone from the catalogue`);
});

test("[LOGBOEK] hasSentence says no for anything the catalogue does not carry", () => {
  // Failure direction: answering yes would make the copy layer render 'log.payroll.salary_paid' as
  // literal text on the screen of someone doing their bookkeeping.
  assert.equal(hasSentence("payroll.salary_paid"), false);
  assert.equal(hasSentence(""), false);
  assert.equal(hasSentence("onbekend"), false, "a screen key is not an action sentence");
  assert.equal(hasSentence("titel"), false);
  // The historical action name that v2 of audit.ts replaced with 'creditnota.created'.
  assert.equal(hasSentence("invoice.creditnota_created"), false);
});

// ─── Who did it ─────────────────────────────────────────────────────────────────────────────────

test("[LOGBOEK] byOther is true only when a known someone else did it", () => {
  // The reason the feature exists: the bookkeeper's own id sits in user_id on rows about the
  // owner's administration. Getting this backwards either accuses the owner of nothing they did, or
  // hides that their bookkeeper acted for them.
  assert.equal(toLogboekEntry(row({ user_id: "owner" }), "owner").byOther, false);
  assert.equal(toLogboekEntry(row({ user_id: "bookkeeper" }), "owner").byOther, true);
  // Nobody reading: there is no one for the row to be someone else THAN. Marking every row
  // "door iemand anders" here would be an accusation assembled out of a missing session.
  assert.equal(toLogboekEntry(row({ user_id: "bookkeeper" }), null).byOther, false);
  // No actor on the row: nothing is known, so nothing is claimed.
  assert.equal(toLogboekEntry(row({ user_id: null }), "owner").byOther, false);
  assert.equal(toLogboekEntry(row({ user_id: null }), null).byOther, false);
});

// ─── Where it points ────────────────────────────────────────────────────────────────────────────

test("[LOGBOEK] only an invoice row gets a link, and only when it names one", () => {
  // Failure direction: /dashboard/documents/<id> and /dashboard/bestanden/<id> do not exist — those
  // are single pages, not addressable per row. A 404 inside an audit trail teaches the owner the
  // trail is unreliable, at the moment they came to it for proof.
  assert.equal(
    toLogboekEntry(row({ entity_type: "invoice", entity_id: "abc" }), "owner").href,
    "/dashboard/invoice/abc",
  );
  assert.equal(toLogboekEntry(row({ entity_type: "invoice", entity_id: null }), "owner").href, null);
  assert.equal(toLogboekEntry(row({ entity_type: "invoice", entity_id: "  " }), "owner").href, null,
    "a blank id would link to the route root, which is not that invoice");
  for (const entity of [
    "document", "folder", "bank_transaction", "cash_entry", "accountant_client", "profile",
    "btw_filing", "daily_turnover", "email_sender_rule", "snelstart_connection", "quarter",
  ]) {
    assert.equal(toLogboekEntry(row({ entity_type: entity }), "owner").href, null, entity);
  }
});

// ─── The one that matters: nothing is dropped, nothing comes back empty ─────────────────────────

test("[LOGBOEK] no input produces a dropped row or an empty entry", () => {
  // [NO-SILENT-EMPTY] in one test. Every action the app can write, plus every malformed shape a
  // seven-year-old table can hold, must come back as a rendered line. The failure this prevents is
  // the worst one available here and the hardest to notice: a row quietly skipped looks exactly
  // like a row that never happened, and the owner reads the rest as the complete story.
  const hostile: AuditRowLike[] = [
    ...auditActions().map((action, i) => row({ id: `real-${i}`, action })),
    row({ id: "unknown", action: "payroll.salary_paid" }),
    row({ id: "historic", action: "invoice.creditnota_created" }),
    row({ id: "empty-action", action: "" }),
    row({ id: "spaced", action: "   " }),
    row({ id: "dotless", action: "something" }),
    row({ id: "prefix-only", action: "log." }),
    row({ id: "long", action: "x".repeat(300) }),
    row({ id: "no-time", created_at: null }),
    row({ id: "no-entity", entity_id: null, entity_type: "" }),
    row({ id: "no-actor", user_id: null }),
    row({ id: "everything-null", action: "", entity_type: "", entity_id: null, created_at: null, user_id: null }),
  ];

  const entries = hostile.map((r) => toLogboekEntry(r, "owner"));
  assert.equal(entries.length, hostile.length, "a row was dropped on the way to the screen");

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const source = hostile[i];
    assert.ok(e, `${source.id} produced nothing at all`);
    assert.equal(e.id, source.id, "the row's own id is what a support question is about");
    assert.equal(e.action, source.action, `${source.id} lost its raw action — the last thing a screen can show`);
    assert.equal(e.messageKey, `log.${source.action}`, `${source.id} built the wrong key`);
    assert.ok(LOGBOEK_KINDS.includes(e.kind), `${source.id} has a kind no filter knows: ${e.kind}`);
    assert.equal(e.at, source.created_at, "the timestamp is passed through, invented or not");

    // The whole point, stated as an assertion: whatever this row is, the copy layer has a real
    // Dutch sentence to put on the screen for it.
    const key = renderedKey(source.action);
    assert.ok(key in MESSAGES, `${source.id} would render a key that does not exist: ${key}`);
    const dutch = translate("nl", key as MessageKey);
    assert.ok(dutch.trim().length > 0, `${source.id} would render a blank line`);
    assert.notEqual(dutch, key, `${source.id} would render the key itself: ${key}`);
  }
});

test("[LOGBOEK] an entry never invents a date, a link or an actor it was not given", () => {
  const bare = toLogboekEntry(
    { id: "x", action: "payroll.salary_paid", entity_type: "payroll", entity_id: null, created_at: null, user_id: null },
    null,
  );
  assert.deepEqual(bare, {
    id: "x",
    action: "payroll.salary_paid",
    messageKey: "log.payroll.salary_paid",
    kind: "system" satisfies LogboekKind,
    at: null,
    href: null,
    byOther: false,
  });
  // And it is still shown: the copy layer has a sentence for it, just not that one.
  assert.equal(hasSentence(bare.action), false);
  assert.equal(translate("nl", "log.onbekend"), "Handeling vastgelegd");
});
