// [ARTIKELEN] Pure node test — run: npx tsx src/lib/articles.test.ts
import { normalizeArticleInput, matchArticles, type Article } from "./articles";
// [PRIJS-MODUS] The round trip is checked against the SAME conversion the screens use.
import { inclFromEx } from "./price-mode";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— normalizeArticleInput —");
{
  const ok = normalizeArticleInput({ code: " 22 ", description: "  Transport tafel ", unit_price: "45", btw_rate: 21, unit: " stuk " });
  check("valid input accepted", ok.ok === true);
  if (ok.ok) {
    check("code trimmed", ok.value.code === "22");
    check("description trimmed", ok.value.description === "Transport tafel");
    check("price coerced from string + rounded", ok.value.unit_price === 45);
    check("unit trimmed", ok.value.unit === "stuk");
  }
  check("empty description rejected", normalizeArticleInput({ description: "  ", unit_price: 1, btw_rate: 21 }).ok === false);
  check("negative price rejected", normalizeArticleInput({ description: "x", unit_price: -1, btw_rate: 21 }).ok === false);
  check("invalid BTW rate rejected", normalizeArticleInput({ description: "x", unit_price: 1, btw_rate: 13 }).ok === false);
  const noCode = normalizeArticleInput({ description: "x", unit_price: 1, btw_rate: 9, code: "" });
  check("empty code → null (so UNIQUE(user,code) allows many)", noCode.ok === true && noCode.value.code === null);
  check("price rounds to cents", (() => { const r = normalizeArticleInput({ description: "x", unit_price: 1.999, btw_rate: 0 }); return r.ok && r.value.unit_price === 2; })());
}

console.log("\n— matchArticles (picker rank) —");
{
  const A = (p: Partial<Article>): Article => ({ id: "i", code: null, description: "", unit_price: 0, btw_rate: 21, unit: null, active: true, usage_count: 0, ...p });
  const cat: Article[] = [
    A({ id: "1", code: "22", description: "Transport tafel", usage_count: 5 }),
    A({ id: "2", code: "9", description: "Uurtarief", usage_count: 40 }),
    A({ id: "3", code: null, description: "Transport stoel", usage_count: 2 }),
    A({ id: "4", code: "221", description: "Transport kast", usage_count: 1 }),
    A({ id: "5", code: "99", description: "Oud artikel", active: false, usage_count: 99 }),
  ];
  check("exact code '22' ranks first", matchArticles(cat, "22")[0].id === "1");
  check("code prefix: '22' also surfaces '221'", matchArticles(cat, "22").some((a) => a.id === "4"));
  check("description substring 'transport' matches the 3 transports", matchArticles(cat, "transport").filter((a) => /Transport/.test(a.description)).length === 3);
  check("archived article never appears", matchArticles(cat, "oud").length === 0 && matchArticles(cat, "").every((a) => a.id !== "5"));
  check("empty query → most-used actives first (Uurtarief, usage 40)", matchArticles(cat, "")[0].id === "2");
  check("limit respected", matchArticles(cat, "", 2).length === 2);
}

console.log("\n— [PRIJS-MODUS] incl. of excl. btw getypt —");
{
  // Every caller from before this feature sends no price_mode. They must get the old behaviour to
  // the cent, or a catalogue that has been correct for months changes under an owner who asked for
  // nothing.
  const zonder = normalizeArticleInput({ description: "Worstjes", unit_price: 0.83, btw_rate: 9 });
  check("no price_mode → excl, unchanged", zonder.ok === true && zonder.value.unit_price === 0.83);
  const expliciet = normalizeArticleInput({ description: "Worstjes", unit_price: 0.83, btw_rate: 9, price_mode: "excl" });
  check("saying 'excl' out loud changes nothing",
    expliciet.ok === true && expliciet.value.unit_price === 0.83);

  // Anything that is not the word "incl" reads as excl. A broken payload may not silently divide.
  const junk = [null, 1, "INCL", "inclusief", {}, "ex"].every((v) => {
    const r = normalizeArticleInput({ description: "X", unit_price: 10, btw_rate: 21, price_mode: v });
    return r.ok === true && r.value.unit_price === 10;
  });
  check("junk price_mode reads as excl, never divides", junk);

  // THE MEASURED CASE, from invoice 20260001 and the table in price-mode.ts:
  // € 0,90 all-in at 9% is € 0,8256880734…  Storing € 0,83 is a DIFFERENT price.
  const incl = normalizeArticleInput({ description: "Worstjes", unit_price: 0.9, btw_rate: 9, price_mode: "incl" });
  const ex = incl.ok ? incl.value.unit_price : -1;
  check("all-in € 0,90 @ 9% is NOT stored as € 0,83", ex !== 0.83);
  check("the exact fraction survives", Math.abs(ex - 0.9 / 1.09) < 1e-12);
  // What the rounding costs at scale, which is why the fraction is kept:
  check("150 × the stored price is the € 135,00 that was promised",
    Math.abs(ex * 1.09 * 150 - 135) < 1e-9);
  check("…and 150 × € 0,83 would be most of a euro out",
    Math.abs(0.83 * 1.09 * 150 - 135) > 0.7);

  // The rate is validated BEFORE the price is divided by it. The other order would convert with
  // whatever Number() made of the junk and store a price nobody typed.
  const refused = [6, -21, "eenentwintig", null, undefined, ""].every((bad) =>
    normalizeArticleInput({ description: "X", unit_price: 100, btw_rate: bad, price_mode: "incl" }).ok === false);
  check("an incl-price is never divided by a rate we refused", refused);

  // At 0% there is nothing to take off.
  const nul = normalizeArticleInput({ description: "Vrijgesteld", unit_price: 40, btw_rate: 0, price_mode: "incl" });
  check("0% → incl and excl are the same number", nul.ok === true && nul.value.unit_price === 40);

  // The round trip. The catalogue is where a price waits between invoices; typing € 12,10 all-in
  // and reopening the form must show € 12,10, or the owner "corrects" it and the correction drifts.
  const stable = ([[12.1, 21], [0.9, 9], [50, 21], [1.61, 9], [999.99, 21]] as const).every(([typed, rate]) => {
    const r = normalizeArticleInput({ description: "X", unit_price: typed, btw_rate: rate, price_mode: "incl" });
    return r.ok === true && Math.abs(inclFromEx(r.value.unit_price, rate) - typed) < 1e-9;
  });
  check("what is stored reads back as what was typed", stable);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

