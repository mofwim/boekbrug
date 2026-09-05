// src/lib/autonomy-scope.test.ts — run: npx tsx src/lib/autonomy-scope.test.ts
// [MANDAAT-SOORT] Per-category autonomy. The property that matters most is the last block.
import { decide, hasScope, NO_SCOPE, type AutonomyScope, type DocumentFacts } from "./autonomy-scope";

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) { console.error(`FAIL ${name}`); failed++; } else { console.log(`ok   ${name}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(`${name}${g === w ? "" : `  (got ${g}, want ${w})`}`, g === w);
}

/** A clean invoice from a supplier with a long history — the case autonomy exists for. */
const SCHOON: DocumentFacts = {
  supplierInvoiceCount: 30, amountIncBtw: 340.15, needsReview: false, ibanChanged: false,
};
const RUIM: AutonomyScope = { knownSupplierMinInvoices: 4, maxAmount: 2500 };

// ── No scope means no opinion, never permission ───────────────────────────────
eq("no scope at all → no opinion", decide(null, SCHOON).decision, "no-opinion");
eq("undefined → no opinion", decide(undefined, SCHOON).decision, "no-opinion");
eq("the empty scope → no opinion", decide(NO_SCOPE, SCHOON).decision, "no-opinion");
eq("zeroes are not a grant", decide({ knownSupplierMinInvoices: 0, maxAmount: 0 }, SCHOON).decision, "no-opinion");
check("hasScope agrees", !hasScope(NO_SCOPE) && !hasScope(null) && hasScope(RUIM));

// ── Inside the scope ──────────────────────────────────────────────────────────
eq("a long-known supplier, well under the limit → allow", decide(RUIM, SCHOON).decision, "allow");
eq("exactly ON the limit is inside it", decide(RUIM, { ...SCHOON, amountIncBtw: 2500 }).decision, "allow");
eq("exactly the minimum count is enough", decide(RUIM, { ...SCHOON, supplierInvoiceCount: 4 }).decision, "allow");

// ── The three refusals no grant can override ─────────────────────────────────
{
  const v = decide(RUIM, { ...SCHOON, ibanChanged: true });
  eq("a changed IBAN is held even on a perfect invoice", v.decision, "hold");
  check("and says why", /rekeningnummer/.test(v.reason ?? ""));
}
{
  const v = decide(RUIM, { ...SCHOON, needsReview: true });
  eq("a flagged document is held", v.decision, "hold");
  check("and says why", /waarschuwing/.test(v.reason ?? ""));
}
{
  const v = decide(RUIM, { ...SCHOON, amountIncBtw: null });
  eq("an unread amount is held", v.decision, "hold");
  check("and says why", /bedrag/.test(v.reason ?? ""));
}
// The IBAN refusal outranks the others: it is the worst fact, so it is the sentence the owner reads.
{
  const v = decide(RUIM, { ...SCHOON, ibanChanged: true, needsReview: true, amountIncBtw: null });
  check("IBAN is named first when several things are wrong", /rekeningnummer/.test(v.reason ?? ""));
}

// ── The grants themselves ─────────────────────────────────────────────────────
{
  const v = decide(RUIM, { ...SCHOON, amountIncBtw: 2500.01 });
  eq("one cent over the limit is held", v.decision, "hold");
  check("and the sentence names the limit in Dutch", /€ 2\.500,00/.test(v.reason ?? ""));
}
{
  const v = decide(RUIM, { ...SCHOON, supplierInvoiceCount: 0 });
  eq("a supplier nobody has seen is held", v.decision, "hold");
  check("and the sentence says it is the first one", /nog niet in je administratie/.test(v.reason ?? ""));
}
{
  const v = decide(RUIM, { ...SCHOON, supplierInvoiceCount: 2 });
  eq("too few invoices from this supplier is held", v.decision, "hold");
  check("and the sentence names the count", /\(2\)/.test(v.reason ?? ""));
}
// A negative amount is a creditnota; the limit is about size, not direction.
eq("a credit of the same size is judged on its size", decide(RUIM, { ...SCHOON, amountIncBtw: -340.15 }).decision, "allow");

// ── [DE EIGENSCHAP] This module can only ever REFUSE ──────────────────────────
//
// Adding it to a call site must never cause a document to be booked that would not have been
// booked before. Every combination below is checked: the answer is "allow" ONLY when a scope was
// stated, and a stated scope can only narrow what the caller would otherwise have done.
{
  const scopes: (AutonomyScope | null | undefined)[] = [
    null, undefined, NO_SCOPE, { knownSupplierMinInvoices: 0 }, { maxAmount: 0 },
    { maxAmount: 50 }, { knownSupplierMinInvoices: 1 }, RUIM,
    { knownSupplierMinInvoices: 999 }, { maxAmount: 1_000_000 },
  ];
  const feiten: DocumentFacts[] = [];
  for (const count of [0, 1, 4, 30]) {
    for (const bedrag of [null, 0, 10, 340.15, 2500, 99999]) {
      for (const review of [false, true]) {
        for (const iban of [false, true]) {
          feiten.push({ supplierInvoiceCount: count, amountIncBtw: bedrag, needsReview: review, ibanChanged: iban });
        }
      }
    }
  }
  let allow = 0, hold = 0, geen = 0, fout = 0;
  for (const s of scopes) {
    for (const f of feiten) {
      const v = decide(s, f);
      if (v.decision === "allow") {
        allow++;
        // An "allow" is only ever legitimate with a stated scope AND a clean document.
        if (!hasScope(s) || f.needsReview || f.ibanChanged || f.amountIncBtw === null) fout++;
      } else if (v.decision === "hold") {
        hold++;
        if (!v.reason) fout++; // a hold with no sentence is a dead end
      } else {
        geen++;
        if (v.reason !== null) fout++;
      }
    }
  }
  check(`no 'allow' without a scope and a clean document (${allow} allow · ${hold} hold · ${geen} no-opinion)`, fout === 0);
  // [NEGATIEVE CONTROLE] The sweep proves nothing if it never reaches all three answers.
  check("the sweep actually reaches allow", allow > 0);
  check("the sweep actually reaches hold", hold > 0);
  check("the sweep actually reaches no-opinion", geen > 0);
}

console.log(failed === 0 ? "\nautonomy-scope: all green" : `\nautonomy-scope: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
