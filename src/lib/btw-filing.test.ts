// [TRUTH-FILED] Pure test for btw-filing.ts — run: npx tsx src/lib/btw-filing.test.ts
import { computeFilingDivergence, decideFilingWrite, SUPPLETIE_THRESHOLD, outstandingCorrection, correctionRoute, type FilingFigures } from "./btw-filing";

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

console.log("— [FILING-NO-OVERWRITE] wat een indiening met een bestaande indiening mag doen —");
{
  // Niets om te vervangen → gewoon wegschrijven. INSERT, niet upsert: dat is wat een tweede
  // tabblad laat verliezen op de unieke sleutel in plaats van er stilletjes overheen te schrijven.
  check("geen bestaande indiening → insert", decideFilingWrite({ hasExisting: false }) === "insert");
  check("…ook als replace meekomt: er valt niets te vervangen",
    decideFilingWrite({ hasExisting: false, replace: true }) === "insert");

  // Bestaat er wel een: dan is de default VRAGEN, nooit overschrijven. Dit is de hele fix.
  check("bestaande indiening zonder replace → vragen", decideFilingWrite({ hasExisting: true }) === "ask");
  check("…replace:false is ook vragen", decideFilingWrite({ hasExisting: true, replace: false }) === "ask");
  check("…en alleen een ECHTE true vervangt (geen truthy waarde)",
    decideFilingWrite({ hasExisting: true, replace: "ja" as unknown as boolean }) === "ask");
  check("expliciet replace:true → vervangen", decideFilingWrite({ hasExisting: true, replace: true }) === "replace");
}


// ── [SUPPLETIE-VERREKEND] What has NOT yet been declared ─────────────────────
//
// A correction of €1.000 or less may go into the next regular aangifte. Once it has, the snapshot
// still differs from the live figures — the snapshot is deliberately never rewritten — so the app
// has to remember that the gap was already reported, or it offers the same correction next quarter
// and the owner declares it twice.

console.log("— outstandingCorrection: what is still owed after what was carried —");
{
  check("nothing carried → the whole delta is outstanding", outstandingCorrection(160, null) === 160);
  check("undefined is the same as nothing", outstandingCorrection(160, undefined) === 160);
  check("fully carried → nothing left", outstandingCorrection(160, 160) === 0);

  // THE CASE THE AMOUNT EXISTS FOR. Booked 1260, corrected to 1100 and carried (−160), then a late
  // invoice takes it to 1050. Still owed: −50. A boolean 'carried' would say nothing is owed.
  check("a SECOND movement after a carry is still owed", outstandingCorrection(-210, -160) === -50);

  // Sign travels: declaring less and then moving further down keeps the direction.
  check("direction survives", outstandingCorrection(-210, -160) < 0);
  check("over-carried is not negative-of-itself", outstandingCorrection(160, 200) === -40);

  // Half a cent may not decide a €1.000 threshold or a printed sentence.
  check("rounded to cents", outstandingCorrection(1000.005, 0) === 1000.01);
  check("nonsense in, zero out", outstandingCorrection(NaN, 0) === 0);
  check("a nonsense carry is treated as no carry", outstandingCorrection(160, NaN) === 160);

  // The route is judged on what REMAINS, never on the history of how it accumulated.
  check("nothing outstanding → no route", correctionRoute(0) === "none");
  check("rounding noise → no route", correctionRoute(0.004) === "none");
  check("under the threshold → carry", correctionRoute(160) === "carry");
  check("exactly €1.000 → carry (the rule is 'more than')", correctionRoute(1000) === "carry");
  check("over → suppletie", correctionRoute(1000.01) === "suppletie");
  check("direction does not change the route", correctionRoute(-1500) === "suppletie");

  // Two movements of €700 never become one suppletie: the first is carried, and the second is
  // judged on what is left, not on the €1.400 the quarter has moved in total.
  check("700 carried, 700 more → still a carry", correctionRoute(outstandingCorrection(1400, 700)) === "carry");
  // …and a €1.400 movement with €900 carried still needs a suppletie for the remaining €500 — no:
  // €500 is under the threshold, so it is a carry. This is the correct answer and worth pinning,
  // because reading the threshold against the TOTAL movement would demand a form for €500.
  check("1400 moved, 900 carried → the remaining 500 is a carry", correctionRoute(outstandingCorrection(1400, 900)) === "carry");
  check("1400 moved, 100 carried → 1300 still needs a suppletie", correctionRoute(outstandingCorrection(1400, 100)) === "suppletie");
}

// The summary and the exit stay LAST. A block appended after process.exit() runs not one line
// and still prints "36 passed" — which is how a test file grows a section nobody notices is dead.
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
