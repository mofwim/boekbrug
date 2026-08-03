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

console.log("\n— [BON-BETAALD] the printed tender line is the payment, even when is_paid is unset —");
{
  // The Lidl Eemnes receipt: "Contant 24,00 / Wisselgeld -0,35". Change came back, so cash went
  // over the counter — there is no reading of that line in which the bon is still to be paid.
  const contant = decideFromAi({
    is_invoice: true, document_kind: "receipt",
    paid_evidence: "TOTAAL 24,35 Contant 24,00 Wisselgeld -0,35",
  });
  check("wisselgeld/contant → suggestPaid, without ai.is_paid", contant.suggestPaid === true);
  check("and it is 'kas', stated with certainty", contant.paidMethod === "kas" && contant.paidMethodZeker === true);
  check("reason names the paper, not the model", contant.reason === "bon_tender_paid");

  const pas = decideFromAi({
    is_invoice: true, document_kind: "receipt",
    paid_evidence: "Bankpas  46,22  Kaart xxxxxxxxxxxx6596",
  });
  check("bankpas → suggestPaid + bank", pas.suggestPaid === true && pas.paidMethod === "bank");
  check("the card digits survive for the later bank match", pas.paidCardLast4 === "6596");

  // A bon whose paper says nothing about settlement is STILL a bon, and ai.ts defines that kind as
  // "a PAID proof" — you hold it because the counter was paid. So the suggestion stands on the kind
  // alone. What it must NOT do is invent a method: nothing said how, so the screen asks.
  const stil = decideFromAi({ is_invoice: true, document_kind: "receipt", paid_evidence: "Aantal artikelen 7" });
  check("no tender line → still suggested paid (the kind is the proof)", stil.suggestPaid === true);
  check("…but no method is claimed, so the screen asks",
    (stil.paidMethod ?? null) === null && stil.paidMethodZeker === false && stil.reason === "bon_kind_is_proof");

  // Contradictory paper (card AND cash words) is the "ask the owner" branch of gokBetaalwijze. The
  // contradiction is about HOW, never about WHETHER — both readings agree the counter was paid —
  // so the suggestion holds and the method stays empty rather than being picked at random.
  const strijdig = decideFromAi({ is_invoice: true, document_kind: "receipt", paid_evidence: "Bankpas ... Wisselgeld 0,05" });
  check("contradictory tender words → still paid, but no method claimed",
    strijdig.suggestPaid === true && (strijdig.paidMethod ?? null) === null && strijdig.paidMethodZeker === false);

  // The one thing that DOES hold it back: the reader positively saying it was not paid. Absence is
  // silence and silence does not outrank the kind; an explicit false is a statement about the paper.
  const ontkend = decideFromAi({ is_invoice: true, document_kind: "receipt", is_paid: false });
  check("an explicit is_paid=false on a silent paper holds the suggestion back", ontkend.suggestPaid === false);

  // …unless the PAPER contradicts the denial. A printed "Wisselgeld" outranks any interpretation
  // of it — that is the rule bon-betaalwijze.ts exists for.
  const papierWint = decideFromAi({ is_invoice: true, document_kind: "receipt", is_paid: false, paid_evidence: "Contant 24,00 Wisselgeld -0,35" });
  check("a printed tender line outranks the model's denial", papierWint.suggestPaid === true && papierWint.paidMethod === "kas");

  // And an INVOICE is untouched by all of it: an invoice is a request for payment, so its kind
  // proves nothing and it still needs the model or a pen mark to say otherwise.
  const factuur = decideFromAi({ is_invoice: true, document_kind: "invoice", paid_evidence: "IBAN NL65RABO0171136276" });
  check("an invoice is never paid by virtue of its kind", factuur.suggestPaid === false);

  // And the model's own opinion alone is still not 'zeker' — unchanged.
  const model = decideFromAi({ is_invoice: true, document_kind: "receipt", is_paid: true, paid_method: "kas" });
  check("model-only paid receipt still asks about the method", model.suggestPaid === true && model.paidMethodZeker === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
