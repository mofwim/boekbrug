// [BANK-PERIOD] Pure node test — run: npx tsx src/lib/payment-period.test.ts
import { parsePaymentPeriod } from "./payment-period";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— parsePaymentPeriod —");
{
  const p = parsePaymentPeriod("Incasso Huur Periode: 01-06-2026 tot 01-07-2026");
  check("parses the rent period", p !== null);
  check("startIso", p?.startIso === "2026-06-01");
  check("endIso", p?.endIso === "2026-07-01");
  check("label same-year", p?.label === "1 jun. – 1 jul. 2026");

  check("t/m separator", parsePaymentPeriod("periode 01-06-2026 t/m 30-06-2026")?.endIso === "2026-06-30");
  check("slash dates", parsePaymentPeriod("Periode 01/06/2026 - 01/07/2026")?.startIso === "2026-06-01");
  check("ISO dates", parsePaymentPeriod("van 2026-06-01 tot 2026-07-01")?.startIso === "2026-06-01");
  check("bare range without the word periode", parsePaymentPeriod("huur 01-06-2026 tot 01-07-2026")?.startIso === "2026-06-01");

  check("no dates → null", parsePaymentPeriod("betaling factuur 2026-014") === null);
  check("empty → null", parsePaymentPeriod("") === null);
  check("a single date is not a period", parsePaymentPeriod("vervaldatum 01-06-2026") === null);
  check("backwards range → null", parsePaymentPeriod("periode 01-07-2026 tot 01-06-2026") === null);
  check("invalid month → null", parsePaymentPeriod("periode 01-13-2026 tot 01-14-2026") === null);
  const cross = parsePaymentPeriod("periode 01-12-2026 tot 01-01-2027");
  check("cross-year label", cross?.label === "1 dec. 2026 – 1 jan. 2027");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
