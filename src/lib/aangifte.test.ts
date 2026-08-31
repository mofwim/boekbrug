// [AANGIFTE] Pure node test — run: npx tsx src/lib/aangifte.test.ts
// The headline case is PINNED to a REAL accountant filing: Kiwi Food Market, Btw-aangifte
// 1e kwartaal 2026. If the mapper reproduces that form line-for-line from the same
// numbers, the concept is trustworthy.
import { buildAangifte, buildAangifteCsv, euro, filedSaldo, privegebruikNote, type AangifteInput, type AangifteCompleteness } from "./aangifte";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const compl = (over: Partial<AangifteCompleteness> = {}): AangifteCompleteness => ({
  turnoverDays: 90, quarterDays: 90, incomingInvoiceCount: 40, outgoingInvoiceCount: 0, hasEuPurchase: false, ...over,
});

console.log("\n— REAL filing: Kiwi Food Market Q1 2026 —");
{
  // The sales side as the store's data produces it (turnover per rate), + the accountant's
  // documented voorbelasting. Figures verbatim from the aangifte PDF.
  const input: AangifteInput = {
    salesByRate: [
      { rate: 21, omzet: 1185, btw: 249 },
      { rate: 9, omzet: 176604, btw: 15894 },
      { rate: 0, omzet: 222, btw: 0 },
    ],
    btwVoorbelasting: 15130,
    cashOmzetZonderBtw: 0,
  };
  const a = buildAangifte(input, compl(), "Q1 2026");
  const row = (c: string) => a.rows.find((r) => r.code === c)!;
  check("1a (21%): omzet 1.185 / btw 249", row("1a").omzet === 1185 && row("1a").btw === 249);
  check("1b (9%): omzet 176.604 / btw 15.894", row("1b").omzet === 176604 && row("1b").btw === 15894);
  check("1e (0%): omzet 222, geen btw", row("1e").omzet === 222 && row("1e").btw === 0);
  check("5a verschuldigd = 16.143 (= 249 + 15.894)", a.verschuldigd === 16143);
  check("5b voorbelasting = 15.130", a.voorbelasting === 15130);
  check("5g te betalen = 1.013 (matches the accountant EXACTLY)", a.saldo === 1013);
  check("marked as a concept", a.isConcept === true);
}

console.log("\n— whole-euro rounding like the form —");
{
  const input: AangifteInput = { salesByRate: [{ rate: 9, omzet: 999.4, btw: 89.95 }], btwVoorbelasting: 10.4, cashOmzetZonderBtw: 0 };
  const a = buildAangifte(input, compl(), "Q2 2026");
  check("1b btw rounds 89.95 -> 90", a.rows.find((r) => r.code === "1b")!.btw === 90);
  check("5a = sum of rounded rubrieken (90)", a.verschuldigd === 90);
  check("5g = 90 - 10 = 80", a.saldo === 80);
}

console.log("\n— other rate -> 1c, never silently merged into 1a/1b —");
{
  const input: AangifteInput = { salesByRate: [{ rate: 13, omzet: 100, btw: 13 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 };
  const a = buildAangifte(input, compl(), "Q1 2026");
  check("a 13% sale surfaces as 1c", a.rows.some((r) => r.code === "1c" && r.btw === 13));
}

console.log("\n— honest notes: no false reassurance —");
{
  const base: AangifteInput = { salesByRate: [{ rate: 9, omzet: 1000, btw: 90 }], btwVoorbelasting: 50, cashOmzetZonderBtw: 0 };
  const always = buildAangifte(base, compl(), "Q1 2026").notes.join(" ");
  check("always states it's a concept, not a filing", /CONCEPT/.test(always) && /geen ingediende aangifte/.test(always));
  check("always states 5b depends on all purchase invoices", /Ontbreekt er een inkoopfactuur/.test(always));

  const partial = buildAangifte(base, compl({ turnoverDays: 40, quarterDays: 90 }), "Q1 2026").notes.join(" ");
  check("flags missing kassadagen when coverage is partial", /40 kassadagen/.test(partial) && /Ontbrekende dagen/.test(partial));

  const eu = buildAangifte(base, compl({ hasEuPurchase: true }), "Q1 2026").notes.join(" ");
  check("flags EU purchases / rubriek 4b not auto-computed", /rubriek 4b/.test(eu));

  const noRate = buildAangifte({ ...base, cashOmzetZonderBtw: 250 }, compl(), "Q1 2026").notes.join(" ");
  check("flags omzet without a rate (not slotted into 1a/1b)", /250 omzet heeft nog geen BTW-tarief/.test(noRate));

  // [DATELESS] verified invoices with no date are dropped by the range fetch → must warn.
  const dateless = buildAangifte(base, compl({ datelessVerifiedCount: 2 }), "Q1 2026").notes.join(" ");
  check("flags dateless verified invoices (silently dropped otherwise)", /2 geverifieerde/.test(dateless) && /geen factuurdatum/.test(dateless));
  const noDateless = buildAangifte(base, compl(), "Q1 2026").notes.join(" ");
  check("no dateless note when count is 0/undefined", !/geen factuurdatum/.test(noDateless));
}

console.log("\n— AUDIT FIX: a 0-rate bucket carrying BTW is surfaced (1c), never silently zeroed —");
{
  // An undecidable/mis-derived rate can leave BTW in the rate-0 bucket; buildAangifte must
  // NOT drop it into 1e (which forces btw:0). It belongs in 1c so it stays visible.
  const a = buildAangifte(
    { salesByRate: [{ rate: 0, omzet: -1185, btw: -249 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q1 2026",
  );
  check("rate-0 WITH btw lands in 1c, not silently in 1e", a.rows.some((r) => r.code === "1c" && Math.round(r.btw) === -249));
  check("5a reflects it (the BTW is not lost)", a.verschuldigd === -249);
  check("a genuine 0% row (btw 0) still maps to 1e", buildAangifte({ salesByRate: [{ rate: 0, omzet: 222, btw: 0 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 }, compl(), "Q1 2026").rows.some((r) => r.code === "1e" && r.omzet === 222));
}

console.log("\n— buildAangifteCsv: the concept as a traceable CSV for the closing package —");
{
  // The REAL Kiwi Q1 filing → the CSV the accountant opens next to the evidence.
  const a = buildAangifte(
    {
      salesByRate: [
        { rate: 21, omzet: 1185, btw: 249 },
        { rate: 9, omzet: 176604, btw: 15894 },
        { rate: 0, omzet: 222, btw: 0 },
      ],
      btwVoorbelasting: 15130,
      cashOmzetZonderBtw: 0,
    },
    compl(),
    "Q1 2026",
  );
  const csv = buildAangifteCsv(a);
  const lines = csv.split("\r\n");
  check("uses CRLF + semicolons (Excel-NL)", csv.includes("\r\n") && csv.includes(";"));
  check("headed as a CONCEPT, not a filing", /GEEN ingediende aangifte/.test(csv) && /Concept BTW-aangifte Q1 2026/.test(csv));
  check("1a row carries omzet 1185,00 and btw 249,00 (comma decimals)", lines.some((l) => l.startsWith("1a;") && l.includes("1185,00") && l.includes("249,00")));
  check("1b row carries the 9% bucket", lines.some((l) => l.startsWith("1b;") && l.includes("176604,00") && l.includes("15894,00")));
  check("1e row present with empty btw cell", lines.some((l) => l.startsWith("1e;") && /;222,00;$/.test(l)));
  check("5a = 16143,00", lines.some((l) => l.startsWith("5a;") && l.includes("16143,00")));
  check("5b = 15130,00", lines.some((l) => l.startsWith("5b;") && l.includes("15130,00")));
  check("5g labelled 'te betalen' with 1013,00 (abs, never negative-signed)", lines.some((l) => l.startsWith("5g;") && /te betalen/.test(l) && l.includes("1013,00")));
  check("carries the honest notes (source for every figure)", /Waar dit op gebaseerd is/.test(csv) && /Voorbelasting \(5b\) telt/.test(csv));
}

console.log("\n— buildAangifteCsv: a refund quarter shows 'terug te ontvangen', abs value —");
{
  const a = buildAangifte(
    { salesByRate: [{ rate: 9, omzet: 1000, btw: 90 }], btwVoorbelasting: 300, cashOmzetZonderBtw: 0 },
    compl(), "Q2 2026",
  );
  const csv = buildAangifteCsv(a);
  check("5g labelled 'terug te ontvangen'", /5g;Concept terug te ontvangen;;210,00/.test(csv));
  check("saldo itself stays signed (−210) in the object", a.saldo === -210);
}

console.log("\n— [ICP] rubriek 3b: stated correctly, and it can never change what you pay —");
{
  const sales: AangifteInput["salesByRate"] = [
    { rate: 21, omzet: 5000, btw: 1050 },
    { rate: 0, omzet: 3000, btw: 0 },
  ];
  const zonder = buildAangifte({ salesByRate: sales, btwVoorbelasting: 200, cashOmzetZonderBtw: 0 }, compl(), "Q3 2026");
  const met = buildAangifte({ salesByRate: sales, btwVoorbelasting: 200, cashOmzetZonderBtw: 0, intraEuOmzet: 1200 }, compl(), "Q3 2026");

  check("without intra-EU turnover all 0% stays in 1e",
    zonder.rows.some((r) => r.code === "1e" && r.omzet === 3000) && !zonder.rows.some((r) => r.code === "3b"));
  check("intra-EU turnover appears as its own rubriek 3b",
    met.rows.some((r) => r.code === "3b" && r.omzet === 1200));
  check("…and it LEAVES 1e, so it is never stated twice",
    met.rows.some((r) => r.code === "1e" && r.omzet === 1800));
  check("THE SAFETY PROPERTY: 5a is untouched", met.verschuldigd === zonder.verschuldigd);
  check("…and so is 5b", met.voorbelasting === zonder.voorbelasting);
  check("…and so is what the owner actually pays (5g)", met.saldo === zonder.saldo);
  check("3b carries no BTW of its own", met.rows.find((r) => r.code === "3b")!.btw === 0);

  const all = buildAangifte({ salesByRate: sales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: 3000 }, compl(), "Q3 2026");
  check("when ALL the 0% is intra-EU, 1e disappears rather than showing €0",
    all.rows.some((r) => r.code === "3b" && r.omzet === 3000) && !all.rows.some((r) => r.code === "1e"));

  // A mismatch between the two sources must never invent turnover or drive 1e negative.
  const over = buildAangifte({ salesByRate: sales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: 9999 }, compl(), "Q3 2026");
  check("more intra-EU than there is 0%-turnover is capped, never invented",
    over.rows.find((r) => r.code === "3b")!.omzet === 3000);
  check("…and 1e can never go negative", !over.rows.some((r) => r.code === "1e" && r.omzet < 0));

  // A quarter whose EU turnover nets NEGATIVE (a creditnota for a sale invoiced earlier) has a
  // genuinely negative 3b. Clamping it to zero would leave the credit in 1e while the ICP-opgaaf
  // beside it reports the negative — two documents for one accountant, contradicting each other.
  const negSales: AangifteInput["salesByRate"] = [
    { rate: 21, omzet: 5000, btw: 1050 },
    { rate: 0, omzet: -800, btw: 0 },
  ];
  const neg = buildAangifte({ salesByRate: negSales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: -500 }, compl(), "Q3 2026");
  check("a net-negative EU quarter gets a negative 3b, not a hidden one",
    neg.rows.find((r) => r.code === "3b")!.omzet === -500);
  check("…and the rest of the negative 0%-bucket stays in 1e",
    neg.rows.find((r) => r.code === "1e")!.omzet === -300);
  check("…while 5g still does not move",
    neg.saldo === buildAangifte({ salesByRate: negSales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0 }, compl(), "Q3 2026").saldo);
  const negCapped = buildAangifte({ salesByRate: negSales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: -9999 }, compl(), "Q3 2026");
  check("a negative bigger than the bucket is capped too, and 1e never flips sign",
    negCapped.rows.find((r) => r.code === "3b")!.omzet === -800 && !negCapped.rows.some((r) => r.code === "1e"));

  // Mixed signs are not an amount anyone can honestly move.
  check("positive EU turnover against a negative 0%-bucket moves nothing",
    buildAangifte({ salesByRate: negSales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: 500 }, compl(), "Q3 2026")
      .rows.find((r) => r.code === "1e")!.omzet === -800);
  check("…and neither does the reverse",
    buildAangifte({ salesByRate: sales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: -500 }, compl(), "Q3 2026")
      .rows.find((r) => r.code === "1e")!.omzet === 3000);

  // When 3b could not take the whole figure, the concept and the ICP-opgaaf beside it disagree —
  // and both go to the same accountant, so the difference is stated instead of discovered.
  const capped = buildAangifte({ salesByRate: sales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: 9999 }, compl(), "Q3 2026");
  check("a capped 3b says so, naming both amounts",
    capped.notes.some((n) => /intracommunautaire leveringen/.test(n) && /9\.999/.test(n) && /3\.000/.test(n)));
  check("…and points at the two likely causes", capped.notes.some((n) => /tóch BTW is berekend/.test(n) && /creditnota/.test(n)));
  check("…and warns that the two figures get compared", capped.notes.some((n) => /naast elkaar gelegd/.test(n)));
  check("a 3b that took the whole figure says nothing extra",
    !met.notes.some((n) => /naast elkaar gelegd/.test(n)));
  check("no intra-EU turnover at all says nothing either",
    !zonder.notes.some((n) => /naast elkaar gelegd/.test(n)));

  check("the CSV carries 3b with its Belastingdienst label",
    /3b;Leveringen naar landen binnen de EU;1200,00/.test(buildAangifteCsv(met)));
}

console.log("\n— [COUNT-BASIS] de tellingen beschrijven de set waar de cijfers uit komen —");
{
  const input: AangifteInput = {
    salesByRate: [{ rate: 21, omzet: 1000, btw: 210 }],
    btwVoorbelasting: 100,
    cashOmzetZonderBtw: 0,
  };
  const note = (a: ReturnType<typeof buildAangifte>, re: RegExp) => a.notes.find((n) => re.test(n)) ?? "";

  // Factuurstelsel: onveranderd. Dit is de bestaande zin, woord voor woord.
  const acc = buildAangifte(input, compl({ incomingInvoiceCount: 40, outgoingInvoiceCount: 3 }), "Q1 2026");
  check("factuur: 5b noemt 'ingevoerde inkoopfacturen'",
    /Voorbelasting \(5b\) telt alleen 40 ingevoerde inkoopfactu/.test(note(acc, /Voorbelasting/)));
  check("factuur: 5a noemt de verkoopfacturen zonder betaal-woord",
    /en 3 verkoopfactu\(u\)r\(en\)\./.test(note(acc, /Verkoop-BTW/)));

  // Kasstelsel: dezelfde getallen betekenen iets anders, en de zin zegt dat nu ook.
  const cash = buildAangifte(input, compl({ incomingInvoiceCount: 10, outgoingInvoiceCount: 3, scheme: "kas" }), "Q1 2026");
  check("kas: 5b zegt BETAALD, niet 'ingevoerd'",
    /die je in dit kwartaal hebt BETAALD \(kasstelsel\)/.test(note(cash, /Voorbelasting/)));
  check("kas: 5b legt uit wat er dan NIET meetelt",
    /Een onbetaalde inkoopfactuur telt pas mee zodra je hem betaalt\./.test(note(cash, /Voorbelasting/)));
  check("kas: 5a noemt de betaalde verkoopfacturen",
    /3 in dit kwartaal betaalde verkoopfactu/.test(note(cash, /Verkoop-BTW/)));
  check("kas verandert geen enkel BEDRAG — alleen de zin",
    cash.verschuldigd === acc.verschuldigd && cash.voorbelasting === acc.voorbelasting && cash.saldo === acc.saldo);

  // Zonder verkoopfacturen blijft de zin in beide stelsels bij de dagomzet.
  const geen = buildAangifte(input, compl({ outgoingInvoiceCount: 0, scheme: "kas" }), "Q1 2026");
  check("geen verkoopfacturen: geen losse bijzin, in geen van beide stelsels",
    /uit 90 dag\(en\) dagomzet\./.test(note(geen, /Verkoop-BTW/)));
}

console.log("\n— [PRIVEGEBRUIK] rubriek 1d: de correctie die deze app niet kan berekenen —");
{
  // Leaving 1d out means declaring too LITTLE BTW. That surfaces as a naheffing with
  // belastingrente months later, never as an error on screen. The app cannot compute it (it does
  // not know a vehicle's catalogue value or anyone's private kilometres), so the only honest move
  // is to say so — while the owner can still act on it.
  const q4 = privegebruikNote(4);
  check("Q4 says the correction belongs in THIS filing", /DEZE aangifte/.test(q4));
  check("Q4 names the rubriek", /1d/.test(q4));
  check("Q4 never implies the app computed it", /NIET berekend/.test(q4));

  // The whole reason this is said before Q4: a kilometre administration cannot be reconstructed
  // in January. A note that appears only in the last quarter arrives too late to act on.
  let earlyOk = true, earlyActionable = true;
  for (const q of [1, 2, 3] as const) {
    const n = privegebruikNote(q);
    if (!/LAATSTE aangifte van het jaar/.test(n)) earlyOk = false;
    if (!/NU bijhoudt|kilometeradministratie/.test(n)) earlyActionable = false;
  }
  check("Q1-Q3 say when the correction lands", earlyOk);
  check("Q1-Q3 say what to do TODAY — the records, not the filing", earlyActionable);

  // Same discipline as rubriek 4b: state what is NOT computed rather than guessing. A fabricated
  // 1d would be worse than none — it would look settled.
  let noAmount = true, allPresent = true;
  for (const q of [1, 2, 3, 4] as const) {
    if (/€/.test(privegebruikNote(q))) noAmount = false;
    if (privegebruikNote(q).length < 40) allPresent = false;
  }
  check("the note never carries an amount", noAmount);
  check("every quarter gets a note — the rubriek exists all year", allPresent);
}


console.log("\n— [VRIJGESTELD] exempt turnover: named, in no rubriek, and never called 'no turnover' —");
{
  // A fully exempt practice: EUR 132.000 of care turnover, nothing taxed, no till days.
  const input: AangifteInput = {
    salesByRate: [],
    btwVoorbelasting: 0,
    cashOmzetZonderBtw: 0,
    vrijgesteldeOmzet: 132000,
    proRataPercent: 0,
    voorbelastingGeblokkeerd: 4200,
  };
  const a = buildAangifte(input, compl({ turnoverDays: 0 }), "Q3 2026");
  const notes = a.notes.join(" | ");

  check("the figure is carried out, not dropped", a.vrijgesteldeOmzet === 132000);
  check("it reaches NO rubriek — not even 1e", !a.rows.some((r) => r.omzet === 132000));
  check("5a stays empty (an exemption charges no BTW)", a.verschuldigd === 0);
  // The defect this pins: the sentence is keyed on salesByRate being empty, and for a fully
  // exempt owner it always is. Told "je hebt nog geen omzet ingevoerd" at the moment their
  // quarter is complete, an owner reasonably concludes the app lost their invoices.
  check("it does NOT claim the quarter is empty", !/nog geen omzet ingevoerd/.test(notes));
  check("the exempt turnover is named in the notes", /VRIJGESTELD/.test(notes) && /132\.000/.test(notes));
  check("and the note says why it is in no box", /geen[\s\S]*rubriek/.test(notes));
  check("blocked input BTW is disclosed", /4\.200/.test(notes) && /geen recht op aftrek/.test(notes));
}

console.log("\n— [VRIJGESTELD] blocked input BTW is disclosed in a quarter with no exempt turnover —");
{
  // A physio buys a EUR 3.000 treatment table in January and treats their first patient in April.
  // Q1 has EUR 630 withheld from 5b and no exempt turnover to pair it with. The sentence explaining
  // why 5b is EUR 630 lower than the purchase invoices say used to sit INSIDE the exempt-turnover
  // block, so in exactly this quarter it did not appear: the figure was right and read like a bug.
  const a = buildAangifte(
    {
      salesByRate: [{ rate: 21, omzet: 2000, btw: 420 }],
      btwVoorbelasting: 0,
      cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 0,
      voorbelastingGeblokkeerd: 630,
      exemptRegime: true,
    },
    compl(), "Q1 2026",
  );
  const notes = a.notes.join(" | ");
  check("the blocked BTW is named even with zero exempt turnover", /630/.test(notes) && /geen recht op aftrek/.test(notes));
  check("and no exempt-turnover sentence is invented alongside it", !/van je omzet is VRIJGESTELD/.test(notes));

  // The rounding trap that made it worse: 40 cents of exempt turnover rounds to 0 in the sentence
  // above, and used to take the blocked-BTW note down with it.
  const cents = buildAangifte(
    {
      salesByRate: [], btwVoorbelasting: 0, cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 0.4, voorbelastingGeblokkeerd: 630, exemptRegime: true,
    },
    compl(), "Q1 2026",
  );
  check("cent-sized exempt turnover no longer hides the blocked BTW", /630/.test(cents.notes.join(" | ")));

  // And an owner with no blocked BTW at all is told nothing — the note is a disclosure, not decor.
  const none = buildAangifte(
    { salesByRate: [], btwVoorbelasting: 100, cashOmzetZonderBtw: 0 },
    compl(), "Q1 2026",
  );
  check("no blocked BTW → no sentence about it", !/geen recht op aftrek/.test(none.notes.join(" | ")));
}

console.log("\n— [VRIJGESTELD] a genuinely empty quarter still says so —");
{
  const a = buildAangifte(
    { salesByRate: [], btwVoorbelasting: 0, cashOmzetZonderBtw: 0, vrijgesteldeOmzet: 0 },
    compl({ turnoverDays: 0 }),
    "Q3 2026",
  );
  check("no exempt turnover ⇒ the empty-quarter sentence is back", /nog geen omzet ingevoerd/.test(a.notes.join(" | ")));
  check("and no exemption note is invented", !/VRIJGESTELD/.test(a.notes.join(" | ")));
}

console.log("\n— [VRIJGESTELD] an undecidable ratio says 5b is deliberately too LOW —");
{
  const a = buildAangifte(
    {
      salesByRate: [], btwVoorbelasting: 105, cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 0, proRataPercent: null, voorbelastingUnresolved: 210,
    },
    compl({ turnoverDays: 0 }),
    "Q3 2026",
  );
  const notes = a.notes.join(" | ");
  check("the unresolved BTW is named", /210/.test(notes));
  check("and the direction of the error is stated, not implied", /te LAAG/.test(notes));
  check("5b carries only what was actually claimable", a.voorbelasting === 105);
}


console.log("\n— [VRIJGESTELD] the boundary of the feature is stated in the concept, not only in a migration —");
{
  // A physio: EUR 40.000 exempt care invoiced, plus EUR 9.000 through the till and the cash book
  // that this round cannot classify and therefore booked as TAXED.
  const a = buildAangifte(
    {
      salesByRate: [{ rate: 21, omzet: 9000, btw: 1890 }],
      btwVoorbelasting: 0, cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 40000, proRataPercent: 19,
      onclassificeerbareOmzet: 9000, exemptRegime: true,
    },
    compl({ turnoverDays: 90 }),
    "Q3 2026",
  );
  const notes = a.notes.join(" | ");
  check("the unclassifiable turnover is named with its amount", /9\.000/.test(notes));
  check("and it says which way the error runs (counted as TAXED)", /BELASTE omzet/.test(notes));
  check("and where the owner CAN classify instead", /per regel/.test(notes));
  // The figure itself is still declared — the limit is about the LABEL, not about hiding money.
  check("the taxed bucket keeps its BTW", a.rows.find((r) => r.code === "1a")!.btw === 1890);
}

console.log("\n— [VRIJGESTELD] an invoice-only exempt owner is not warned about a till they don't have —");
{
  const a = buildAangifte(
    {
      salesByRate: [], btwVoorbelasting: 0, cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 132000, proRataPercent: 0,
      onclassificeerbareOmzet: 0, exemptRegime: true,
    },
    compl({ turnoverDays: 0 }),
    "Q3 2026",
  );
  check("no till/cash warning when there is no till or cash", !/dagomzet \(kassa\)/.test(a.notes.join(" | ")));
}

console.log("\n— [VRIJGESTELD] and an ordinary owner with a till is never warned at all —");
{
  const a = buildAangifte(
    {
      salesByRate: [{ rate: 21, omzet: 9000, btw: 1890 }],
      btwVoorbelasting: 0, cashOmzetZonderBtw: 0,
      onclassificeerbareOmzet: 0, exemptRegime: false,
    },
    compl({ turnoverDays: 90 }),
    "Q3 2026",
  );
  const notes = a.notes.join(" | ");
  check("off-regime: no exemption sentence of any kind", !/vrijgesteld/i.test(notes));
}

// ── [AFRONDING] Whole euros, symmetrically around zero ───────────────────────
//
// Math.round breaks ties toward +infinity, so 1,50 becomes 2 but -1,50 becomes -1. Invisible on a
// normal quarter, where every rubriek is positive. It appears on a quarter that nets NEGATIVE — a
// large creditnota, a refunded season, a correction from an earlier period — which is exactly the
// quarter that is already unusual and least likely to be double-checked. There the bias ran one
// way every time: toward zero, which on a reclaim is against the owner.
console.log("\n— [AFRONDING] hele euro's, symmetrisch rond nul —");
{
  const neg = buildAangifte(
    { salesByRate: [{ rate: 21, omzet: -1000.5, btw: -210.5 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q3 2026",
  );
  const n1a = neg.rows.find((r) => r.code === "1a")!;
  check("-210,50 wordt -211, niet -210", n1a.btw === -211);
  check("-1000,50 wordt -1001, niet -1000", n1a.omzet === -1001);

  // De positieve kant mag NIET bewegen: deze correctie hoort een gewoon kwartaal niet te raken.
  const pos = buildAangifte(
    { salesByRate: [{ rate: 21, omzet: 1000.5, btw: 210.5 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q3 2026",
  );
  const p1a = pos.rows.find((r) => r.code === "1a")!;
  check("210,50 blijft 211", p1a.btw === 211);
  check("1000,50 blijft 1001", p1a.omzet === 1001);

  // JavaScript houdt -0 en 0 uit elkaar, en een "-0" op een concept dat een boekhouder leest is
  // een vraag die niemand hoort te hoeven stellen.
  const nul = buildAangifte(
    { salesByRate: [{ rate: 21, omzet: -0.4, btw: -0.2 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q3 2026",
  );
  const z1a = nul.rows.find((r) => r.code === "1a")!;
  check("een rubriek staat nooit als -0", Object.is(z1a.btw, 0) && Object.is(z1a.omzet, 0));

  // 5b en 5g lopen door dezelfde afronding — een teruggaaf hoort net zo symmetrisch te zijn.
  const teruggaaf = buildAangifte(
    { salesByRate: [], btwVoorbelasting: 210.5, cashOmzetZonderBtw: 0 },
    compl(), "Q3 2026",
  );
  check("voorbelasting 210,50 wordt 211", teruggaaf.voorbelasting === 211);
  check("en het saldo is dan -211", teruggaaf.saldo === -211);
}

console.log("\n— [SUPPLETIE-FANTOOM] the two roundings that produced a phantom correction —");
{
  // The concept's 5a is the SUM of the per-rubriek rounded amounts, because that is what the paper
  // form asks for. The filing snapshot stores the engine's raw total, and the screen rounded that
  // ONCE. Those are different operations, and on a quarter nobody touched they disagreed — so the
  // owner read that "€ 1 komt erbij" on a return he had already filed: a suppletie prompt for a
  // difference that existed only in the rounding, on the screen where a figure has to be trusted.
  //
  // (The other half of the same defect — Math.round against euro() on a negative quarter — is
  // pinned by the [AFRONDING] block above; the filed snapshot now uses euro() too.)
  const input: AangifteInput = {
    salesByRate: [
      { rate: 21, omzet: 1000, btw: 100.5 },   // → 101 on its own line
      { rate: 9, omzet: 1000, btw: 200.5 },    // → 201 on its own line
    ],
    btwVoorbelasting: 0,
    cashOmzetZonderBtw: 0,
  };
  const a = buildAangifte(input, compl(), "Q3 2026");
  const rawTotal = 100.5 + 200.5;              // 301 exactly — what the engine hands the filing

  check("5a is the sum of the rounded rubrieken (101 + 201)", a.verschuldigd === 302);
  check("rounding the raw total once gives 301 instead", euro(rawTotal) === 301);
  check("so subtracting the two DISPLAYS invents a euro out of nothing", a.verschuldigd - euro(rawTotal) === 1);
  // The comparison that is actually correct, and what the route now returns as saldoDelta — the
  // same raw-against-raw that computeFilingDivergence has always used for the real suppletie.
  check("raw against raw is zero on an unchanged quarter", euro(rawTotal - rawTotal) === 0);
}

console.log("\n— [SUPPLETIE-FANTOOM] het saldo van een INGEDIENDE momentopname —");
{
  // 5g is 5a min 5b, elk afzonderlijk afgerond — dat is wat op het formulier staat en wat de
  // eigenaar indient. Twee lezers van de opgeslagen momentopname deden het allebei anders, en
  // allebei op hun eigen manier fout: /api/btw-reservation rondde het RUWE verschil in één keer af
  // en reserveerde € 800 voor een aangifte die zojuist voor € 801 was ingediend; /api/aangifte
  // toonde 1001 en 200 naast een saldo van 800 — drie getallen waarvan er twee de derde
  // tegenspreken.
  check("verschuldigd 1000,60 en voorbelasting 200,40 geven 801, niet 800",
    filedSaldo({ btw_verschuldigd: 1000.6, btw_voorbelasting: 200.4, btw_saldo: 800.2 }) === 801);
  check("…en Math.round op het ruwe saldo gaf echt 800 (anders is het voorbeeld zijn punt kwijt)",
    Math.round(800.2) === 800);

  // De hele reden dat dit één functie is: de ingediende en de nog-niet-ingediende tak van
  // /api/btw-reservation vullen ÉÉN lijst en tellen op tot het bedrag dat opzij moet. Rekenen ze
  // anders, dan verandert dat bedrag zodra de eigenaar "markeer als ingediend" tikt.
  const zelfde = ([[1000.6, 200.4], [0.5, 0], [100.5, 300.5], [0, 0], [-100.4, 50.6]] as const)
    .every(([v, vb]) => filedSaldo({ btw_verschuldigd: v, btw_voorbelasting: vb, btw_saldo: v - vb }) === euro(v) - euro(vb));
  check("ingediend en concept geven hetzelfde getal op dezelfde cijfers", zelfde);

  // euro() rondt van nul áf, Math.round breekt gelijkspel naar +∞. Op een teruggavekwartaal gaven
  // twee getallen op één scherm daardoor een ander antwoord over dezelfde halve euro.
  check("een teruggavekwartaal rondt van nul af, niet naar boven",
    filedSaldo({ btw_verschuldigd: 100, btw_voorbelasting: 100.5, btw_saldo: -0.5 }) === -1 && Object.is(Math.round(-0.5), -0));

  // De momentopname heeft de twee kolommen niet altijd gehad. Terugvallen is beter dan nul.
  check("een oudere rij zonder componenten valt terug op het ruwe saldo",
    filedSaldo({ btw_saldo: 800.2 }) === 800
    && filedSaldo({ btw_saldo: 800.2, btw_verschuldigd: null, btw_voorbelasting: null }) === 800
    && filedSaldo({}) === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);


