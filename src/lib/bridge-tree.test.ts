// [BOEK-002] Pure node test — run: npx tsx --test src/lib/bridge-tree.test.ts
//
// WHY THIS FILE DID NOT EXIST, AND WHY THAT MATTERED
//
// bridge-tree.ts is the heart of the Bridge: it decides where every invoice and every document
// LANDS. It was written to be tested — `today` and `onUnexpected` are injectable parameters, put
// there for exactly this file — and among 186 test files in src/lib there was no bridge-tree one.
// Neither parameter had ever been passed. The render gate covers the SCREEN with `nodes: []`, so
// the tree was rendered empty in the only place it was exercised at all.
//
// The most consequential thing it does silently is the Overig fallback:
//
//     const finalBase = path.length > 0 ? path : [NODE.overig]
//
// Nothing breaks when a document lands there. No error, no empty screen, no red gate — just a
// document filed where nobody put it. That is the shape of bug this file exists to catch, and it
// is how the missing folders_accountant_read policy stayed invisible: it made EVERY client
// document land in Overig for EVERY accountant, and the app never said a word.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the node labels are Dutch
// because they are folder names on a Dutch screen.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildBridgeTree,
  type BridgeInvoice,
  type BridgeDocument,
  type BridgeFolder,
} from "./bridge-tree";

const TODAY = "2026-08-04";
const KLANT = "11111111-1111-1111-1111-111111111111";
const KLANT2 = "22222222-2222-2222-2222-222222222222";

const inv = (over: Partial<BridgeInvoice> = {}): BridgeInvoice => ({
  id: "i1",
  invoice_number: "2026-001",
  invoice_type: "factuur",
  status: "sent",
  direction: "outgoing",
  invoice_date: "2026-05-12",
  due_date: "2026-06-11",
  accountant_status: null,
  payment_method: null,
  total_inc_btw: 605,
  document_id: null,
  pdf_url: null,
  sender_id: KLANT,
  receiver_id: null,
  client_name: "Afnemer BV",
  ...over,
});

const doc = (over: Partial<BridgeDocument> = {}): BridgeDocument => ({
  id: "d1",
  file_name: "bon.pdf",
  file_url: "https://x/bon.pdf",
  folder_id: "f1",
  doc_type: null,
  year: 2026,
  period: "Q2",
  invoice_id: null,
  user_id: KLANT,
  created_at: "2026-05-12T10:00:00Z",
  ...over,
});

const map = (over: Partial<BridgeFolder> = {}): BridgeFolder => ({
  id: "f1",
  name: "Inkoop",
  parent_id: null,
  folder_type: null,
  user_id: KLANT,
  ...over,
});

const paden = (nodes: { path: string[] }[]) => nodes.map((n) => n.path.join("/"));

// ── The Overig fallback — the silent one ─────────────────────────────────────

test("[MAPPEN] a document whose folder is KNOWN keeps its own place", () => {
  const nodes = buildBridgeTree({
    invoices: [],
    documents: [doc()],
    folders: [map()],
    today: TODAY,
  });
  assert.deepEqual(paden(nodes), ["Inkoop/bon.pdf".replace("/bon.pdf", "")]);
});

test("[MAPPEN] a document whose folder is MISSING lands in Overig — silently", () => {
  // This is the whole bug behind folders_accountant_read.sql. The accountant's page fetched
  // folders with the session client; four _own policies and none for him meant zero rows, so
  // folderMap was empty and EVERY client document fell through to here. Nothing errored.
  const nodes = buildBridgeTree({
    invoices: [],
    documents: [doc()],
    folders: [], // ← what an accountant used to get back
    today: TODAY,
  });
  assert.deepEqual(paden(nodes), ["Overig"]);
});

test("[MAPPEN] and in the accountant view that means Klanten/<naam>/Overig for everything", () => {
  const namen = new Map([[KLANT, "Bakkerij Yilmaz"], [KLANT2, "Loodgieter De Vries"]]);
  const zonder = buildBridgeTree({
    invoices: [],
    documents: [doc({ id: "a" }), doc({ id: "b", user_id: KLANT2, folder_id: "f9" })],
    folders: [],
    accountantView: true,
    clientNames: namen,
    today: TODAY,
  });
  assert.deepEqual(paden(zonder), [
    "Klanten/Bakkerij Yilmaz/Overig",
    "Klanten/Loodgieter De Vries/Overig",
  ]);

  // With the folders readable, the same two documents land where their owner put them.
  const met = buildBridgeTree({
    invoices: [],
    documents: [doc({ id: "a" }), doc({ id: "b", user_id: KLANT2, folder_id: "f9" })],
    folders: [map(), map({ id: "f9", name: "Bonnen", user_id: KLANT2 })],
    accountantView: true,
    clientNames: namen,
    today: TODAY,
  });
  assert.deepEqual(paden(met), [
    "Klanten/Bakkerij Yilmaz/Inkoop",
    "Klanten/Loodgieter De Vries/Bonnen",
  ]);
});

test("[MAPPEN] a nested folder renders its whole chain, deepest last", () => {
  const nodes = buildBridgeTree({
    invoices: [],
    documents: [doc({ folder_id: "kind" })],
    folders: [map({ id: "ouder", name: "2026" }), map({ id: "kind", name: "Q2", parent_id: "ouder" })],
    today: TODAY,
  });
  assert.deepEqual(paden(nodes), ["2026/Q2"]);
});

// ── Where an invoice lands ───────────────────────────────────────────────────

test("an unpaid invoice uses the ZZP words, and the accountant's own", () => {
  // The ZZP'er hates accounting jargon: Debiteuren/Crediteuren exist in the accountant view only.
  const zzp = buildBridgeTree({ invoices: [inv()], documents: [], folders: [], today: TODAY });
  assert.deepEqual(paden(zzp), ["2026/Q2 (apr–jun)/Verzonden"]);

  const boekhouder = buildBridgeTree({
    invoices: [inv()],
    documents: [],
    folders: [],
    accountantView: true,
    clientNames: new Map([[KLANT, "Bakkerij Yilmaz"]]),
    today: TODAY,
  });
  assert.deepEqual(paden(boekhouder), ["Klanten/Bakkerij Yilmaz/2026/Q2/Debiteuren"]);
});

test("[BRIDGE-QUARTER] the ZZP quarter label is byte-for-byte the physical folder name", () => {
  // The single most fragile string in this module, and the header says why: the ZZP view renders
  // invoices into the SAME label the seeded system folders use, so the two MERGE into one quarter
  // node. The dash is an en-dash (U+2013) and the months are Dutch abbreviations. Get one
  // character wrong and nothing throws — you get two sibling "Q2" folders, which is exactly the
  // duplication [BRIDGE-QUARTER] was written to fix.
  const zzp = buildBridgeTree({ invoices: [inv()], documents: [], folders: [], today: TODAY });
  const kwartaal = zzp[0].path[1];
  assert.equal(kwartaal, "Q2 (apr\u2013jun)", "en-dash, not a hyphen");
  assert.ok(!kwartaal.includes("-"), "a plain hyphen here silently splits the quarter in two");

  // The accountant view deliberately does NOT match it: there is no competing folder node there,
  // and its tree is an accounting roll-up. Asserting both sides keeps the difference intentional
  // instead of accidental.
  const acc = buildBridgeTree({
    invoices: [inv()], documents: [], folders: [],
    accountantView: true, clientNames: new Map([[KLANT, "B"]]), today: TODAY,
  });
  assert.equal(acc[0].path[3], "Q2", "short label on the accountant side");
});

test("a paid invoice is filed by HOW it was paid, in both views", () => {
  const bank = buildBridgeTree({
    invoices: [inv({ status: "paid", payment_method: "bank" })],
    documents: [], folders: [], today: TODAY,
  });
  assert.deepEqual(paden(bank), ["2026/Q2 (apr–jun)/Voldaan/Bank"]);
  const kas = buildBridgeTree({
    invoices: [inv({ status: "paid", payment_method: "kas" })],
    documents: [], folders: [], today: TODAY,
  });
  assert.deepEqual(paden(kas), ["2026/Q2 (apr–jun)/Voldaan/Contant"], "'kas' is stored, 'Contant' is shown");
});

// ── 'Verlopen' is COMPUTED, never a stored status ────────────────────────────

test("[BRIDGE-A] 'Verlopen' is a badge from the due date — and never a folder", () => {
  // The header is explicit: 'overdue' is never a stored status. So the badge has to follow the
  // clock, which is why `today` is injectable at all — and why this is the first test that has
  // ever passed it.
  const laat = buildBridgeTree({
    invoices: [inv({ due_date: "2026-06-11" })],
    documents: [], folders: [], today: TODAY,
  });
  assert.ok(laat[0].badges.some((b) => b.label === "Verlopen"), "past its due date");
  assert.ok(!laat[0].path.includes("Verlopen"), "…as a badge, never as a path node");

  // Same invoice, read BEFORE the due date: no badge. Without an injectable clock this case could
  // only be tested by waiting.
  const opTijd = buildBridgeTree({
    invoices: [inv({ due_date: "2026-06-11" })],
    documents: [], folders: [], today: "2026-06-01",
  });
  assert.ok(!opTijd[0].badges.some((b) => b.label === "Verlopen"));
});

test("[BRIDGE-A] a PAID invoice past its due date is not overdue", () => {
  const nodes = buildBridgeTree({
    invoices: [inv({ status: "paid", payment_method: "bank", due_date: "2026-01-01" })],
    documents: [], folders: [], today: TODAY,
  });
  assert.ok(!nodes[0].badges.some((b) => b.label === "Verlopen"), "money arrived; the date is moot");
});

// ── The safety net announces itself ──────────────────────────────────────────

test("a status the module KNOWS is filed, not dumped", () => {
  // 'unclear' is a real state in the intake pipeline and has its own home. Worth pinning: it is
  // the status most likely to be mistaken for "unknown" by someone reading the safety net below.
  const nodes = buildBridgeTree({
    invoices: [inv({ status: "unclear" })],
    documents: [], folders: [], today: TODAY,
  });
  assert.deepEqual(paden(nodes), ["Inbox"]);
});

test("a status the module does NOT know lands in Overig AND calls onUnexpected", () => {
  // The second injectable parameter, also never passed until now. A row that reaches Overig
  // through the safety net is a row nobody filed — it must be reportable, not merely survivable.
  // If a future status is added to the database and forgotten here, this is the only thing that
  // will say so out loud.
  const gezien: Array<[string, string]> = [];
  const nodes = buildBridgeTree({
    invoices: [inv({ status: "iets-nieuws" as unknown as BridgeInvoice["status"] })],
    documents: [],
    folders: [],
    today: TODAY,
    onUnexpected: (kind, value, id) => {
      assert.equal(kind, "invoice_status");
      gezien.push([value, id]);
    },
  });
  assert.deepEqual(paden(nodes), ["Overig"]);
  assert.deepEqual(gezien, [["iets-nieuws", "i1"]]);
});

// ── The duplicate-PDF rule ───────────────────────────────────────────────────

test("a PDF attached to an invoice is rendered ONCE, as the invoice", () => {
  const nodes = buildBridgeTree({
    invoices: [inv({ document_id: "d1" })],
    documents: [doc({ id: "d1" })],
    folders: [map()],
    today: TODAY,
  });
  assert.equal(nodes.length, 1, "the same paper must not appear in two places");
  assert.equal(nodes[0].source, "invoice");
  assert.equal(nodes[0].pdfUrl, "https://x/bon.pdf", "…and it carries the attached file's url");
  // [BRIDGE-OPEN-LOCATION] The invoice knows where the physical file lives, so "open location"
  // works from the rendered node.
  assert.equal(nodes[0].hasLocation, true);
  assert.equal(nodes[0].folderId, "f1");
});

// ── The accountant sees LINKED clients and nobody else ───────────────────────

test("[BOEK-005] the accountant view drops rows of anyone who is not a linked client", () => {
  // Including the accountant's OWN invoices — they are not their own client. A stray row here
  // would put a third party's paperwork in someone's client folder.
  const namen = new Map([[KLANT, "Bakkerij Yilmaz"]]);
  const nodes = buildBridgeTree({
    invoices: [inv({ id: "van-klant" }), inv({ id: "van-vreemde", sender_id: "9999" })],
    documents: [doc({ id: "doc-klant" }), doc({ id: "doc-vreemde", user_id: "9999" })],
    folders: [map()],
    accountantView: true,
    clientNames: namen,
    today: TODAY,
  });
  assert.deepEqual(nodes.map((n) => n.id), ["van-klant", "doc-klant"]);
});

test("a client with no name in the map falls back to the id, never disappears", () => {
  // Losing a document because a profile row was missing would be worse than an ugly folder name.
  const nodes = buildBridgeTree({
    invoices: [],
    documents: [doc()],
    folders: [map()],
    accountantView: true,
    clientNames: new Map([[KLANT, ""]]),
    today: TODAY,
  });
  assert.equal(nodes.length, 1, "the document survives");
  assert.equal(nodes[0].path[0], "Klanten");
});

// ── Ownership travels with the node ──────────────────────────────────────────

test("[SEC-STORAGE-PATH] ownerId is set in BOTH views — signing needs it either way", () => {
  const zzp = buildBridgeTree({ invoices: [inv()], documents: [doc()], folders: [map()], today: TODAY });
  assert.ok(zzp.every((n) => n.ownerId === KLANT), "the owner of the bytes, not the viewer");
  // clientId is the GROUPING key and is deliberately null outside the accountant view — that is a
  // display concern. ownerId is not, and nulling it would break signing.
  assert.ok(zzp.every((n) => n.clientId === null));
});

test("an archived invoice is hidden, not dropped", () => {
  // Dropping it would make it unrecoverable from this screen; hiding keeps the 7-year record
  // reachable without putting it in the way.
  const nodes = buildBridgeTree({
    invoices: [inv({ status: "archived" })],
    documents: [], folders: [], today: TODAY,
  });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].hidden, true);
});
