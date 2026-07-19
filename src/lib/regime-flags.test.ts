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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
