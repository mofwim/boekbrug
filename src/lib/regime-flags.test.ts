// [REGIME-FLAGS] Pure node test — run: npx tsx src/lib/regime-flags.test.ts
import {
  detectRegimeFlags,
  regimeFlagNote,
  KOR_THRESHOLD_EUR,
  type RegimeSignals,
  type RegimeLineSignal,
} from "./regime-flags";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const sig = (over: Partial<RegimeSignals> = {}): RegimeSignals => ({
  korActive: false, lines: [], ...over,
});
const codes = (s: RegimeSignals) => detectRegimeFlags(s).map((f) => f.code);

console.log("\n— empty data: no flags (never cry wolf) —");
{
  check("no signals → no flags", detectRegimeFlags(sig()).length === 0);
  check("ordinary invoice lines → no flags", codes(sig({
    lines: [
      { direction: "outgoing", text: "Advies 4 uur à €90" },
      { direction: "incoming", text: "Kantoorartikelen" },
      { direction: "outgoing", text: "Winstmarge project (interne notitie)" }, // 'marge' alone must NOT trip
    ],
  })).length === 0);
}

console.log("\n— KOR —");
{
  const f = detectRegimeFlags(sig({ korActive: true }));
  check("kor active → 'kor' flag", f.some((x) => x.code === "kor"));
  check("kor flag does not depend on invoices (till-only shop)", f.length >= 1);
  check("no threshold flag without an omzet figure", !f.some((x) => x.code === "kor_threshold"));
}
{
  const under = detectRegimeFlags(sig({ korActive: true, omzetForKorCheck: KOR_THRESHOLD_EUR }));
  check("omzet exactly at ceiling → NO threshold flag (only strictly above)", !under.some((x) => x.code === "kor_threshold"));
  const over = detectRegimeFlags(sig({ korActive: true, omzetForKorCheck: KOR_THRESHOLD_EUR + 1 }));
  check("omzet above ceiling → threshold flag", over.some((x) => x.code === "kor_threshold"));
  check("threshold flag needs kor active", !detectRegimeFlags(sig({ korActive: false, omzetForKorCheck: 999999 })).some((x) => x.code === "kor_threshold"));
}

console.log("\n— reverse charge (BTW verlegd) —");
{
  const lines: RegimeLineSignal[] = [
    { direction: "incoming", text: "Onderaanneming bouw — BTW verlegd", invoiceLabel: "INK-22" },
    { direction: "outgoing", text: "Levering met btw-verlegd naar afnemer", invoiceLabel: "2026-014" },
  ];
  const f = detectRegimeFlags(sig({ lines }));
  check("purchase verlegd → reverse_charge_purchase", f.some((x) => x.code === "reverse_charge_purchase"));
  check("sale verlegd → reverse_charge_sale", f.some((x) => x.code === "reverse_charge_sale"));
  check("purchase flag carries the invoice label as evidence", f.find((x) => x.code === "reverse_charge_purchase")?.evidence === "INK-22");
  check("sale flag carries the invoice label", f.find((x) => x.code === "reverse_charge_sale")?.evidence === "2026-014");
}
{
  // "verleggingsregeling" and "reverse charge" both trip; direction routes the flag.
  check("verleggingsregeling wording trips", codes(sig({ lines: [{ direction: "incoming", text: "Toepassing verleggingsregeling" }] })).includes("reverse_charge_purchase"));
  check("english 'reverse charge' trips", codes(sig({ lines: [{ direction: "outgoing", text: "Services (reverse charge)" }] })).includes("reverse_charge_sale"));
}
{
  // [PRECISION] "verleg" is a substring of the very common word "overleg" (consultation) and of
  // "verleggen" (to relocate). The gate must NOT trip on those — the reverse-charge invoice
  // wording is legally "btw verlegd" (Art. 35a Wet OB), so we require "btw" adjacent.
  const noTrip = (text: string) => codes(sig({ lines: [{ direction: "outgoing", text }] })).length === 0;
  check("'Overleg met klant' does NOT trip", noTrip("Overleg met klant"));
  check("'Juridisch overleg' does NOT trip", noTrip("Juridisch overleg"));
  check("'werkoverleg' does NOT trip", noTrip("Voorbereiding werkoverleg"));
  check("'kabel verleggen' (relocate) does NOT trip", noTrip("Kabel verleggen op locatie"));
  check("but 'BTW verlegd' still trips", codes(sig({ lines: [{ direction: "outgoing", text: "Levering — BTW verlegd" }] })).includes("reverse_charge_sale"));
}

console.log("\n— margeregeling —");
{
  const f = detectRegimeFlags(sig({ lines: [
    { direction: "outgoing", text: "Tweedehands fiets — margeregeling van toepassing", invoiceLabel: "2026-020" },
  ] }));
  check("margeregeling → margin_scheme flag", f.some((x) => x.code === "margin_scheme"));
  check("margin flag carries evidence", f.find((x) => x.code === "margin_scheme")?.evidence === "2026-020");
  check("bare 'marge' does NOT trip margin_scheme", !codes(sig({ lines: [{ direction: "outgoing", text: "hoge marge op dit product" }] })).includes("margin_scheme"));
}

console.log("\n— dedup + evidence cap —");
{
  const lines: RegimeLineSignal[] = [];
  for (let i = 1; i <= 8; i++) lines.push({ direction: "incoming", text: "btw verlegd", invoiceLabel: `INK-${i}` });
  const f = detectRegimeFlags(sig({ lines }));
  const rc = f.filter((x) => x.code === "reverse_charge_purchase");
  check("one deduped purchase flag for 8 verlegd lines", rc.length === 1);
  check("evidence capped at 5 labels", (rc[0].evidence ?? "").split(",").length === 5);
}
{
  // two lines on the SAME invoice → still one label in evidence (Set-deduped)
  const f = detectRegimeFlags(sig({ lines: [
    { direction: "incoming", text: "btw verlegd deel 1", invoiceLabel: "INK-9" },
    { direction: "incoming", text: "btw verlegd deel 2", invoiceLabel: "INK-9" },
  ] }));
  check("same-invoice lines dedup to one evidence label", f.find((x) => x.code === "reverse_charge_purchase")?.evidence === "INK-9");
}

console.log("\n— regimeFlagNote —");
{
  const f = detectRegimeFlags(sig({ lines: [{ direction: "incoming", text: "btw verlegd", invoiceLabel: "INK-1" }] }))[0];
  const note = regimeFlagNote(f);
  check("note includes the title", note.includes("Inkoop met BTW verlegd"));
  check("note includes the evidence invoice", note.includes("INK-1"));
  const korNote = regimeFlagNote(detectRegimeFlags(sig({ korActive: true }))[0]);
  check("kor note has no evidence clause", !korNote.includes("bijv. factuur"));
}

console.log("\n— [KOR-5B] + [KOR-JAARGRENS]: wat de KOR-vlag verzweeg —");
{
  // Two omissions in one sentence, both costing the owner money — and both invisible, because
  // the concept looks complete either way.
  const kor = detectRegimeFlags({ korActive: true, lines: [] }).find((f) => f.code === "kor");
  const d = kor ? kor.detail : "";

  // 1. The concept computes 5b from the purchase invoices. Under the KOR there is no right to
  //    deduct at all, so that is a refund the owner is not entitled to. The old text said only
  //    "the afdracht lapses", which reads as "the deduction survives" — and a wrongly claimed
  //    refund comes back as a naheffing with interest.
  check("de KOR-vlag noemt 5a", /5a/.test(d));
  check("[KOR-5B] de KOR-vlag noemt OOK 5b — de aftrek die vervalt", /5b/.test(d));
  check("[KOR-5B] en zegt expliciet dat die niet mag worden teruggevraagd",
    /NIET worden teruggevraagd|niet worden teruggevraagd/.test(d));

  // 2. The threshold flag is tested against the omzet this computation sees, which is ONE
  //    quarter. €6.000 per quarter never trips €20.000 and still blows the annual ceiling.
  //    The flag simply stays silent, so the gap has to be said in words instead.
  check("[KOR-JAARGRENS] de vlag zegt dat de grens per JAAR geldt", /per JAAR|jaargrens/i.test(d));
  check("[KOR-JAARGRENS] en dat dit concept maar één kwartaal ziet", /alleen dit kwartaal/.test(d));
  check("[KOR-JAARGRENS] en dat overschrijden terugwerkt", /terugwerkende kracht/.test(d));

  // The threshold flag itself still only fires on what it can see — that is honest, as long as
  // the sentence above tells the owner the flag's silence is not an all-clear.
  const onder = detectRegimeFlags({ korActive: true, omzetForKorCheck: 6000, lines: [] });
  check("een kwartaal van €6.000 laat de drempelvlag zwijgen (zoals verwacht)",
    !onder.some((f) => f.code === "kor_threshold"));
  check("...maar de KOR-vlag waarschuwt dan nog steeds over de jaargrens",
    onder.some((f) => f.code === "kor" && /per JAAR/.test(f.detail)));
}

console.log("\n— [KOR-STIL] de ondernemer die in de KOR zit en het nooit zei —");
{
  // kor_active is een VERKLARING en staat standaard op false, dus "niet in de regeling" en "nooit
  // Instellingen geopend" zijn dezelfde opgeslagen waarde. Alles wat de app over de KOR doet hangt
  // aan die verklaring, en voor wie hem nooit deed is het allemaal inert.
  const stil = detectRegimeFlags(sig({ korActive: false, omzetForKorCheck: 6000 }));
  check("onder de grens én KOR uit → de vlag verschijnt", stil.some((f) => f.code === "kor_possible"));
  check("...en noemt waar je hem aanzet", stil.some((f) => f.code === "kor_possible" && /Instellingen/.test(f.detail)));
  check("...en waarom het geld kost", stil.some((f) => f.code === "kor_possible" && /5a/.test(f.detail)));

  // Precisie is de norm van dit bestand: een valse regimevlag is ruis die vertrouwen ondermijnt.
  check("wie de KOR AL aan heeft, krijgt hem niet",
    !detectRegimeFlags(sig({ korActive: true, omzetForKorCheck: 6000 })).some((f) => f.code === "kor_possible"));
  check("wie ver boven de grens zit, kan er niet in vallen en ziet hem niet",
    !detectRegimeFlags(sig({ korActive: false, omzetForKorCheck: 80000 })).some((f) => f.code === "kor_possible"));
  // Precies op de grens is nog binnen de regeling — dezelfde randregel als kor_threshold hierboven.
  check("precies op de grens telt nog mee",
    detectRegimeFlags(sig({ korActive: false, omzetForKorCheck: KOR_THRESHOLD_EUR })).some((f) => f.code === "kor_possible"));
  check("één euro erboven niet",
    !detectRegimeFlags(sig({ korActive: false, omzetForKorCheck: KOR_THRESHOLD_EUR + 1 })).some((f) => f.code === "kor_possible"));
  // Een kwartaal zonder omzet zegt niets over iemands regime, en een gloednieuw account hoort niet
  // te openen op een waarschuwing over een regeling waar het nog niet in kán zitten.
  check("zonder omzet zwijgt de vlag",
    !detectRegimeFlags(sig({ korActive: false, omzetForKorCheck: 0 })).some((f) => f.code === "kor_possible"));
  check("en zonder omzetcijfer óók",
    !detectRegimeFlags(sig({ korActive: false })).some((f) => f.code === "kor_possible"));
  // De twee KOR-vlaggen zijn elkaars spiegelbeeld en mogen elkaar nooit tegenspreken.
  check("kor_possible en kor_threshold sluiten elkaar uit",
    !detectRegimeFlags(sig({ korActive: false, omzetForKorCheck: 6000 })).some((f) => f.code === "kor_threshold")
    && !detectRegimeFlags(sig({ korActive: true, omzetForKorCheck: 80000 })).some((f) => f.code === "kor_possible"));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
