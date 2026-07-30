// [STATEMENT-CONTINUITY] Pure node test — run: npx tsx src/lib/bank-statement-continuity.test.ts
// Een ontbrekende maand bankgeschiedenis is onzichtbaar: beide bestanden die je WEL hebt kloppen
// perfect. Deze tests pinnen vast dat we hem toch vinden — én dat we niet gaan roepen bij een
// naadloze reeks, want een vals gat stuurt de eigenaar naar zijn bank voor niets.
import { findStatementGaps, summarizeContinuity, type StatementPeriod } from "./bank-statement-continuity";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const st = (over: Partial<StatementPeriod> = {}): StatementPeriod => ({
  documentId: "doc-1",
  iban: "NL91ABNA0417164300",
  from: "2026-01-01",
  to: "2026-01-31",
  opening: 1000,
  closing: 1500,
  ...over,
});

console.log("\n[STATEMENT-CONTINUITY] de vergeten maand");
{
  const r = findStatementGaps([
    st({ documentId: "a", from: "2026-01-01", to: "2026-01-31", opening: 1000, closing: 1500 }),
    st({ documentId: "c", from: "2026-03-01", to: "2026-03-31", opening: 1800, closing: 2000 }),
  ]);
  check("februari wordt gemeld", r.issues.length === 1 && r.issues[0].kind === "date_gap");
  check("met de exacte ontbrekende periode",
    r.issues[0].missingFrom === "2026-02-01" && r.issues[0].missingTo === "2026-02-28");
  check("en het aantal dagen", r.issues[0].missingDays === 28);
  check("de zin noemt de periode in NL-notatie", /1-2-2026/.test(r.issues[0].message));
}

console.log("\n[STATEMENT-CONTINUITY] naadloos = stil");
{
  const r = findStatementGaps([
    st({ documentId: "a", from: "2026-01-01", to: "2026-01-31", opening: 1000, closing: 1500 }),
    st({ documentId: "b", from: "2026-02-01", to: "2026-02-28", opening: 1500, closing: 1800 }),
    st({ documentId: "c", from: "2026-03-01", to: "2026-03-31", opening: 1800, closing: 2000 }),
  ]);
  check("een aansluitende reeks geeft geen enkele melding", r.issues.length === 0);
  check("de samenvatting bevestigt dat rustig", /sluiten op elkaar aan/.test(summarizeContinuity(r)));
}

console.log("\n[STATEMENT-CONTINUITY] saldobreuk terwijl de datums kloppen");
{
  const r = findStatementGaps([
    st({ documentId: "a", from: "2026-01-01", to: "2026-01-31", opening: 1000, closing: 1500 }),
    st({ documentId: "b", from: "2026-02-01", to: "2026-02-28", opening: 1980.15, closing: 2100 }),
  ]);
  check("het verschil in saldo wordt gevonden", r.issues.length === 1 && r.issues[0].kind === "balance_break");
  check("met het bedrag erbij", r.issues[0].difference === -480.15);
  check("de zin noemt beide saldi", /1\.500,00/.test(r.issues[0].message) && /1\.980,15/.test(r.issues[0].message));
}
{
  const r = findStatementGaps([
    st({ documentId: "a", closing: 1500 }),
    st({ documentId: "b", from: "2026-02-01", to: "2026-02-28", opening: 1500.004, closing: 1800 }),
  ]);
  check("een afrondingsverschil van een halve cent is geen breuk", r.issues.length === 0);
}

console.log("\n[STATEMENT-CONTINUITY] geen saldi in het bestand");
{
  const r = findStatementGaps([
    st({ documentId: "a", opening: null, closing: null }),
    st({ documentId: "b", from: "2026-02-01", to: "2026-02-28", opening: null, closing: null }),
  ]);
  check("zonder saldi geen saldomelding", r.issues.length === 0);
  check("…en we zeggen eerlijk dat dat deel niet gecontroleerd is", r.balancesKnown === false);
  check("de samenvatting claimt dan geen volledigheid", /niet controleren/.test(summarizeContinuity(r)));
}

console.log("\n[STATEMENT-CONTINUITY] twee rekeningen door elkaar");
{
  const r = findStatementGaps([
    st({ documentId: "a", iban: "NL11AAAA0000000001", from: "2026-01-01", to: "2026-01-31", opening: 100, closing: 200 }),
    st({ documentId: "b", iban: "NL22BBBB0000000002", from: "2026-01-01", to: "2026-01-31", opening: 900, closing: 950 }),
  ]);
  check("twee rekeningen naast elkaar zijn geen gat en geen breuk", r.issues.length === 0);
  check("beide rekeningen worden geteld", r.accounts === 2);
}
{
  const r = findStatementGaps([
    st({ documentId: "a", iban: "NL11AAAA0000000001", from: "2026-01-01", to: "2026-01-31", closing: 200 }),
    st({ documentId: "b", iban: "NL11AAAA0000000001", from: "2026-03-01", to: "2026-03-31", opening: 260 }),
    st({ documentId: "c", iban: "NL22BBBB0000000002", from: "2026-01-01", to: "2026-03-31", opening: 900, closing: 950 }),
  ]);
  check("het gat wordt aan de juiste rekening gehangen",
    r.issues.length === 1 && r.issues[0].iban === "NL11AAAA0000000001");
  check("de zin noemt die rekening", /NL11AAAA0000000001/.test(r.issues[0].message));
}

console.log("\n[STATEMENT-CONTINUITY] overlap");
{
  const r = findStatementGaps([
    st({ documentId: "a", from: "2026-01-01", to: "2026-01-31" }),
    st({ documentId: "b", from: "2026-01-15", to: "2026-02-15" }),
  ]);
  check("dezelfde dagen twee keer ingelezen wordt gemeld", r.issues.length === 1 && r.issues[0].kind === "overlap");
  check("…als 'controleer op dubbel', niet als ontbrekend", /dubbel/.test(r.issues[0].message));
}

console.log("\n[STATEMENT-CONTINUITY] robuustheid");
{
  const r = findStatementGaps([]);
  check("geen afschriften → geen meldingen, geen claims", r.issues.length === 0 && r.accounts === 0);
  check("de samenvatting zegt dat er nog niets is", /Nog geen bankafschriften/.test(summarizeContinuity(r)));
}
{
  const r = findStatementGaps([
    st({ documentId: "a", from: "kapot" as string, to: "2026-01-31" }),
    st({ documentId: "b", from: "2026-03-01", to: "2026-03-31" }),
  ]);
  check("een afschrift zonder leesbare periode doet niet mee (en veroorzaakt dus geen vals gat)",
    r.issues.length === 0);
}
{
  // Eén dag ertussen (weekendknip in de export) — bewust géén melding waard.
  const r = findStatementGaps([
    st({ documentId: "a", from: "2026-01-01", to: "2026-01-30", closing: 1500 }),
    st({ documentId: "b", from: "2026-02-01", to: "2026-02-28", opening: 1500 }),
  ]);
  check("één ontbrekende dag meldt wél (maxGapDays=1 default)", r.issues.length === 1);
  const r2 = findStatementGaps(
    [
      st({ documentId: "a", from: "2026-01-01", to: "2026-01-30", closing: 1500 }),
      st({ documentId: "b", from: "2026-02-01", to: "2026-02-28", opening: 1500 }),
    ],
    { maxGapDays: 3 },
  );
  check("…en zwijgt bij een ruimere drempel", r2.issues.length === 0);
}
{
  const r = findStatementGaps([
    st({ documentId: "a", from: "2026-01-01", to: "2026-01-31", closing: 1500 }),
    st({ documentId: "b", from: "2026-03-01", to: "2026-03-31", opening: 9999 }),
  ]);
  check("een gat meldt één keer, niet ook nog als saldobreuk", r.issues.length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
