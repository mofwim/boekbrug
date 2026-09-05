// src/lib/year-standing.test.ts — run: npx tsx src/lib/year-standing.test.ts
// [JAARSTAND] Four verdicts → four lines. The cases are the live administration's own.
import { yearStanding, blockedCount, yearNeedsAttention, type QuarterAnswer } from "./year-standing";

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) {
    console.error(`FAIL ${name}`);
    failed++;
  } else {
    console.log(`ok   ${name}`);
  }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(`${name}${g === w ? "" : `  (got ${g}, want ${w})`}`, g === w);
}

const geenTarief = {
  title: "€172.081,57 omzet zonder BTW-tarief",
  fix: { label: "Naar Dagomzet", href: "/dashboard/dagomzet" },
};

/** Q1 and Q3 of the live administration: card money on the bank, no till days. */
const blokkerend = (q: 1 | 2 | 3 | 4): QuarterAnswer => ({
  quarter: q,
  report: { quarterLabel: `Q${q} 2026`, status: "attention", ready: false, missing: [geenTarief] },
});
const klaar = (q: 1 | 2 | 3 | 4): QuarterAnswer => ({
  quarter: q,
  report: { quarterLabel: `Q${q} 2026`, status: "ready", ready: true, missing: [] },
});

// ── The year as it actually stands ────────────────────────────────────────────
{
  const jaar = yearStanding(
    [blokkerend(1), klaar(2), blokkerend(3), { quarter: 4, report: null, running: true }],
    2026,
  );
  eq("vier regels, in kalendervolgorde", jaar.map((r) => r.quarter), [1, 2, 3, 4]);
  eq("Q1 blokkeert", jaar[0].state, "blokkeert");
  eq("en noemt de reden woordelijk", jaar[0].reason, geenTarief.title);
  eq("met de plek waar het opgelost wordt", jaar[0].fix?.href, "/dashboard/dagomzet");
  eq("Q2 is klaar", jaar[1].state, "klaar");
  eq("een klaar kwartaal noemt geen reden", jaar[1].reason, null);
  eq("Q3 blokkeert ook", jaar[2].state, "blokkeert");
  eq("Q4 loopt nog", jaar[3].state, "loopt");
  eq("twee kwartalen staan open", blockedCount(jaar), 2);
  check("dit jaar vraagt aandacht", yearNeedsAttention(jaar));
}

// ── [NO-SILENT-EMPTY] A quarter we could not read ─────────────────────────────
{
  const jaar = yearStanding([klaar(1), { quarter: 2, report: null }, klaar(3), klaar(4)], 2026);
  eq("een mislukte lezing is onbekend", jaar[1].state, "onbekend");
  check("en NOOIT klaar", jaar[1].state !== "klaar");
  eq("hij krijgt wel een leesbaar label", jaar[1].label, "Q2 2026");
  check("een onbekend kwartaal vraagt aandacht", yearNeedsAttention(jaar));
  eq("maar telt niet als geblokkeerd — dat zou een verdict zijn dat we niet hebben", blockedCount(jaar), 0);
}
{
  const jaar = yearStanding([klaar(1), klaar(3)], 2026);
  eq("een kwartaal dat helemaal niet in het antwoord zit is ook onbekend", jaar[1].state, "onbekend");
  eq("en krijgt het afgeleide label", jaar[1].label, "Q2 2026");
  eq("er komen altijd precies vier regels terug", jaar.length, 4);
}

// ── Filed wins ────────────────────────────────────────────────────────────────
{
  const jaar = yearStanding(
    [{ quarter: 1, report: { quarterLabel: "Q1 2026", status: "attention", ready: false, missing: [geenTarief] }, filed: true },
     klaar(2), klaar(3), klaar(4)],
    2026,
  );
  eq("een ingediend kwartaal is ingediend, niet geblokkeerd", jaar[0].state, "ingediend");
  eq("en nodigt niet uit om een verstuurde aangifte te 'repareren'", jaar[0].reason, null);
}
{
  const jaar = yearStanding([{ quarter: 1, report: null, filed: true }, klaar(2), klaar(3), klaar(4)], 2026);
  eq("ingediend zonder verdict blijft ingediend, niet onbekend", jaar[0].state, "ingediend");
  check("en zo'n jaar vraagt geen aandacht", !yearNeedsAttention(jaar));
}

// ── A quiet year says nothing ─────────────────────────────────────────────────
{
  const jaar = yearStanding([klaar(1), klaar(2), klaar(3), klaar(4)], 2026);
  check("een jaar zonder problemen vraagt geen aandacht", !yearNeedsAttention(jaar));
  eq("en telt nul blokkades", blockedCount(jaar), 0);
}

// ── [NEGATIEVE CONTROLE] ──────────────────────────────────────────────────────
// Every assertion above also passes if the function labels everything "blokkeert", or if
// yearNeedsAttention always returns true. These are the ones that catch that.
{
  const alles = yearStanding([klaar(1), klaar(2), klaar(3), klaar(4)], 2026);
  check("een klaar jaar levert geen enkele blokkade op", alles.every((r) => r.state === "klaar"));
  const eenBlok = yearStanding([blokkerend(1), klaar(2), klaar(3), klaar(4)], 2026);
  eq("één blokkade telt als één, niet als vier", blockedCount(eenBlok), 1);
  check("en het onderscheid tussen de twee jaren is echt",
    yearNeedsAttention(eenBlok) && !yearNeedsAttention(alles));
}
// A not-ready quarter with an EMPTY missing list still blocks — it is not ready, and saying
// "klaar" because we have no sentence for it would be the silent-empty failure again.
{
  const jaar = yearStanding(
    [{ quarter: 1, report: { quarterLabel: "Q1 2026", status: "almost", ready: false, missing: [] } }, klaar(2), klaar(3), klaar(4)],
    2026,
  );
  eq("niet klaar zonder reden blokkeert nog steeds", jaar[0].state, "blokkeert");
  eq("en zegt eerlijk dat er geen zin bij zit", jaar[0].reason, null);
}
// And the mirror: ready:true with a gap still on the list must not read as finished.
{
  const jaar = yearStanding(
    [{ quarter: 1, report: { quarterLabel: "Q1 2026", status: "ready", ready: true, missing: [geenTarief] } }, klaar(2), klaar(3), klaar(4)],
    2026,
  );
  eq("klaar mét een openstaand gat is niet klaar", jaar[0].state, "blokkeert");
}

console.log(failed === 0 ? "\nyear-standing: all green" : `\nyear-standing: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
