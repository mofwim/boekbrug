// src/lib/bank-slot-numbers.test.ts — run: npx tsx src/lib/bank-slot-numbers.test.ts
// [SLOT-WAAR] One row per invoice number, whatever the three sources say.
import { slotNumbers } from "./bank-slot-numbers";

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) { console.error(`FAIL ${name}`); failed++; } else { console.log(`ok   ${name}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(`${name}${g === w ? "" : `  (got ${g}, want ${w})`}`, g === w);
}

// ── The reported case ──────────────────────────────────────────────────────────
//
// ipekci slachterij, € 3.624,25, reference "202604231", description "Deel twee factuur 202604231".
// One invoice, paid in two halves — the administration holds a second bank line of the same amount
// with "Deel 1 helft". Nothing is imported, so nothing resolves: `missing` carries the number
// because the payment introduces it with the word "factuur", and `referenceParts` carries the very
// same number because the bank wrote it in the reference field too. The card said "2 facturen".
{
  const out = slotNumbers({
    resolved: [],
    missing: ["202604231"],
    referenceParts: ["202604231"],
  });
  eq("the reported payment names ONE invoice", out, ["202604231"]);
}

// ── The three sources, and who wins ────────────────────────────────────────────
{
  // We hold it: our spelling is the one the owner can look up.
  const out = slotNumbers({
    resolved: ["FAC-2601629"],
    missing: ["fac2601629"],
    referenceParts: ["FAC 2601629"],
  });
  eq("one row, and the resolved spelling survives", out, ["FAC-2601629"]);
}
{
  const out = slotNumbers({ resolved: [], missing: ["2601291"], referenceParts: ["2601291"] });
  eq("a named-but-missing number keeps its own spelling", out, ["2601291"]);
}
{
  // A real batch: three named, two held. Order is reading order, not source order.
  const out = slotNumbers({
    resolved: ["2601695", "2601826"],
    missing: ["2601291"],
    referenceParts: ["2601695", "2601826", "2601291"],
  });
  eq("a genuine three-invoice payment still shows three", out, ["2601695", "2601826", "2601291"]);
}

// ── [BUNDEL-REF-RECOVER] The fragment rule, now applied against EVERYTHING ──────
//
// extractInvoiceReference cuts a number at every separator, so "2026-045" is stored as "045". That
// piece must never stand beside its own parent: it would read as a second invoice and its row could
// never be filled. The rule existed; it was only ever applied against the RESOLVED numbers, which
// is precisely the list that is empty in the case above.
{
  eq("a fragment of a RESOLVED number is dropped",
    slotNumbers({ resolved: ["2026045"], missing: [], referenceParts: ["045"] }), ["2026045"]);
  eq("…and so is a fragment of a MISSING one — this is the widening",
    slotNumbers({ resolved: [], missing: ["2026045"], referenceParts: ["045"] }), ["2026045"]);
}
{
  // But a reference part that is nobody's fragment is a real second number and must stay: an
  // invoice we have not been told about is exactly what the slot view is for.
  eq("an unrelated reference part is kept",
    slotNumbers({ resolved: [], missing: ["202604231"], referenceParts: ["987654"] }),
    ["202604231", "987654"]);
}

// ── Identity, not spelling ─────────────────────────────────────────────────────
{
  eq("separators and case are printing, not identity",
    slotNumbers({ resolved: [], missing: ["FAC-2601629"], referenceParts: ["fac 2601629", "FAC2601629"] }),
    ["FAC-2601629"]);
  eq("a doubled source is still one row",
    slotNumbers({ resolved: ["2919045", "2919045"], missing: [], referenceParts: [] }), ["2919045"]);
}

// ── Nothing in, nothing out ────────────────────────────────────────────────────
{
  eq("no sources", slotNumbers({ resolved: [], missing: [], referenceParts: [] }), []);
  eq("blank strings are not numbers",
    slotNumbers({ resolved: ["", "  "], missing: [""], referenceParts: ["  "] }), []);
  eq("a token with no alphanumerics at all is dropped",
    slotNumbers({ resolved: [], missing: [], referenceParts: ["---", "//"] }), []);
}

// [NEGATIEVE CONTROLE] Every "one row" above also passes if this function always returned one row,
// or an empty list. These two pin the other direction.
{
  check("a genuine batch really does produce several rows",
    slotNumbers({ resolved: ["1111111", "2222222", "3333333"], missing: [], referenceParts: [] }).length === 3);
  check("and a single named invoice really does produce one",
    slotNumbers({ resolved: [], missing: ["202604231"], referenceParts: [] }).length === 1);
}

console.log(failed === 0 ? "\nbank-slot-numbers: all green" : `\nbank-slot-numbers: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
