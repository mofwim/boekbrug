// [TRUTH-FILED] Pure test for btw-filing.ts — run: npx tsx src/lib/btw-filing.test.ts
import { computeFilingDivergence, SUPPLETIE_THRESHOLD, type FilingFigures } from "./btw-filing";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const base: FilingFigures = { omzet: 10000, kosten: 4000, btwVerschuldigd: 2100, btwVoorbelasting: 840, btwSaldo: 1260 };

console.log("— no change → not flagged —");
{
  const d = computeFilingDivergence(base, { ...base });
  check("changed is false when identical", d.changed === false);
  check("no suppletie", d.needsSuppletie === false);
  check("all deltas zero", d.btwSaldoDelta === 0 && d.omzetDelta === 0);
}

console.log("— rounding noise is ignored —");
{
  const d = computeFilingDivergence(base, { ...base, btwSaldo: base.btwSaldo + 0.004 });
  check("a sub-cent move is NOT a change", d.changed === false);
}

console.log("— small change (≤ €1.000) → change, no suppletie —");
{
  // A €200 late purchase invoice: voorbelasting +42, saldo −42.
  const current = { ...base, kosten: 4200, btwVoorbelasting: 882, btwSaldo: 1218 };
  const d = computeFilingDivergence(base, current);
  check("changed is true", d.changed === true);
  check("btwSaldoDelta = −42", d.btwSaldoDelta === -42);
  check("voorbelasting delta = +42", d.btwVoorbelastingDelta === 42);
  check("kosten delta = +200", d.kostenDelta === 200);
  check("NOT a suppletie (≤ €1.000)", d.needsSuppletie === false);
}

console.log("— large change (> €1.000) → suppletie required —");
{
  // A forgotten €6.000 sales invoice surfaces after filing: verschuldigd +1260, saldo +1260.
  const current = { ...base, omzet: 16000, btwVerschuldigd: 3360, btwSaldo: 2520 };
  const d = computeFilingDivergence(base, current);
  check("changed is true", d.changed === true);
  check("btwSaldoDelta = +1260", d.btwSaldoDelta === 1260);
  check("needsSuppletie true (> €1.000)", d.needsSuppletie === true);
}

console.log("— exactly at the threshold is NOT a suppletie (rule is 'more than') —");
{
  const current = { ...base, btwSaldo: base.btwSaldo + SUPPLETIE_THRESHOLD };
  const d = computeFilingDivergence(base, current);
  check("delta = 1000", d.btwSaldoDelta === 1000);
  check("exactly €1.000 → no suppletie", d.needsSuppletie === false);
  const over = computeFilingDivergence(base, { ...base, btwSaldo: base.btwSaldo + 1000.01 });
  check("€1.000,01 → suppletie", over.needsSuppletie === true);
}

// [DIVERGENCE-SPLIT] `changed` is the OR of five deltas, so it is true in cases where the BTW did
// not move at all. The waarheid banner used to read `changed` and then narrate the BTW regardless,
// which produced "de BTW is met € 0,00 gestegen (je moet meer betalen)". btwChanged /
// resultaatChanged exist so a caller can tell the three cases apart; these lock that behaviour in.
console.log("— a late 0%-BTW cost invoice: the result moves, the BTW does not —");
{
  // Verzekering/OV: €300 cost, no reclaimable BTW. kosten +300, every BTW figure unchanged.
  const d = computeFilingDivergence(base, { ...base, kosten: base.kosten + 300 });
  check("flagged as changed", d.changed === true);
  check("btwChanged is FALSE — nothing to correct at the Belastingdienst", d.btwChanged === false);
  check("btwSaldoDelta is exactly 0", d.btwSaldoDelta === 0);
  check("resultaatChanged is TRUE", d.resultaatChanged === true);
  check("resultaatDelta = −300 (more cost, less profit)", d.resultaatDelta === -300);
  check("no suppletie for a move that never touched the BTW", d.needsSuppletie === false);
}

console.log("— verschuldigd and voorbelasting move equally: saldo and result both unchanged —");
{
  // A €1.000 ex purchase re-booked as a €1.000 ex sale correction: both BTW legs +210, saldo flat.
  const current = {
    ...base,
    btwVerschuldigd: base.btwVerschuldigd + 210,
    btwVoorbelasting: base.btwVoorbelasting + 210,
  };
  const d = computeFilingDivergence(base, current);
  check("components moved → changed", d.changed === true);
  check("btwChanged is FALSE (saldo is flat)", d.btwChanged === false);
  check("resultaatChanged is FALSE (omzet/kosten untouched)", d.resultaatChanged === false);
}

console.log("— a real BTW move still reports both stories —");
{
  // A €2.000 ex sale booked late: omzet +2000, verschuldigd +420, saldo +420.
  const current = {
    ...base, omzet: base.omzet + 2000,
    btwVerschuldigd: base.btwVerschuldigd + 420, btwSaldo: base.btwSaldo + 420,
  };
  const d = computeFilingDivergence(base, current);
  check("btwChanged is TRUE", d.btwChanged === true);
  check("btwSaldoDelta = +420 (you owe more)", d.btwSaldoDelta === 420);
  check("resultaatChanged is TRUE", d.resultaatChanged === true);
  check("resultaatDelta = +2000", d.resultaatDelta === 2000);
}

console.log("— sub-cent noise never trips either flag —");
{
  const d = computeFilingDivergence(base, { ...base, omzet: base.omzet + 0.004, btwSaldo: base.btwSaldo + 0.004 });
  check("btwChanged false on noise", d.btwChanged === false);
  check("resultaatChanged false on noise", d.resultaatChanged === false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
