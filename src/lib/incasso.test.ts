// [WIK] Pure node test — run: npx tsx src/lib/incasso.test.ts
import {
  aggregateWikClaims,
  incassokosten,
  debtorTypeOf,
  wikDeadline,
  addDaysIso,
  buildWikNotice,
  isFinalTier,
  INCASSO_MIN_EUR,
  INCASSO_MAX_EUR,
  WIK_TERM_DAYS,
} from "./incasso";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— the staffel of the Besluit BIK —");
{
  // 15% over the first €2.500 — but never below the €40 floor.
  check("€100 → the €40 minimum, not €15", incassokosten(100) === 40);
  check("€200 → still the minimum", incassokosten(200) === 40);
  check("€266,67 is roughly where 15% overtakes the floor", incassokosten(300) === 45);
  check("€1.000 → €150", incassokosten(1000) === 150);
  check("€2.500 → €375 (the first band in full)", incassokosten(2500) === 375);
  // + 10% over the next €2.500
  check("€5.000 → €625", incassokosten(5000) === 625);
  // + 5% over the next €5.000
  check("€10.000 → €875", incassokosten(10000) === 875);
  // + 1% over the next €190.000
  check("€200.000 → €2.775", incassokosten(200000) === 2775);
  // + 0,5% over the rest, capped
  check("€1.000.000 → the €6.775 ceiling", incassokosten(1000000) === INCASSO_MAX_EUR);
  check("the ceiling is never exceeded", incassokosten(50000000) === INCASSO_MAX_EUR);
  check("the floor is the legal €40", INCASSO_MIN_EUR === 40);
}
{
  check("nothing owed → nothing to collect (never a €40 claim on €0)", incassokosten(0) === 0);
  check("a negative principal claims nothing", incassokosten(-500) === 0);
  check("junk claims nothing", incassokosten(Number.NaN) === 0);
  check("cents are respected", incassokosten(1000.5) === 150.08);
}

console.log("\n— consumer or business: the safe default —");
{
  check("a BTW number means a business", debtorTypeOf({ client_btw_number: "NL123456789B01" }) === "business");
  check("no BTW number means a consumer", debtorTypeOf({ client_btw_number: null }) === "consumer");
  check("blank counts as none", debtorTypeOf({ client_btw_number: "   " }) === "consumer");
  check("absent counts as none", debtorTypeOf({}) === "consumer");
  // The asymmetry is deliberate: a business receiving the letter loses nothing, a consumer NOT
  // receiving it costs the owner the entire right to collection costs.
}

console.log("\n— the fourteen-day term —");
{
  check("the term is granted with a day to spare", WIK_TERM_DAYS === 15);
  check("a letter sent 1 May runs to 16 May", wikDeadline("2026-05-01") === "2026-05-16");
  check("it crosses a month boundary", wikDeadline("2026-05-20") === "2026-06-04");
  check("it crosses a year boundary", wikDeadline("2026-12-25") === "2027-01-09");
  check("a leap day is handled", addDaysIso("2028-02-28", 1) === "2028-02-29");
  check("junk in, junk out — never a wrong date", wikDeadline("not-a-date") === "not-a-date");
}

console.log("\n— the letter itself —");
{
  const n = buildWikNotice({ openstaand: 1210, sentIso: "2026-05-01", debtorType: "consumer" });
  check("a notice is produced", n !== null);
  check("the principal is what is STILL owed", n?.principal === 1210);
  check("the costs follow the staffel", n?.costs === incassokosten(1210));
  check("the deadline is the statutory one", n?.deadline === "2026-05-16");
  // The two things the law requires the letter to contain, literally.
  check("it names the exact amount of the costs", (n?.sentence ?? "").includes("181,50"));
  check("it names the deadline date", /16 mei 2026/.test(n?.sentence ?? ""));
  check("it names the fourteen-day term", /veertien dagen/.test(n?.sentence ?? ""));
  check("it names the open amount", (n?.sentence ?? "").includes("1.210,00"));
}
{
  const b = buildWikNotice({ openstaand: 1210, sentIso: "2026-05-01", debtorType: "business" });
  check("a business letter cites handelsrente", /handelsrente/.test(b?.sentence ?? ""));
  check("...and still names the exact costs", (b?.sentence ?? "").includes("181,50"));
  const c = buildWikNotice({ openstaand: 1210, sentIso: "2026-05-01", debtorType: "consumer" });
  check("a consumer letter cites the plain wettelijke rente", /wettelijke rente/.test(c?.sentence ?? ""));
}
{
  // No figure is printed for interest — the rate changes twice a year and a stale percentage in
  // a letter to a third party is exactly the wrong number this app refuses to send.
  const n = buildWikNotice({ openstaand: 1210, sentIso: "2026-05-01", debtorType: "business" });
  check("no interest PERCENTAGE is claimed", !/%/.test(n?.sentence ?? ""));
}
{
  check("nothing owed → no letter", buildWikNotice({ openstaand: 0, sentIso: "2026-05-01", debtorType: "consumer" }) === null);
  check("a negative balance → no letter", buildWikNotice({ openstaand: -5, sentIso: "2026-05-01", debtorType: "consumer" }) === null);
}

console.log("\n— only the FINAL reminder carries it —");
{
  check("the last configured tier is the letter", isFinalTier(30, [7, 14, 30]) === true);
  check("an earlier tier stays a friendly reminder", isFinalTier(14, [7, 14, 30]) === false);
  check("order does not matter", isFinalTier(30, [30, 7, 14]) === true);
  check("duplicates do not matter", isFinalTier(30, [7, 30, 30]) === true);
  check("a single-tier schedule is its own final", isFinalTier(7, [7]) === true);
  check("an empty schedule has no final tier", isFinalTier(7, []) === false);
  check("junk offsets are ignored", isFinalTier(30, [7, 30, -1, 0, 2.5]) === true);
}

console.log("\n— [WIK-EEN-AANMANING] one aanmaning per debtor, not per invoice —");
{
  // Art. 6:96 lid 7 BW: where a debtor can be aanmaand for several claims — from one agreement or
  // from more than one — that happens in ONE aanmaning, with the hoofdsommen added together, and
  // the staffel of lid 6 (EUR 40 minimum) applied once. A letter per invoice does not merely
  // repeat itself, it CHARGES more, and for a consumer lid 5 makes that dwingend recht.
  const drieHonderd = aggregateWikClaims([
    { invoiceNumber: "2026-001", open: 100 },
    { invoiceNumber: "2026-002", open: 100 },
    { invoiceNumber: "2026-003", open: 100 },
  ]);
  check("three claims become one hoofdsom", drieHonderd.principal === 300);
  check("…and the fee is charged once: EUR 45, not 3 x EUR 40", incassokosten(drieHonderd.principal) === 45);
  check("the old per-invoice answer really was EUR 120", 3 * incassokosten(100) === 120);

  // The degressive half of the staffel, where the difference runs the other way.
  const drieDuizend = aggregateWikClaims([
    { invoiceNumber: "A", open: 1000 }, { invoiceNumber: "B", open: 1000 }, { invoiceNumber: "C", open: 1000 },
  ]);
  check("EUR 3.000 together is EUR 425", incassokosten(drieDuizend.principal) === 425);
  check("…where per invoice it was EUR 450", 3 * incassokosten(1000) === 450);

  // The letter has to NAME the claims it adds up: a demand for a total the reader cannot
  // reconcile with any invoice they hold is the demand they take to a judge.
  const brief = buildWikNotice({ openstaand: drieHonderd.principal, sentIso: "2026-08-16",
    debtorType: "consumer", covers: drieHonderd.numbers })!;
  check("the letter names the total", /€\s*300,00/.test(brief.sentence));
  check("…the single fee", /€\s*45,00/.test(brief.sentence));
  check("…and every invoice it covers", /2026-001, 2026-002, 2026-003/.test(brief.sentence));
  check("the fourteen-day term is untouched", /veertien dagen/.test(brief.sentence));

  // ONE claim must read exactly as it always did — no sentence about other invoices.
  const een = buildWikNotice({ openstaand: 100, sentIso: "2026-08-16", debtorType: "consumer" })!;
  check("a single claim says nothing about other invoices", !/betreft de facturen/.test(een.sentence));
  check("…and still carries its own EUR 40", een.costs === 40);
  check("passing an empty covers changes nothing",
    buildWikNotice({ openstaand: 100, sentIso: "2026-08-16", debtorType: "consumer", covers: [] })!.sentence === een.sentence);

  // Only what is really owed counts — a paid-off or credited invoice is not a claim.
  const metNul = aggregateWikClaims([
    { invoiceNumber: "X", open: 250 }, { invoiceNumber: "Y", open: 0 }, { invoiceNumber: "Z", open: -10 },
  ]);
  check("a settled invoice is not a claim", metNul.principal === 250 && metNul.numbers.length === 1);
  check("nothing owed is no hoofdsom at all", aggregateWikClaims([]).principal === 0);

  // [HANDELSRENTE] Art. 6:119a lid 1 BW runs from the day AFTER the last day of payment.
  const zakelijk = buildWikNotice({ openstaand: 1000, sentIso: "2026-08-16", debtorType: "business" })!;
  check("handelsrente starts the day after the vervaldatum", /dag na de vervaldatum/.test(zakelijk.sentence));
  check("…and the consumer letter still names no start date", !/vervaldatum/.test(een.sentence));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
