// [QUARTER-CLOSE] Pure test — run: npx tsx src/lib/quarter-close.test.ts
import { previousQuarter, buildQuarterCloseNotice } from "./quarter-close";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— previousQuarter: the quarter that just ended —");
{
  // Cron fires early in the first month of the new quarter.
  check("Jan 5 2026 → Q4 2025", (() => { const r = previousQuarter(new Date(Date.UTC(2026, 0, 5))); return r.year === 2025 && r.quarter === 4; })());
  check("Apr 5 2026 → Q1 2026", (() => { const r = previousQuarter(new Date(Date.UTC(2026, 3, 5))); return r.year === 2026 && r.quarter === 1; })());
  check("Jul 5 2026 → Q2 2026", (() => { const r = previousQuarter(new Date(Date.UTC(2026, 6, 5))); return r.year === 2026 && r.quarter === 2; })());
  check("Oct 5 2026 → Q3 2026", (() => { const r = previousQuarter(new Date(Date.UTC(2026, 9, 5))); return r.year === 2026 && r.quarter === 3; })());
}

console.log("\n— notice copy is honest: clean vs gaps vs empty —");
{
  const clean = buildQuarterCloseNotice("Q2 2026", { warnings: [], outgoingCount: 3, incomingCount: 5 });
  check("clean → not empty, clean=true, gapCount 0", clean.empty === false && clean.clean === true && clean.gapCount === 0);
  check("clean owner body never claims a guaranteed 'klaar' — says controleer + dien in", /Controleer/.test(clean.ownerBody) && !/gegarandeerd/.test(clean.ownerBody));
  // [BELOFTE §4.3] "staat klaar", nooit "is gedaan". De oude koppen zeiden "is afgesloten"
  // en "Je klant heeft ... afgesloten" terwijl deze cron op de 5e vuurt en de klant niets
  // heeft gedaan — wij hebben zijn stukken bij elkaar gezet. AV §4.3 maakt een uitkomst van
  // het systeem een suggestie die de mens bevestigt; een melding die zegt dat het kwartaal
  // áf is, is de zin waarop wij worden aangesproken als er iets ontbrak.
  check("clean accountant → 'staat klaar'", /staat klaar/.test(clean.accountantTitle));
  check(
    "geen enkele kop beweert dat het kwartaal is afgesloten",
    !/afgesloten/i.test(clean.accountantTitle) &&
      !/afgesloten/i.test(clean.ownerTitle) &&
      !/heeft .* afgesloten/i.test(clean.accountantBody)
  );

  const gaps = buildQuarterCloseNotice("Q2 2026", { warnings: [{ message: "2 facturen nog te controleren" }, { message: "bankafschrift ontbreekt" }], outgoingCount: 1, incomingCount: 0 });
  check("gaps → clean=false, gapCount 2", gaps.clean === false && gaps.gapCount === 2);
  check("gaps owner body lists the concrete reasons", /nog te controleren/.test(gaps.ownerBody) && /bankafschrift/.test(gaps.ownerBody));

  // [REGRESSION] A dormant quarter is NOT warning-free: summarizeClosingPackage emits no_invoices +
  // no_bank_statement. `empty` must key on invoice ACTIVITY only, or the anti-nag guard is dead code.
  const dormant = buildQuarterCloseNotice("Q2 2026", {
    warnings: [{ message: "Geen geverifieerde facturen in dit kwartaal" }, { message: "Geen banktransacties gevonden" }],
    outgoingCount: 0, incomingCount: 0,
  });
  check("no invoice activity → empty=true even WITH emptiness warnings (dormant skip)", dormant.empty === true && dormant.clean === false);
  // A quarter with any real invoice activity is never skipped.
  const active = buildQuarterCloseNotice("Q2 2026", { warnings: [], outgoingCount: 0, incomingCount: 1 });
  check("1 incoming invoice → not empty", active.empty === false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
