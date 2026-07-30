// [BANK-IGNORE-REDEN] Pure node test — run: npx tsx src/lib/bank-ignore-reason.test.ts
import {
  BANK_IGNORE_REASONS,
  BANK_IGNORE_REASON_LABELS,
  toBankIgnoreReason,
  bankIgnoreReasonLabel,
} from "./bank-ignore-reason";
import { readFileSync } from "node:fs";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— the vocabulary the database will actually accept —");
{
  // The CHECK constraint in bank_ignore_reason.sql is the real gatekeeper. If this list and that
  // constraint ever disagree, the owner taps a reason and gets a 500 instead of an ignored line —
  // so read the migration and compare, rather than trusting that both were edited together.
  const sql = readFileSync("supabase/migrations/bank_ignore_reason.sql", "utf8");
  const inCheck = [...sql.matchAll(/^\s*'([a-z_]+)',?\s*(?:--.*)?$/gm)].map((m) => m[1]);
  const missing = BANK_IGNORE_REASONS.filter((r) => !inCheck.includes(r));
  const extra = inCheck.filter((r) => !(BANK_IGNORE_REASONS as readonly string[]).includes(r));
  check(`every code reason is in the CHECK constraint${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}`, missing.length === 0);
  check(`the CHECK constraint has no reason the code cannot produce${extra.length ? " (extra: " + extra.join(", ") + ")" : ""}`, extra.length === 0);
}

console.log("\n— every reason is presentable, and says something different —");
{
  check("all five have a label and a hint", BANK_IGNORE_REASONS.every((r) => {
    const e = BANK_IGNORE_REASON_LABELS[r];
    return e && e.label.length > 0 && e.hint.length > 0;
  }));
  const labels = BANK_IGNORE_REASONS.map((r) => BANK_IGNORE_REASON_LABELS[r].label);
  check("no two reasons read the same", new Set(labels).size === labels.length);
}

console.log("\n— a bad value never becomes a stored value —");
{
  // The reason is a note. Losing it must never block the ignore itself, so anything unusable
  // becomes null rather than an error or a guess.
  check("a known reason passes", toBankIgnoreReason("prive") === "prive");
  check("an unknown string → null", toBankIgnoreReason("verzonnen") === null);
  check("empty string → null", toBankIgnoreReason("") === null);
  check("null → null", toBankIgnoreReason(null) === null);
  check("undefined → null", toBankIgnoreReason(undefined) === null);
  check("a number → null", toBankIgnoreReason(42) === null);
  check("an object → null", toBankIgnoreReason({ reason: "prive" }) === null);
  // Case matters: the CHECK constraint is case-sensitive, so 'Prive' would be rejected by
  // Postgres. Catching it here keeps that from turning into a 500.
  check("wrong casing → null, not a database error", toBankIgnoreReason("Prive") === null);
}

console.log("\n— the label for the Genegeerd list —");
{
  check("a known reason gets its label", bankIgnoreReasonLabel("dubbel") === "Dubbel");
  check("an old row without a reason shows nothing", bankIgnoreReasonLabel(null) === null);
  check("a value from a future version shows nothing rather than raw text", bankIgnoreReasonLabel("iets_nieuws") === null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
