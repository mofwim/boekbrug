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
  // [GAP-NAMES] The accountant's mail used to carry the COUNT and nothing else, so four missing
  // PDFs and five missing PDFs sent byte-identical mail to the one reader who could act on the
  // difference. It must name the same gaps the owner's mail names.
  check("gaps accountant body lists them too", /nog te controleren/.test(gaps.accountantBody) && /bankafschrift/.test(gaps.accountantBody));
  check("...and still says how many", /2 aandachtspunt/.test(gaps.accountantBody));
  // Truncation parity: both mails show at most three and then say there is more.
  const many = buildQuarterCloseNotice("Q2 2026", {
    warnings: [{ message: "een" }, { message: "twee" }, { message: "drie" }, { message: "vier" }],
    outgoingCount: 1, incomingCount: 0,
  });
  check("accountant body truncates at three, like the owner's", /een · twee · drie …/.test(many.accountantBody));
  check("...and does not leak the fourth", !/vier/.test(many.accountantBody));
  // A clean quarter must stay a clean sentence — no empty ": " tail.
  check("clean accountant body names no gaps", !/aandachtspunt/.test(clean.accountantBody));

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

// ── [COM-IN-DE-REGEL] The commission finding reaches the one channel that reaches the owner ───
//
// This cron is the only thing in the app that speaks to an owner who never opens it: four times a
// year, to them AND their accountant. A cost the app found and booked, that its owner learns about
// only by visiting a screen, is work nobody will ever know happened.
console.log("\n— the acquirer commission the bank stated itself —");
{
  const base = { warnings: [] as { message: string }[], outgoingCount: 3, incomingCount: 2 };
  const found = { total: 54.02, gross: 2922.21, lines: 22, unverified: 0, booked: true };

  const n = buildQuarterCloseNotice("Q2 2026", { ...base, cardStatedCommission: found });
  check("the owner is told the amount", n.ownerBody.includes("€ 54,02"));
  check("and how many afrekeningen it rests on", n.ownerBody.includes("22 afrekening"));
  // It is a COST. Calling it "gevonden geld" would be the framing MARKTPOSITIE §5 warns against,
  // and a lie about which way it moves the profit.
  check("and which way it moves the profit", n.ownerBody.includes("winst was tot nu toe met dat bedrag te hoog"));
  check("the accountant gets the amount too", n.accountantBody.includes("€ 54,02"));
  // Dutch notation, thousands separator included. This first read "2.922,21 || 2922,21" and so
  // passed against a locally reinvented formatter that dropped the separator — the [CENT] lesson
  // in a smaller key: one money formatter, or two screens quote the same amount differently.
  check("with the gross it came from, in Dutch notation", n.accountantBody.includes("€ 2.922,21"));
  check("and where the evidence sits", n.accountantBody.includes("kaart-reconciliatie.csv"));

  const nb = buildQuarterCloseNotice("Q2 2026", { ...base, cardStatedCommission: { ...found, booked: false } });
  check("a finding that was NOT booked says so to the owner", nb.ownerBody.includes("NIET in je cijfers"));
  check("…and to the accountant", nb.accountantBody.includes("NIET geboekt"));

  const withGap = buildQuarterCloseNotice("Q2 2026", {
    warnings: [{ message: "3 facturen zonder PDF" }], outgoingCount: 3, incomingCount: 2,
    cardStatedCommission: found,
  });
  check("the gap list still leads — the finding is appended, never a replacement", withGap.ownerBody.includes("3 facturen zonder PDF"));
  check("and the finding follows it", withGap.ownerBody.includes("€ 54,02"));

  const plain = buildQuarterCloseNotice("Q2 2026", base);
  check("no finding changes nothing", plain.ownerBody === buildQuarterCloseNotice("Q2 2026", { ...base, cardStatedCommission: null }).ownerBody);
  check("and says nothing about a betaalautomaat", !plain.ownerBody.includes("betaalautomaat"));

  // 91 till days and no invoices — a market or a snackbar. Activity counted invoices only, so this
  // owner AND their accountant were skipped as dormant while a real cost had been found and booked.
  const tillOnly = { warnings: [] as { message: string }[], outgoingCount: 0, incomingCount: 0, cardStatedCommission: found };
  check("a till-only quarter with a booked cost is not dormant", buildQuarterCloseNotice("Q2 2026", tillOnly).empty === false);
  check("a genuinely empty quarter is still skipped (the anti-nag rule is unchanged)",
    buildQuarterCloseNotice("Q2 2026", { warnings: [], outgoingCount: 0, incomingCount: 0 }).empty === true);

  // Three settlements the app could not read is not a finding, and must not wake a dormant quarter.
  const onlyUnreadable = buildQuarterCloseNotice("Q2 2026", {
    warnings: [], outgoingCount: 0, incomingCount: 0,
    cardStatedCommission: { total: 0, gross: 0, lines: 0, unverified: 3, booked: false },
  });
  check("unreadable lines alone do not manufacture activity", onlyUnreadable.empty === true);
  check("nor a sentence", !onlyUnreadable.ownerBody.includes("betaalautomaat"));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
