// src/lib/nl-plural.test.ts — run: npx tsx src/lib/nl-plural.test.ts
// [MEERVOUD] The sentences that used to read "1 factu(u)r(en)".
import { meervoudUur, telWoord, woordBij, vervoeg } from "./nl-plural";

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
  check(`${name}  (got ${JSON.stringify(got)})`, got === want);
}

// ── The rule ──────────────────────────────────────────────────────────────────
eq("factuur -> facturen", meervoudUur("factuur"), "facturen");
eq("the doubled u collapses, it is not 'factuuren'", meervoudUur("factuur"), "facturen");
eq("a compound follows the same rule", meervoudUur("inkoopfactuur"), "inkoopfacturen");
eq("and so does the other one", meervoudUur("verkoopfactuur"), "verkoopfacturen");
eq("a word this app does not use today still works", meervoudUur("natuur"), "naturen");
eq("case is not lost", meervoudUur("Factuur"), "Facturen");

// A phrase pluralises on its tail, which is what the call sites hand it.
eq("an adjective in front rides along", meervoudUur("betaalde factuur"), "betaalde facturen");
eq("two words in front ride along", meervoudUur("geverifieerde inkoopfactuur"), "geverifieerde inkoopfacturen");

// [NEGATIEVE CONTROLE] The rule must NOT fire on a word that does not end in -uur, or it would
// silently mangle every other noun a caller passes.
eq("a word not ending in -uur is returned untouched", meervoudUur("klant"), "klant");
eq("a word merely CONTAINING uur is untouched", meervoudUur("uurtarief"), "uurtarief");
eq("the empty string is untouched", meervoudUur(""), "");

// ── Counting ──────────────────────────────────────────────────────────────────
eq("1 is singular", telWoord(1, "factuur"), "1 factuur");
eq("2 is plural", telWoord(2, "factuur"), "2 facturen");
eq("the real notification title, n=1", telWoord(1, "factuur"), "1 factuur");
eq("the real notification title, n=3", telWoord(3, "factuur"), "3 facturen");
eq("the phrase form used by the BTW blockers", telWoord(1, "betaalde factuur"), "1 betaalde factuur");
eq("and its plural", telWoord(4, "betaalde factuur"), "4 betaalde facturen");

// 0 is plural in Dutch ("0 facturen"), the same as every other number that is not 1.
eq("0 is plural", telWoord(0, "factuur"), "0 facturen");

// The count is printed exactly as handed over — see the header. A wrong number must LOOK wrong.
eq("a negative count is not repaired into a singular", telWoord(-1, "factuur"), "-1 facturen");

// ── A noun the -uur rule cannot reach: the caller spells the plural ───────────
// These are exactly the words that made the rule-only version wrong, and each is a real call site.
eq("dag has a doubled consonant", telWoord(3, "dag", "dagen"), "3 dagen");
eq("rij keeps its j", telWoord(2, "rij", "rijen"), "2 rijen");
eq("regel takes -s, not -en", telWoord(4, "regel", "regels"), "4 regels");
eq("bestand takes -en", telWoord(2, "bestand", "bestanden"), "2 bestanden");
eq("betaaldatum is a Latin stem", telWoord(2, "betaaldatum", "betaaldata"), "2 betaaldata");
eq("and the singular still wins at 1", telWoord(1, "betaaldatum", "betaaldata"), "1 betaaldatum");

// [NEGATIEVE CONTROLE] The spelled plural must be USED, not quietly ignored in favour of the rule.
// Without this, telWoord(2, "dag", "dagen") returning "2 dag" would pass every other assertion
// about words that do not end in -uur, because the rule leaves them untouched.
eq("the spelled plural beats the -uur rule", telWoord(2, "factuur", "FACTUURTJES"), "2 FACTUURTJES");
check("the spelled plural is not appended to the rule's output",
  telWoord(2, "dag", "dagen") === "2 dagen" && telWoord(2, "dag", "dagen") !== "2 dag");

// ── The bare noun, for a sentence that printed the number itself ──────────────
eq("woordBij at 1", woordBij(1, "verkoopfactuur"), "verkoopfactuur");
eq("woordBij at 7", woordBij(7, "verkoopfactuur"), "verkoopfacturen");

// ── Verb agreement ────────────────────────────────────────────────────────────
eq("vervoeg picks the singular at 1", vervoeg(1, "heeft", "hebben"), "heeft");
eq("vervoeg picks the plural at 2", vervoeg(2, "heeft", "hebben"), "hebben");
eq("vervoeg picks the plural at 0", vervoeg(0, "staat", "staan"), "staan");

// ── The whole sentence, as the owner reads it ─────────────────────────────────
// This is the line from the screenshot that started this: the bell said
// "1 factu(u)r(en) automatisch afgeschreven".
eq(
  "the notification title reads as Dutch at n=1",
  `${telWoord(1, "factuur")} automatisch afgeschreven`,
  "1 factuur automatisch afgeschreven",
);
eq(
  "and at n=5",
  `${telWoord(5, "factuur")} automatisch afgeschreven`,
  "5 facturen automatisch afgeschreven",
);
eq(
  "a BTW blocker reads as Dutch at n=1",
  `${telWoord(1, "bevestigde factuur")} ${vervoeg(1, "heeft", "hebben")} geen datum en ${vervoeg(1, "telt", "tellen")} niet mee in dit kwartaal`,
  "1 bevestigde factuur heeft geen datum en telt niet mee in dit kwartaal",
);
eq(
  "and at n=12",
  `${telWoord(12, "bevestigde factuur")} ${vervoeg(12, "heeft", "hebben")} geen datum en ${vervoeg(12, "telt", "tellen")} niet mee in dit kwartaal`,
  "12 bevestigde facturen hebben geen datum en tellen niet mee in dit kwartaal",
);

console.log(failed === 0 ? "\nnl-plural: all green" : `\nnl-plural: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
