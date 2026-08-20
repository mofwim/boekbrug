// [VAK-BRUG] Pure node test — run: npx tsx src/lib/vak-profile.test.ts
import { parseVak, vakArticleSeeds, vakLetOp, vakLabel, VAK_PARAM } from "./vak-profile";
import { VAKKEN } from "./vak-sjablonen";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— reading a trade from untrusted input —");
check("a known slug survives", parseVak("kapper") === "kapper");
check("every slug the catalogue declares is readable", VAKKEN.every((v) => parseVak(v.slug) === v.slug));
check("case and whitespace are tolerated", parseVak("  Kapper ") === "kapper");
// Not knowing is cheap; guessing wrong prefills another profession's rates.
check("an unknown trade is null, never a guess", parseVak("astronaut") === null);
check("empty input is null", parseVak("") === null && parseVak(null) === null && parseVak(undefined) === null);
check("the querystring parameter is the one /register reads", VAK_PARAM === "vak");

console.log("\n— the lines a trade offers —");
{
  const seeds = vakArticleSeeds("kapper");
  check("a barber gets lines", seeds.length > 0);
  // Rule 1 of vak-sjablonen.ts, carried into the app: a wrongly prefilled amount is worse than an
  // empty field. The seed carries no price at all — there is no field for one.
  check("NO seed carries a price", seeds.every((s) => !("unit_price" in s) && !("price" in s)));
  check("every seed carries a description", seeds.every((s) => s.description.trim().length > 0));
  check("every seed carries a real Dutch rate", seeds.every((s) => [0, 9, 21].includes(s.btw_rate)));
  // articles HAS a unit column, unlike an invoice line — so the unit stays a unit.
  check("the unit stays a unit, not folded into the description",
    seeds.every((s) => typeof s.unit === "string" && s.unit.length > 0 && !s.description.includes("(per ")));
  check("an unknown trade offers nothing", vakArticleSeeds("astronaut").length === 0);
  check("no trade offers an empty list", VAKKEN.every((v) => vakArticleSeeds(v.slug).length > 0));
}

console.log("\n— the warning that travels with the trade —");
{
  // let_op is set exactly on the trades whose rate depends on the situation. Those are the
  // expensive ones, and until now the owner only ever saw it on the public generator.
  const withWarning = VAKKEN.filter((v) => v.let_op);
  check("some trades carry a situational warning", withWarning.length > 0);
  check("each of those warnings is reachable by slug",
    withWarning.every((v) => (vakLetOp(v.slug) ?? "").length > 0));
  check("a trade without one returns null, not an empty string",
    VAKKEN.filter((v) => !v.let_op).every((v) => vakLetOp(v.slug) === null));
  check("an unknown trade has no warning", vakLetOp("astronaut") === null);
}

console.log("\n— naming the trade in a sentence —");
check("a known trade has a label", (vakLabel("kapper") ?? "").length > 0);
check("an unknown one does not", vakLabel("astronaut") === null);

// The whole point of the module: what the visitor typed at the front door reaches the catalogue.
console.log("\n— the journey, end to end —");
{
  const fromUrl = parseVak(new URLSearchParams("?vak=automonteur").get(VAK_PARAM));
  check("a slug on /register?vak= is read", fromUrl === "automonteur");
  const seeds = vakArticleSeeds(fromUrl);
  check("…and becomes the lines a garage would price", seeds.length > 0);
  check("…with a labour line among them",
    seeds.some((s) => s.description.toLowerCase().includes("arbeidsloon")));
  check("…charged by the hour", seeds.some((s) => s.unit === "uur"));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
