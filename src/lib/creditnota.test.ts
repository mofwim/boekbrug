// [CREDITNOTA-REF] Pure node test — run: npx tsx src/lib/creditnota.test.ts
import { creditnotaReferenceLine } from "./creditnota";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— art. 219: specifically and unambiguously —");
{
  const line = creditnotaReferenceLine({ originalNumber: "2026-041", originalDate: "2026-03-14" })!;
  check("it names the invoice being corrected", /2026-041/.test(line));
  check("…and the date that makes it unambiguous", /14-03-2026/.test(line));
  check("…in Dutch, as a sentence on the document", /^Deze creditnota corrigeert factuur /.test(line));

  check("no date known → still a valid reference on the number alone",
    creditnotaReferenceLine({ originalNumber: "2026-041" }) === "Deze creditnota corrigeert factuur 2026-041.");
}

console.log("\n— what it refuses to say —");
{
  check("no number → NO line, rather than a vague one",
    creditnotaReferenceLine({ originalNumber: null }) === null);
  check("an empty number is not a reference",
    creditnotaReferenceLine({ originalNumber: "   " }) === null);
  check("undefined is handled like absent", creditnotaReferenceLine({ originalNumber: undefined }) === null);
  check("a garbage date is dropped, the number still stands",
    creditnotaReferenceLine({ originalNumber: "2026-041", originalDate: "later" })
      === "Deze creditnota corrigeert factuur 2026-041.");
}

console.log("\n— the date is string surgery, so no timezone can move it —");
{
  const line = creditnotaReferenceLine({ originalNumber: "X", originalDate: "2026-01-01T23:30:00.000Z" })!;
  check("a full timestamp still reads as its own calendar day", /01-01-2026/.test(line));
  check("a date-only value never shifts a day", /31-12-2025/.test(creditnotaReferenceLine({ originalNumber: "X", originalDate: "2025-12-31" })!));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
