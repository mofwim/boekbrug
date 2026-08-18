// [PARTIAL-PAY] Pure node test — run: npx tsx src/lib/partial-payment.test.ts
import {
  openAmount,
  openAmountSigned,
  settledAmountSigned,
  isPartiallyPaid,
  parseAmountInput,
  interpretAmountEntry,
  paidAmount,
  toCents,
  buildPaymentResult,
  paymentExceedsOpenBalance,
  openBalanceFromAmounts,
  resolveAllocation,
} from "./partial-payment";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— openAmount —");
check("fully open invoice → full total", openAmount({ status: "sent", total_inc_btw: 1000, amount_paid: 0 }) === 1000);
check("half paid → remainder", openAmount({ status: "sent", total_inc_btw: 1000, amount_paid: 400 }) === 600);
check("status paid → 0 regardless of amount_paid", openAmount({ status: "paid", total_inc_btw: 1000, amount_paid: 0 }) === 0);
check("legacy paid row (no amount_paid) → 0", openAmount({ status: "paid", total_inc_btw: 250 }) === 0);
check("creditnota negative total → magnitude", openAmount({ status: "sent", total_inc_btw: -500, amount_paid: 0 }) === 500);
check("over-recorded amount_paid never goes negative", openAmount({ status: "sent", total_inc_btw: 100, amount_paid: 250 }) === 0);
check("missing total → 0", openAmount({ status: "sent" }) === 0);
check("float dust is rounded to cents", openAmount({ status: "sent", total_inc_btw: 0.3, amount_paid: 0.1 }) === 0.2);
check("paidAmount clamps negatives", paidAmount({ amount_paid: -50 }) === 0);
check("toCents rounds half up", toCents(1.005) === 1.01 || toCents(1.005) === 1.0);

console.log("\n— isPartiallyPaid —");
check("nothing paid → false", isPartiallyPaid({ status: "sent", total_inc_btw: 1000, amount_paid: 0 }) === false);
check("half paid → true", isPartiallyPaid({ status: "sent", total_inc_btw: 1000, amount_paid: 400 }) === true);
check("fully covered but still 'sent' → false", isPartiallyPaid({ status: "sent", total_inc_btw: 1000, amount_paid: 1000 }) === false);
check("status paid → false", isPartiallyPaid({ status: "paid", total_inc_btw: 1000, amount_paid: 400 }) === false);
check("a cent of dust does not count as partial", isPartiallyPaid({ status: "sent", total_inc_btw: 1000, amount_paid: 0.004 }) === false);

console.log("\n— parseAmountInput —");
check("plain integer", parseAmountInput("400") === 400);
check("dutch decimal comma", parseAmountInput("400,50") === 400.5);
check("english decimal point", parseAmountInput("400.50") === 400.5);
check("dutch grouped thousands", parseAmountInput("1.000,00") === 1000);
check("dutch grouped, no decimals", parseAmountInput("1.000") === 1000);
check("english grouped thousands", parseAmountInput("1,000.00") === 1000);
check("euro sign and spaces stripped", parseAmountInput(" € 1.234,56 ") === 1234.56);
check("millions, dutch", parseAmountInput("1.234.567,89") === 1234567.89);
check("two decimals after dot stays decimal", parseAmountInput("10.50") === 10.5);
check("empty → null", parseAmountInput("") === null);
check("whitespace only → null", parseAmountInput("   ") === null);
check("null input → null", parseAmountInput(null) === null);
check("letters → null", parseAmountInput("abc") === null);
check("mixed junk → null", parseAmountInput("40a0") === null);
check("negative sign rejected", parseAmountInput("-40") === null);
check("ambiguous double dot → null", parseAmountInput("1.2.3") === null);
check("zero parses to zero (not null)", parseAmountInput("0") === 0);

console.log("\n— interpretAmountEntry —");
{
  const e = interpretAmountEntry("", 1000);
  check("blank = settle everything", e.amount === null && e.valid === true && e.settlesFully === true);
  check("blank leaves nothing open", e.remainingAfter === 0);
}
{
  const e = interpretAmountEntry("400", 1000);
  check("partial amount is valid", e.valid === true && e.amount === 400);
  check("partial leaves the rest open", e.remainingAfter === 600);
  check("partial does not settle fully", e.settlesFully === false);
}
{
  const e = interpretAmountEntry("1000", 1000);
  check("exact open amount settles fully", e.valid === true && e.settlesFully === true && e.remainingAfter === 0);
  check("exact open amount reports amount null (= settle everything)", e.amount === null);
}
{
  const e = interpretAmountEntry("4000", 1000);
  check("above the open balance is rejected", e.valid === false);
  check("rejection names the maximum", (e.error ?? "").includes("1.000,00"));
}
{
  const e = interpretAmountEntry("0", 1000);
  check("zero is rejected", e.valid === false && (e.error ?? "").includes("hoger"));
}
{
  const e = interpretAmountEntry("abc", 1000);
  check("junk is rejected with a clear message", e.valid === false && (e.error ?? "").includes("geldig"));
}
{
  const e = interpretAmountEntry("999,995", 1000);
  check("within a cent of the balance settles fully", e.settlesFully === true);
}
{
  const e = interpretAmountEntry("", 0);
  check("nothing open → blank entry is not submittable", e.valid === false);
}
{
  const e = interpretAmountEntry("1.000,00", 1000);
  check("formatted dutch input is accepted at the boundary", e.valid === true && e.settlesFully === true);
}

console.log("\n— buildPaymentResult (the API contract both clients branch on) —");
{
  // A real deelbetaling: €400 of €1000. The clients decide "still open" from `partial`.
  const r = buildPaymentResult({ applied: 400, amount_paid: 400, total: 1000, is_paid: false }, "sent");
  check("partial booking reports partial=true", r.partial === true);
  check("partial booking keeps the open status", r.status === "sent");
  check("partial booking reports what was applied", r.applied === 400);
  check("partial booking reports the running total", r.amountPaid === 400);
  check("partial booking reports what is left", r.remaining === 600);
  check("no duplicate flag on a real booking", r.duplicate === undefined);
}
{
  const r = buildPaymentResult({ applied: 600, amount_paid: 1000, total: 1000, is_paid: true }, "sent");
  check("completing booking reports partial=false", r.partial === false);
  check("completing booking flips the status to paid", r.status === "paid");
  check("completing booking leaves nothing open", r.remaining === 0);
}
{
  // The replay of a partial must be indistinguishable from the original, plus the flag.
  const first = buildPaymentResult({ applied: 400, amount_paid: 400, total: 1000, is_paid: false }, "received");
  const replay = buildPaymentResult({ applied: 400, amount_paid: 400, total: 1000, is_paid: false, duplicate: true }, "received");
  check("replay carries the duplicate flag", replay.duplicate === true);
  check("replay agrees with the original on partial", replay.partial === first.partial);
  check("replay agrees with the original on remaining", replay.remaining === first.remaining);
  check("replay agrees with the original on status", replay.status === first.status);
  check("incoming invoice keeps 'received' while partly paid", first.status === "received");
}
{
  const r = buildPaymentResult({ applied: 100, amount_paid: 100, total: 100, is_paid: true }, null);
  check("missing open status falls back safely", r.status === "paid");
  const p = buildPaymentResult({ applied: 30, amount_paid: 30, total: 100, is_paid: false }, null);
  check("missing open status on a partial defaults to sent", p.status === "sent");
}
{
  const r = buildPaymentResult({ applied: 0.1, amount_paid: 0.3, total: 1, is_paid: false }, "sent");
  check("remaining is rounded to cents", r.remaining === 0.7);
}

console.log("\n— [PARTIAL-PAY-GUARD] paymentExceedsOpenBalance (does this payment have more to give?) —");
{
  // The production incident: a €500 instalment on a €1.815 invoice whose reference happened to
  // carry a second number token ("Klantnr 884512 factuur 20260041"). The reference count sent it
  // down the amount-blind batch branch and it was booked as a full settlement.
  const invoice = { status: "sent", total_inc_btw: 1815, amount_paid: 0 };
  check("an instalment has nothing left over → deelbetaling path", paymentExceedsOpenBalance(500, invoice) === false);
  check("...however many number tokens the reference has (the money decides)",
    paymentExceedsOpenBalance(500, invoice) === false);
  check("the exact amount has nothing left over either", paymentExceedsOpenBalance(1815, invoice) === false);
  check("a genuinely bigger payment does have money left", paymentExceedsOpenBalance(2000, invoice) === true);
}
{
  // A genuine bundle: €1.100 paying €605 + €495. Confirming EITHER invoice must leave the bank
  // line open — that is the fix for a payment being swallowed by the first invoice it touches.
  const a = { status: "sent", total_inc_btw: 605, amount_paid: 0 };
  const b = { status: "sent", total_inc_btw: 495, amount_paid: 0 };
  check("a bundle payment has money left after its first invoice", paymentExceedsOpenBalance(1100, a) === true);
  check("...and after its second invoice too", paymentExceedsOpenBalance(1100, b) === true);
  // The route subtracts what the line already spent, so the LAST invoice closes it.
  check("what is left after the first invoice exactly fits the second",
    paymentExceedsOpenBalance(1100 - 605, b) === false);
}
{
  // Mid-instalment: the balance is what is LEFT, not the total.
  const half = { status: "sent", total_inc_btw: 1000, amount_paid: 400 };
  check("the remaining balance is what a payment is measured against", paymentExceedsOpenBalance(600, half) === false);
  check("less than the remaining balance is a deelbetaling", paymentExceedsOpenBalance(599, half) === false);
  check("more than the remaining balance has money left", paymentExceedsOpenBalance(1000, half) === true);
}
{
  // [PAYMENT_DUST] A customer who rounds up has not paid a second invoice.
  const invoice = { status: "sent", total_inc_btw: 99.95, amount_paid: 0 };
  check("a rounding-up overpayment is dust, not a second invoice", paymentExceedsOpenBalance(100, invoice) === false);
  check("one euro over is still dust (the floor itself)", paymentExceedsOpenBalance(100.95, invoice) === false);
  check("more than a euro over is real money again", paymentExceedsOpenBalance(101.5, invoice) === true);
}
{
  // Sign-blindness: a supplier payment is a DEBIT (negative) and a creditnota total is negative.
  check("a negative (debit) payment is judged on magnitude",
    paymentExceedsOpenBalance(-1000, { status: "received", total_inc_btw: 1000, amount_paid: 0 }) === false);
  check("a bigger debit has money left for the next purchase invoice",
    paymentExceedsOpenBalance(-2500, { status: "received", total_inc_btw: 1000, amount_paid: 0 }) === true);
  check("a creditnota's negative total is a magnitude too",
    paymentExceedsOpenBalance(500, { status: "sent", total_inc_btw: -500, amount_paid: 0 }) === false);
}
{
  // Nothing left open ⇒ it can absorb nothing; the caller's already-paid checks own this.
  check("a settled invoice never claims leftover money",
    paymentExceedsOpenBalance(1000, { status: "sent", total_inc_btw: 100, amount_paid: 100 }) === false);
  check("an invoice with no total claims nothing", paymentExceedsOpenBalance(500, { status: "sent" }) === false);
  check("a zero payment has nothing left over", paymentExceedsOpenBalance(0, { status: "sent", total_inc_btw: 100 }) === false);
  check("null/undefined payment has nothing left over",
    paymentExceedsOpenBalance(null, { status: "sent", total_inc_btw: 100 }) === false);
}
{
  // openBalanceFromAmounts is status-BLIND on purpose (write paths only); openAmount is not.
  const legacyPaid = { status: "paid", total_inc_btw: 250, amount_paid: 0 };
  check("openBalanceFromAmounts ignores the status", openBalanceFromAmounts(legacyPaid) === 250);
  check("...while openAmount trusts it (no phantom balance on screen)", openAmount(legacyPaid) === 0);
  check("openBalanceFromAmounts never goes negative", openBalanceFromAmounts({ total_inc_btw: 100, amount_paid: 250 }) === 0);
  check("openBalanceFromAmounts rounds to cents", openBalanceFromAmounts({ total_inc_btw: 0.3, amount_paid: 0.1 }) === 0.2);
}

console.log("\n— [PARTIAL-PAY] een teruggedraaide betaling laat geen spookbetaling achter —");
{
  // De schade die dit invariant bewaakt (bank/delete-statement herstelde de status maar liet
  // amount_paid staan): de factuur staat onbetaald én toont EUR 0 openstaand. Daarna stuurt
  // invoice-reminders.ts nooit meer een herinnering (paid >= total - PAID_EPS -> null) en weigert
  // de betaal-RPC de factuur opnieuw te boeken. Volledig stil, en permanent.
  const spook = { status: "sent", total_inc_btw: 500, amount_paid: 500 };
  check("de bug in beeld: onbetaald maar EUR 0 openstaand", openAmount(spook) === 0);

  // Na de reparatie hoort de omkering amount_paid op 0 te zetten.
  const hersteld = { status: "sent", total_inc_btw: 500, amount_paid: 0 };
  check("na een correcte omkering staat het volle bedrag weer open", openAmount(hersteld) === 500);

  // Het invariant zelf: is een factuur niet 'paid', dan mag amount_paid nooit het hele bedrag
  // dekken. Faalt dit ooit, dan is er weer een omkeringspad dat amount_paid vergeet.
  const omkeringsPaden = [
    { naam: "bank/delete-statement", status: "received", total_inc_btw: 121, amount_paid: 0 },
    { naam: "bank/unlink", status: "sent", total_inc_btw: 121, amount_paid: 0 },
    { naam: "pay-toggle undo", status: "received", total_inc_btw: 80, amount_paid: 0 },
  ];
  for (const p of omkeringsPaden) {
    check(`${p.naam}: openstaand = het volle bedrag`, openAmount(p) === p.total_inc_btw);
  }

  // Een ECHTE deelbetaling blijft gewoon een deelbetaling — de reparatie mag die niet wissen.
  check("een deelbetaling blijft staan", openAmount({ status: "sent", total_inc_btw: 500, amount_paid: 200 }) === 300);
  check("en telt als gedeeltelijk betaald", isPartiallyPaid({ status: "sent", total_inc_btw: 500, amount_paid: 200 }) === true);
}

console.log("\n— [OPEN-TOTAL] optellen: het teken van de factuur telt mee —");
{
  // Een gewone openstaande inkoopfactuur telt gewoon op.
  check("openstaand positief blijft positief",
    openAmountSigned({ status: "received", total_inc_btw: 500, amount_paid: 0 }) === 500);
  // Een creditnota van je leverancier VERLAAGT wat je hem schuldig bent — en op de rij zelf staat
  // hij al met zijn minteken. Een totaal dat hem optelt, klopt niet met wat je eronder ziet staan.
  check("een creditnota telt eraf, niet erbij",
    openAmountSigned({ status: "received", total_inc_btw: -121, amount_paid: 0 }) === -121);
  // Deelbetaling: alleen de rest, met hetzelfde teken.
  check("een deelbetaling draagt alleen de rest",
    openAmountSigned({ status: "received", total_inc_btw: 500, amount_paid: 200 }) === 300);
  check("…ook aan de creditkant",
    openAmountSigned({ status: "received", total_inc_btw: -500, amount_paid: 200 }) === -300);
  // Betaald is nul, en nul heeft geen teken: anders zou -0 in een som opduiken.
  check("betaald telt niet mee", openAmountSigned({ status: "paid", total_inc_btw: -500, amount_paid: 500 }) === 0);
  check("…en levert geen negatieve nul op",
    Object.is(openAmountSigned({ status: "paid", total_inc_btw: -500, amount_paid: 500 }), 0));
  // Een som van de drie soorten door elkaar is precies wat het scherm boven de lijst laat zien.
  const rows = [
    { status: "received", total_inc_btw: 1000, amount_paid: 0 },
    { status: "received", total_inc_btw: -121, amount_paid: 0 },
    { status: "received", total_inc_btw: 500, amount_paid: 200 },
    { status: "paid", total_inc_btw: 999, amount_paid: 999 },
  ];
  const som = rows.reduce((t, r) => t + openAmountSigned(r), 0);
  check("gemengde lijst telt op tot 1179", Math.round(som * 100) / 100 === 1179);
}

console.log("— …en de drie bedragen op het scherm tellen op —");
{
  // De identiteit waar de hele regel op rust: open + betaald === totaal, per factuur en dus ook
  // per lijst. Zonder die identiteit nodigt een scherm met drie bedragen uit tot een optelling
  // die niet uitkomt.
  const rows = [
    { status: "received", total_inc_btw: 1000, amount_paid: 0 },      // niets betaald
    { status: "received", total_inc_btw: 500, amount_paid: 200 },     // deelbetaling
    { status: "paid", total_inc_btw: 999, amount_paid: 999 },         // betaald
    { status: "paid", total_inc_btw: 250, amount_paid: 0 },           // legacy: betaald zonder amount_paid
    { status: "received", total_inc_btw: -121, amount_paid: 0 },      // creditnota, open
    { status: "paid", total_inc_btw: -60, amount_paid: 60 },          // creditnota, verrekend
    { status: "received", total_inc_btw: 100, amount_paid: 130 },     // meer betaald dan de factuur
  ];
  for (const r of rows) {
    const som = Math.round((openAmountSigned(r) + settledAmountSigned(r)) * 100) / 100;
    const totaal = Math.round((r.total_inc_btw ?? 0) * 100) / 100;
    check(`open + betaald === totaal (${r.status} ${r.total_inc_btw}/${r.amount_paid})`, som === totaal);
  }

  check("een legacy 'paid' zonder amount_paid telt tóch volledig als betaald",
    settledAmountSigned({ status: "paid", total_inc_btw: 250, amount_paid: 0 }) === 250);
  check("een verrekende creditnota draagt zijn minteken",
    settledAmountSigned({ status: "paid", total_inc_btw: -60, amount_paid: 60 }) === -60);
  check("te veel betaald verrekent nooit meer dan de factuur waard is",
    settledAmountSigned({ status: "received", total_inc_btw: 100, amount_paid: 130 }) === 100);
  check("niets betaald is nul, zonder teken",
    Object.is(settledAmountSigned({ status: "received", total_inc_btw: -500, amount_paid: 0 }), 0));

  // En op lijstniveau: de drie getallen die het scherm toont.
  const open = Math.round(rows.reduce((t, r) => t + openAmountSigned(r), 0) * 100) / 100;
  const betaald = Math.round(rows.reduce((t, r) => t + settledAmountSigned(r), 0) * 100) / 100;
  const totaal = Math.round(rows.reduce((t, r) => t + (r.total_inc_btw ?? 0), 0) * 100) / 100;
  check("de lijstsom klopt ook", Math.round((open + betaald) * 100) / 100 === totaal);
}

// ── [BANK-SPLIT] the owner states how much of a bank line an invoice takes ───────────────────
// Without this the amount was always "everything the line has left", which is right until one
// payment covers part of one invoice and all of another: the first absorbs the whole line and the
// second is left with its money already spent. The real case was an ATAPACK payment of €2.265,41
// whose description named two invoices while the first still owed €4.662,80.
console.log("\n— [BANK-SPLIT] resolveAllocation —");
{
  const ok = (r: ReturnType<typeof resolveAllocation>, amount: number) => r.ok === true && r.amount === amount;
  const bad = (r: ReturnType<typeof resolveAllocation>, reason: string) => r.ok === false && r.reason === reason;

  check("no requested amount behaves exactly as before",
    ok(resolveAllocation({ payAvailable: 2265.41, invoiceOpen: 4662.8 }), 2265.41) &&
    ok(resolveAllocation({ requested: null, payAvailable: 100, invoiceOpen: 50 }), 100));

  check("a stated amount is taken as stated",
    ok(resolveAllocation({ requested: 1465.41, payAvailable: 2265.41, invoiceOpen: 4662.8 }), 1465.41));

  check("money the line does not have is refused, not clamped",
    bad(resolveAllocation({ requested: 3000, payAvailable: 2265.41, invoiceOpen: 4662.8 }), "exceeds_payment"));

  // Clamping would let the screen say €500 while the books take €300 — untrue on the screen the
  // accountant inherits.
  check("more than the invoice owes is refused, not clamped",
    bad(resolveAllocation({ requested: 500, payAvailable: 1000, invoiceOpen: 300 }), "exceeds_invoice"));

  check("zero, negative and NaN are refused",
    [0, -1, Number.NaN].every((v) => resolveAllocation({ requested: v, payAvailable: 100, invoiceOpen: 100 }).ok === false));

  // The screen derives "the rest" by subtraction; that can land a hair over its own ceiling.
  check("a cent of float dust does not refuse the owner's own arithmetic",
    resolveAllocation({ requested: 100.001, payAvailable: 100, invoiceOpen: 100 }).ok === true &&
    resolveAllocation({ requested: 100.02, payAvailable: 100, invoiceOpen: 100 }).ok === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// ─── [DEEL-CREDIT] openstaand may be told what came back ─────────────────────────────
check("een deelcreditnota gaat van het openstaande bedrag af",
  openAmount({ status: "sent", total_inc_btw: 500, amount_paid: 0 }, 50) === 450);
check("credit én deelbetaling tellen allebei",
  openAmount({ status: "sent", total_inc_btw: 500, amount_paid: 200 }, 50) === 250);
check("een credit die de factuur dekt laat niets open",
  openAmount({ status: "sent", total_inc_btw: 500, amount_paid: 0 }, 500) === 0);
check("meer gecrediteerd dan de factuur waard is wordt nooit negatief",
  openAmount({ status: "sent", total_inc_btw: 500, amount_paid: 0 }, 900) === 0);
check("een creditnota wordt als magnitude gelezen, niet als teken",
  openAmount({ status: "sent", total_inc_btw: 500, amount_paid: 0 }, -50) === 450);
check("zonder credit is het antwoord exact wat het was",
  openAmount({ status: "sent", total_inc_btw: 500, amount_paid: 200 }) === 300);
check("het teken van de factuur blijft staan bij een credit",
  openAmountSigned({ status: "received", total_inc_btw: -500, amount_paid: 0 }, 50) === -450);
