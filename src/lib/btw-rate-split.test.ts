// [RUBRIEK-SPLIT] Pure node test — run: npx tsx src/lib/btw-rate-split.test.ts
import { rateSharesFromLines, splitSliceByShares, type RateShare } from "./btw-rate-split";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const sum = (rs: RateShare[] | null, k: "ex" | "btw") =>
  Math.round((rs ?? []).reduce((s, r) => s + r[k], 0) * 100) / 100;
const at = (rs: RateShare[] | null, rate: number) => (rs ?? []).find((r) => r.rate === rate);

console.log("\n— the case the header could not express —");
{
  // €1.000 @ 21% + €1.000 @ 9% → header 2.000/300 → 15% → snapped to 21%: the whole €2.000
  // landed in rubriek 1a while half of it belongs in 1b.
  const shares = rateSharesFromLines(
    [{ btw_rate: 21, line_total: 1000 }, { btw_rate: 9, line_total: 1000 }],
    2000, 300,
  );
  check("a mixed invoice splits into two rubrieken", shares?.length === 2);
  check("21% carries its own thousand", at(shares, 21)?.ex === 1000 && at(shares, 21)?.btw === 210);
  check("9% carries its own thousand", at(shares, 9)?.ex === 1000 && at(shares, 9)?.btw === 90);
  check("the totals are untouched", sum(shares, "ex") === 2000 && sum(shares, "btw") === 300);
}
{
  // The caterer: 9% food, 21% drinks, 0% a deposit line.
  const shares = rateSharesFromLines(
    [{ btw_rate: 9, line_total: 400 }, { btw_rate: 21, line_total: 250 }, { btw_rate: 0, line_total: 30 }],
    680, 88.5,
  );
  check("three rates → three buckets", shares?.length === 3);
  check("the 0% deposit stays 0% (rubriek 1c), never folded into a rate", at(shares, 0)?.btw === 0);
  check("sums still equal the header exactly", sum(shares, "ex") === 680 && sum(shares, "btw") === 88.5);
}

console.log("\n— the header stays the money-truth: lines are only a finer description —");
{
  check("no lines → null (use the header rate, as before)", rateSharesFromLines([], 100, 21) === null);
  check("null lines → null", rateSharesFromLines(null, 100, 21) === null);
  check("one rate → null (the header derivation is already exact)",
    rateSharesFromLines([{ btw_rate: 21, line_total: 60 }, { btw_rate: 21, line_total: 40 }], 100, 21) === null);
  check("€0 lines are not buckets",
    rateSharesFromLines([{ btw_rate: 21, line_total: 100 }, { btw_rate: 9, line_total: 0 }], 100, 21) === null);
  // The safety rule: a line set that does not add up to its own header is a corrupt read.
  check("lines that miss the header ex are refused",
    rateSharesFromLines([{ btw_rate: 21, line_total: 500 }, { btw_rate: 9, line_total: 100 }], 2000, 300) === null);
  check("lines that miss the header BTW are refused",
    rateSharesFromLines([{ btw_rate: 21, line_total: 1000 }, { btw_rate: 9, line_total: 1000 }], 2000, 420) === null);
  check("a two-cent drift is still accepted (ordinary rounding)",
    rateSharesFromLines([{ btw_rate: 21, line_total: 1000 }, { btw_rate: 9, line_total: 1000 }], 2000.02, 300) !== null);
}
{
  // …and when it IS accepted, the residue never changes the totals — only where they sit.
  const shares = rateSharesFromLines(
    [{ btw_rate: 21, line_total: 1000 }, { btw_rate: 9, line_total: 1000 }],
    2000.02, 300.01,
  );
  check("the residue lands on a bucket, totals stay the header's",
    sum(shares, "ex") === 2000.02 && sum(shares, "btw") === 300.01);
}
{
  const odd = rateSharesFromLines([{ btw_rate: 20, line_total: 100 }, { btw_rate: 9, line_total: 100 }], 200, 30);
  check("an illegal rate is snapped to a legal one (no invented rubriek)",
    (odd ?? []).every((r) => [0, 9, 21].includes(r.rate)));
}

console.log("\n— a creditnota nets, it does not add —");
{
  const shares = rateSharesFromLines(
    [{ btw_rate: 21, line_total: -1000 }, { btw_rate: 9, line_total: -1000 }],
    -2000, -300,
  );
  check("negative lines give negative buckets", (shares ?? []).every((r) => r.ex < 0 && r.btw < 0));
  check("…that still sum to the (negative) header", sum(shares, "ex") === -2000 && sum(shares, "btw") === -300);
}

console.log("\n— [KASSTELSEL] a payment settles a FRACTION of every rate on the invoice —");
{
  const mix: RateShare[] = [
    { rate: 21, ex: 1000, btw: 210 },
    { rate: 9, ex: 1000, btw: 90 },
  ];
  // A €1.150 instalment on a €2.300 invoice = half of it: half of each rate, not "21% money".
  const half = splitSliceByShares(mix, 1000, 150);
  check("half the invoice → half of each bucket",
    at(half, 21)?.ex === 500 && at(half, 9)?.ex === 500);
  // [BTW-EIGEN-GEWICHT] 105 en 45, niet 75 en 75.
  //
  // Deze regel stond hier als 75/75 en legde daarmee de fout vast in plaats van hem te vangen. De
  // omzet splitst netjes half-half (ex 1000 tegen 1000), maar de BTW niet: het 21%-deel draagt
  // EUR 210 van de EUR 300 en het 9%-deel EUR 90. Een halve betaling neemt dus 105 en 45 mee.
  //
  // Met 75/75 declareerde de aangifte rubriek 1a als EUR 500 omzet met EUR 75 btw — een tarief van
  // 15% in het vakje voor 21% — en 1b hetzelfde de andere kant op. EUR 30 in de verkeerde rubriek
  // aan beide kanten, van een factuur waar niets mis mee was.
  check("de BTW volgt het EIGEN btw-aandeel, niet het omzetaandeel",
    at(half, 21)?.btw === 105 && at(half, 9)?.btw === 45);
  check("the slice is preserved exactly", sum(half, "ex") === 1000 && sum(half, "btw") === 150);

  // An awkward fraction: the residue is absorbed, never dropped.
  const third = splitSliceByShares(mix, 333.33, 50);
  check("an awkward fraction still sums to the slice",
    sum(third, "ex") === 333.33 && sum(third, "btw") === 50);

  check("a single-rate invoice needs no slice split", splitSliceByShares([{ rate: 21, ex: 100, btw: 21 }], 50, 10.5) === null);
  check("no mix → null", splitSliceByShares(null, 50, 10.5) === null);
  check("a zero-ex mix → null (never divide by nothing)",
    splitSliceByShares([{ rate: 21, ex: 0, btw: 0 }, { rate: 9, ex: 0, btw: 0 }], 50, 10) === null);
}
{
  // A creditnota settlement: negative slice over a negative mix stays negative.
  const mix: RateShare[] = [{ rate: 21, ex: -100, btw: -21 }, { rate: 9, ex: -100, btw: -9 }];
  const s = splitSliceByShares(mix, -200, -30);
  check("a refund splits negative too", sum(s, "ex") === -200 && sum(s, "btw") === -30);
}


// ── [BTW-EIGEN-GEWICHT] Een 0%-regel maakt het erger, niet kleiner ───────────
//
// Bij een even omzetverdeling kost de oude fout EUR 30. Bij een grote 0%-regel kost hij bijna
// alles: EUR 10.000 intracommunautair @0% naast EUR 1.000 binnenlands @21% is 91% van de omzet en
// 0% van de btw — dus absorbeerde het 0%-vakje ook 91% van de btw. Echte btw geboekt in een
// rubriek die er per definitie geen draagt, en het belaste vakje leeg achtergelaten.
console.log("\n— [BTW-EIGEN-GEWICHT] een 0%-regel draagt geen btw —");
{
  const mixed0: RateShare[] = [
    { rate: 0, ex: 10000, btw: 0 },
    { rate: 21, ex: 1000, btw: 210 },
  ];
  // De helft betaald: slice ex 5.500, btw 105.
  const half = splitSliceByShares(mixed0, 5500, 105);
  check("het 0%-vakje krijgt GEEN btw", at(half, 0)?.btw === 0);
  check("alle btw gaat naar het 21%-vakje", at(half, 21)?.btw === 105);
  check("de omzet splitst nog steeds naar rato van de omzet",
    at(half, 0)?.ex === 5000 && at(half, 21)?.ex === 500);
  check("en de slice blijft exact behouden",
    sum(half, "ex") === 5500 && sum(half, "btw") === 105);

  // Alles 0%: er is geen btw te verdelen, dus de omzetweging is het enige zinnige antwoord —
  // en elk vakje krijgt hoe dan ook nul.
  const alle0: RateShare[] = [
    { rate: 0, ex: 600, btw: 0 },
    { rate: 0, ex: 400, btw: 0 },
  ];
  const nul = splitSliceByShares(alle0, 500, 0);
  check("een volledig 0%-mix valt terug op de omzetweging zonder te breken",
    sum(nul, "ex") === 500 && sum(nul, "btw") === 0);

  // Het afrondingsrestje mag nooit op een 0%-vakje landen: dat zou precies de fout zijn die deze
  // functie zojuist stopte, één cent groot.
  const raar = splitSliceByShares(mixed0, 3333.33, 33.33);
  check("het btw-restje landt op het btw-dragende vakje", at(raar, 0)?.btw === 0);
  check("en de slice klopt nog steeds tot op de cent",
    sum(raar, "ex") === 3333.33 && sum(raar, "btw") === 33.33);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
