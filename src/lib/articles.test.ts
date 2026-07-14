// [ARTIKELEN] Pure node test — run: npx tsx src/lib/articles.test.ts
import { normalizeArticleInput, matchArticles, type Article } from "./articles";

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
