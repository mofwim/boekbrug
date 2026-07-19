// [BANK-BALANCE] Pure node test — run: npx tsx src/lib/bank-statement-balance.test.ts
import { reconcileStatementBalance, balanceWarning } from "./bank-statement-balance";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— reconciles exactly —");
{
  // 1000 + (250 - 80 - 170) = 1000 → closing 1000
  const r = reconcileStatementBalance(1000, 1000, [250, -80, -170]);
  check("ok", r.ok === true);
  check("checkable", r.checkable === true);
  check("sum = 0", r.transactionsSum === 0);
  check("expectedClosing = 1000", r.expectedClosing === 1000);
  check("gap = 0", r.gap === 0);
  check("no warning", balanceWarning(r) === null);
}

console.log("\n— reconciles with a growing balance —");
{
  // 500 + (1200,50 - 300,25) = 1400,25
  const r = reconcileStatementBalance(500, 1400.25, [1200.5, -300.25]);
  check("ok", r.ok === true);
  check("expectedClosing = 1400.25", r.expectedClosing === 1400.25);
}

console.log("\n— 1 cent rounding is tolerated —");
{
  const r = reconcileStatementBalance(0, 100.0, [33.33, 33.33, 33.33]); // sum 99.99
  check("within 1ct tolerance → ok", r.ok === true);
  check("gap is 0.01", Math.abs(r.gap) <= 0.01);
}

console.log("\n— a MISSING credit is caught (positive gap) —");
{
  // opening 1000, closing 1500, but only -200 of tx present → expected 800, gap +700
  const r = reconcileStatementBalance(1000, 1500, [-200]);
  check("not ok", r.ok === false);
  check("gap = +700", r.gap === 700);
  const w = balanceWarning(r)!;
  check("warning mentions missing BIJgeschreven (credits)", /BIJgeschreven/.test(w));
  check("warning names the gap €700,00", /€700,00/.test(w));
  check("warning names beginsaldo €1000", /€1000,00/.test(w));
}

console.log("\n— a MISSING debit / duplicate is caught (negative gap) —");
{
  // opening 1000, closing 900, tx sum 0 → expected 1000, gap -100
  const r = reconcileStatementBalance(1000, 900, [50, -50]);
  check("not ok", r.ok === false);
  check("gap = -100", r.gap === -100);
  check("warning mentions AFgeschreven / dubbel", /AFgeschreven|dubbel/.test(balanceWarning(r)!));
}

console.log("\n— overdrawn (negative) balances reconcile —");
{
  // opening -500 (overdrawn), + (100 - 50) = -450
  const r = reconcileStatementBalance(-500, -450, [100, -50]);
  check("ok with debit balances", r.ok === true);
  check("expectedClosing = -450", r.expectedClosing === -450);
}

console.log("\n— not checkable when a balance is missing (no false alarm) —");
{
  const noClose = reconcileStatementBalance(1000, null, [123.45]);
  check("missing closing → not checkable", noClose.checkable === false);
  check("missing closing → ok (never a false 'incomplete')", noClose.ok === true);
  check("missing closing → no warning", balanceWarning(noClose) === null);
  const noOpen = reconcileStatementBalance(null, 1000, [123.45]);
  check("missing opening → not checkable", noOpen.checkable === false && noOpen.ok === true);
  const neither = reconcileStatementBalance(null, null, []);
  check("neither → not checkable, ok", neither.checkable === false && neither.ok === true);
}

console.log("\n— empty statement that declares no movement reconciles —");
{
  const r = reconcileStatementBalance(742.1, 742.1, []);
  check("0 tx, equal balances → ok", r.ok === true && r.txCount === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
