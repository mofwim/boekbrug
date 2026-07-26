// [STATEMENT-GUARD] Pure node test — run: npx tsx src/lib/statement-guard.test.ts
// Locks the deterministic backstop: a statement-of-account filename is never treated as a
// bookable invoice (which would double-count the invoices it summarises), while ordinary
// invoice / reminder filenames stay bookable.
import { isStatementFilename } from "./ai";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— statement-of-account filenames are caught (not bookable) —");
check("Rekeningoverzicht.pdf (the real Supervers case)", isStatementFilename("Rekeningoverzicht.pdf"));
check("rekening-overzicht", isStatementFilename("rekening-overzicht-2026.pdf"));
check("Saldo-overzicht", isStatementFilename("Saldo_overzicht juni.pdf"));
check("Openstaande posten", isStatementFilename("Openstaande posten Kiwi.pdf"));
check("Overzicht openstaande facturen", isStatementFilename("overzicht openstaande facturen.pdf"));

console.log("\n— ordinary invoices / single reminders stay bookable —");
check("a normal factuur", !isStatementFilename("Factuur-260555.pdf"));
check("invoice", !isStatementFilename("invoice_2026_04.pdf"));
check("a single-invoice reminder (aanmaning) is NOT forced out", !isStatementFilename("Aanmaning-260555.pdf"));
check("herinnering is NOT forced out", !isStatementFilename("Betalingsherinnering.pdf"));
check("empty filename is safe", !isStatementFilename(""));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
