// [SMART-INTAKE] Pure node test — run: npx tsx src/lib/intake-router.test.ts
// Locks the routing decision, especially the [PEN-MARK] path: a paper invoice the owner
// wrote/stamped "betaald · kas · date" on is routed to the verify queue with a PAID suggestion
// (method + date carried through) — never auto-booked. A plain unpaid invoice stays unpaid.
import { decideFromAi } from "./intake-router";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— non-invoice / statement → bestanden, never a paid suggestion —");
check("not an invoice → document, no paid suggestion",
  (() => { const d = decideFromAi({ is_invoice: false }); return d.destination === "document" && d.suggestPaid === false; })());
check("document_kind other → document",
  decideFromAi({ is_invoice: true, document_kind: "other" }).destination === "document");

console.log("\n— receipt → verify queue, paid suggestion carries method + date —");
{
  const d = decideFromAi({ is_invoice: true, document_kind: "receipt", is_paid: true, paid_method: "pin", paid_date: "2026-04-03" });
  check("paid receipt → receipt + suggestPaid", d.destination === "receipt" && d.suggestPaid === true);
  // [BON-BETAALWIJZE] 'pin' wordt hier 'bank': een pinbetaling landt op de bankrekening, en
  // "pin" is een waarde die cash-settle noch bank/confirm herkent.
  check("receipt carries method + date", d.paidMethod === "bank" && d.paidDate === "2026-04-03");
  check("model-only method is niet 'zeker' — het papier zei niets", d.paidMethodZeker === false);
  const u = decideFromAi({ is_invoice: true, document_kind: "receipt", is_paid: false });
  check("unpaid receipt → no paid suggestion, no method leaked", u.suggestPaid === false && (u.paidMethod ?? null) === null);
}

console.log("\n— [PEN-MARK] an INVOICE marked paid by hand/stamp → verify queue + paid suggestion —");
{
  const d = decideFromAi({ is_invoice: true, document_kind: "invoice", is_paid: true, paid_method: "kas", paid_date: "2026-02-16" });
  check("pen-marked invoice → invoice destination + suggestPaid", d.destination === "invoice" && d.suggestPaid === true);
  check("carries kas + date so the verify modal can pre-fill", d.paidMethod === "kas" && d.paidDate === "2026-02-16");
  check("reason names the pen-mark path", d.reason === "ai_invoice_pen_paid");
}

console.log("\n— a plain UNPAID invoice stays unpaid (no false paid) —");
{
  const d = decideFromAi({ is_invoice: true, document_kind: "invoice", is_paid: false });
  check("unpaid invoice → suggestPaid false", d.destination === "invoice" && d.suggestPaid === false);
  check("no method/date on an unpaid invoice", (d.paidMethod ?? null) === null && (d.paidDate ?? null) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
