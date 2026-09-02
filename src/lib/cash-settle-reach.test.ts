// [KAS-RICHTING][MANUAL-PARTIAL-PAY] Two ways the cash reconcile can be wrong about money without
// any of its own arithmetic being wrong: it can book a movement the wrong way, or it can never
// visit the owner at all.
// Run: npx tsx --test src/lib/cash-settle-reach.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildCashSettlements, type SettleableInvoice } from "./cash";
import { readableDirection } from "./cash-settle-assemble";

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf-8");

// ── [KAS-RICHTING] What an unreadable direction costs ───────────────────────

const sale = (direction: unknown): SettleableInvoice => ({
  id: "inv-1",
  direction,
  total_inc_btw: 250,
  payment_date: "2026-07-01",
  invoice_number: "F-9",
  client_name: "Klant",
  cash_instalments: [{ id: "t1", amount: 250, paid_on: "2026-07-01" }],
} as unknown as SettleableInvoice);

test("[KAS-RICHTING] a cash sale raises the drawer and a cash purchase lowers it", () => {
  assert.equal(buildCashSettlements(sale("outgoing"))[0].direction, "in");
  assert.equal(buildCashSettlements(sale("incoming"))[0].direction, "out");
});

test("[KAS-RICHTING] and a direction nobody can read books it as a purchase — off by twice", () => {
  // Not the fix; the COST of the guess, so that the report at the call site has a reason on the
  // record. Every unreadable value lands on 'out'. When the invoice really was a sale, the drawer
  // does not merely miss €250 — it moves €250 the wrong way, so the balance is €500 from the truth
  // on the one figure whose entire purpose is to reconcile against the cash in the till.
  for (const bad of [null, undefined, "", "OUTGOING", "uitgaand", "sale"]) {
    assert.equal(
      buildCashSettlements(sale(bad))[0].direction,
      "out",
      `${JSON.stringify(bad)} no longer books as a purchase — if that is deliberate, this test is the place to say so`,
    );
  }
});

test("[KAS-RICHTING] the reconcile does not take that guess silently", () => {
  // This USED to be a source gate, with the reason written next to it: "the value never reaches
  // this far — loadCashSettlementState is I/O to its last line". That premise has expired.
  // readableDirection is a pure export in cash-settle-assemble.ts now, so the guess can be watched
  // being made instead of being grepped for, which is a stronger thing to know.
  const heard: unknown[] = [];
  for (const bad of [null, undefined, "", "OUTGOING", "uitgaand", "sale"]) {
    assert.equal(readableDirection(bad, (v) => heard.push(v)), "incoming", `${JSON.stringify(bad)} no longer defaults to a purchase`);
  }
  assert.equal(heard.length, 6, "a guess was made without anyone being told — that is the whole defect");
  for (const good of ["incoming", "outgoing"]) {
    assert.equal(readableDirection(good, () => assert.fail("a readable direction was reported as a guess")), good);
  }
});

test("[KAS-RICHTING] …and the reconcile is what turns hearing it into telling somebody", () => {
  // The half that stays a source gate, and only this half: a pure function cannot report, so the
  // wiring from the guess to reportHandledFailure lives in the I/O module and is unreachable from
  // here. Pinned as a RULE — the callback is passed and it reaches the reporter — rather than as a
  // spelling, because the last three gates written in this repo pinned spellings and each one
  // failed the very fix its own comment asked for.
  const src = read("src", "lib", "cash-settle.ts");
  assert.match(
    src,
    /onUnreadableDirection:[\s\S]{0,200}?reportUnreadableDirection/,
    "the assembly no longer hands the reconcile anything to report an unreadable direction with",
  );
  assert.match(
    src,
    /function reportUnreadableDirection[\s\S]{0,600}?reportHandledFailure/,
    "the direction report no longer reaches the failure reporter — the guess is silent again",
  );
});

// ── [MANUAL-PARTIAL-PAY] Who the hourly pass actually visits ────────────────

test("[MANUAL-PARTIAL-PAY] the cron looks for cash instalments, not only for paid-kas invoices", () => {
  // "Which owners have cash to reconcile" is a DEFINITION, written once in loadCashSettlementState:
  // status paid + method kas, UNION anything holding a kas instalment. The cron spelled only the
  // first half, so an owner who took €200 of a €500 invoice from the till — an invoice that is
  // still OPEN — was invisible to it.
  //
  // Set 3 (existing 'betaling' entries) rescues them only once a reconcile has already run. But
  // the cron IS the net under the synchronous reconcile at pay time: the case it exists for is the
  // one where that call failed, and in that case there is no entry to be found by.
  const cron = read("src", "app", "api", "cron", "reconcile", "route.ts");
  assert.match(
    cron,
    /from\("bank_tx_invoices"\)\.select\("user_id"\)[\s\S]{0,120}?\.eq\("method", "kas"\)[\s\S]{0,60}?\.is\("transaction_id", null\)/,
    "the cron no longer discovers owners holding a kas instalment — the second half of the definition",
  );
  assert.match(
    cron,
    /for \(const r of kasTermijn\) if \(r\.user_id\) userIds\.add\(r\.user_id\)/,
    "the kas-instalment owners are read but never added to the set the run iterates",
  );
});

test("[MANUAL-PARTIAL-PAY] and it reads them the same way the settle does", () => {
  // The failure this whole pair guards against is not a missing query — it is two spellings of one
  // definition drifting apart. Both sides must filter kas instalments identically: method 'kas'
  // AND no transaction_id (a linked one is a bank line, not a till handover).
  const settle = read("src", "lib", "cash-settle.ts");
  const cron = read("src", "app", "api", "cron", "reconcile", "route.ts");
  for (const [name, src] of [["cash-settle", settle], ["the cron", cron]] as const) {
    assert.match(src, /\.eq\("method", "kas"\)/, `${name} no longer filters on method 'kas'`);
    assert.match(src, /\.is\("transaction_id", null\)/, `${name} no longer excludes bank-linked instalments`);
  }
});
