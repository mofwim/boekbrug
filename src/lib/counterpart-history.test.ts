// [BANK-COUNTERPART-HISTORY] Pure node test — run: npx tsx src/lib/counterpart-history.test.ts
import { counterpartHistory, type HistoryLine } from "./counterpart-history";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const line = (o: Partial<HistoryLine> = {}): HistoryLine => ({
  counterpart_name: "Aardappelgroothandel Altena Bv",
  counterpart_iban: "NL22INGB0001234567",
  category: "kosten",
  ...o,
});

console.log("\n— IBAN is an identity: it wins, and it wins alone —");
{
  const past = [line(), line(), line({ category: "kosten" }), line({ counterpart_iban: "NL99RABO0000000000", category: "prive" })];
  const h = counterpartHistory({ counterpart_name: "ALTENA", counterpart_iban: "NL22 INGB 0001 2345 67" }, past);
  check("found", h !== null);
  check("counts only the three on THIS iban", h?.count === 3);
  check("reports the category the owner chose", h?.topCategory === "kosten");
  check("and says it was matched on iban", h?.matchedBy === "iban");
  // Spacing and case are how a human types an IBAN; they must not split one account into two.
  check("normalises spacing/case", h?.topCount === 3);
  // A different account is a different party, even under a similar name — no dilution.
  const other = counterpartHistory({ counterpart_name: "ALTENA", counterpart_iban: "NL99RABO0000000000" }, past);
  check("a different iban is a different history", other?.count === 1 && other?.topCategory === "prive");
}

console.log("\n— no IBAN on the line → fall back to the shared name key —");
{
  const past = [
    line({ counterpart_iban: null, counterpart_name: "SUMUP *JANSEN", category: "omzet" }),
    line({ counterpart_iban: null, counterpart_name: "Jansen B.V.", category: "omzet" }),
    line({ counterpart_iban: null, counterpart_name: "Totaal Anders", category: "kosten" }),
  ];
  const h = counterpartHistory({ counterpart_name: "JANSEN", counterpart_iban: null }, past);
  check("found by name", h !== null);
  // counterpartKey strips the processor tag and the legal suffix, so all three spellings are
  // one counterpart — that is the whole reason to share the key with counterpart_memory.
  check("processor prefix and legal suffix collapse to one party", h?.count === 2);
  check("says it was matched on the NAME, not an identity", h?.matchedBy === "naam");
  check("an unrelated name is not counted", h?.topCategory === "omzet");
}

console.log("\n— nothing honest to say → null, never a zero —");
{
  check("no identity at all", counterpartHistory({ counterpart_name: null, counterpart_iban: null }, [line()]) === null);
  check("no past lines", counterpartHistory({ counterpart_name: "Altena", counterpart_iban: "NL22INGB0001234567" }, []) === null);
  // The key case: earlier lines exist but nobody ever placed them. Reporting "3 eerdere
  // betalingen" there would answer an open question with three more open questions.
  const undecided = [line({ category: null }), line({ category: null }), line({ category: "" })];
  check("earlier lines exist but none was ever categorised", counterpartHistory({ counterpart_name: "Altena", counterpart_iban: "NL22INGB0001234567" }, undecided) === null);
  check("an iban that matches nothing", counterpartHistory({ counterpart_name: null, counterpart_iban: "NL00BANK0000000000" }, [line()]) === null);
}

console.log("\n— a split history is reported as split, not rounded into certainty —");
{
  const past = [line({ category: "kosten" }), line({ category: "kosten" }), line({ category: "prive" })];
  const h = counterpartHistory({ counterpart_name: "Altena", counterpart_iban: "NL22INGB0001234567" }, past);
  check("count is the whole decided history", h?.count === 3);
  check("topCount is only the majority", h?.topCount === 2);
  // count > topCount is the signal the UI needs to avoid claiming "altijd kosten".
  check("so the UI can see it was not unanimous", (h?.count ?? 0) > (h?.topCount ?? 0));
}

console.log("\n— a tie resolves the same way every time —");
{
  const past = [line({ category: "prive" }), line({ category: "kosten" })];
  const a = counterpartHistory({ counterpart_name: "Altena", counterpart_iban: "NL22INGB0001234567" }, past);
  const b = counterpartHistory({ counterpart_name: "Altena", counterpart_iban: "NL22INGB0001234567" }, [...past].reverse());
  check("input order does not change the answer", a?.topCategory === b?.topCategory);
  check("...and it is not presented as unanimous", a?.count === 2 && a?.topCount === 1);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
