// [CREDITNOTA-SIGNAL] Pure node test — run: npx tsx --test src/lib/creditnota-signal.test.ts
//
// Two sides, and the second one matters most:
//   1. the real case is recognised (CR next to RE from the same supplier);
//   2. the signal stays QUIET on everything that merely resembles it. A false signal sends the
//      owner to an invoice they DO have to pay, and flipping that one produces a dunning letter.
//      Silence is the safe side here, which is what most of these tests are about.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  numberPrefix, looksLikeCreditnota, creditnotaSignalText, creditnotaSignConflict, asCreditAmounts,
  creditStance, payableAsDebt, looksLikeCreditnotaByNumber, creditWordInHeader,
} from "./creditnota-signal";

/** The real case: this wholesaler sends CR credit notes alongside RE invoices. */
const WHOLESALER = ["CR0300343", "CR0300510", "RE0801378"];

const check = (over: Partial<Parameters<typeof looksLikeCreditnota>[0]> = {}) =>
  looksLikeCreditnota({
    invoiceNumber: "CR0300343",
    totalIncBtw: 51.8,
    invoiceType: "factuur",
    vendorNumbers: WHOLESALER,
    ...over,
  });

test("[CONTRADICTION] a credit note with a POSITIVE amount is not a suspicion but an error", () => {
  // The reader already established the kind; there is nothing to guess. The money points the wrong
  // way: it counts toward "still to pay" and its input tax is added instead of subtracted.
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: 51.8 }), true);
  // The correct state reports nothing.
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: -51.8 }), false);
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: 0 }), false);
  // And an ordinary invoice falls outside this by definition — it is supposed to be positive.
  assert.equal(creditnotaSignConflict({ invoiceType: "factuur", totalIncBtw: 871.4 }), false);
  assert.equal(creditnotaSignConflict({ invoiceType: null, totalIncBtw: 871.4 }), false);
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: Number.NaN }), false);
});

test("the prefix is the leading letters, and nothing else", () => {
  assert.equal(numberPrefix("CR0300343"), "CR");
  assert.equal(numberPrefix("RE0801378"), "RE");
  assert.equal(numberPrefix("2033161"), "", "a purely numeric number has no prefix");
  assert.equal(numberPrefix("cr-123"), "CR", "lowercase counts just the same");
  assert.equal(numberPrefix("  CN 99 "), "CN");
  assert.equal(numberPrefix(null), "");
  assert.equal(numberPrefix(""), "");
  assert.equal(numberPrefix("F2033161"), "F");
});

test("the real case is recognised", () => {
  const s = check();
  assert.equal(s.suspected, true);
  assert.equal(s.prefix, "CR");
  assert.equal(s.contrastPrefix, "RE");
  // And the explanation names both prefixes, so the owner can check what we saw.
  const text = creditnotaSignalText(s);
  assert.ok(text && text.includes("CR") && text.includes("RE"), text ?? "");
});

test("an already correctly booked credit note gives NO signal", () => {
  // This is the desired end state — no warning belongs on it.
  assert.equal(check({ invoiceType: "creditnota" }).suspected, false);
});

test("an already negative stored amount gives NO signal", () => {
  // The money already points the right way: it comes off the balance. This signal is about money
  // pointing the wrong way, not about labelling.
  assert.equal(check({ totalIncBtw: -51.8 }).suspected, false);
  assert.equal(check({ totalIncBtw: 0 }).suspected, false);
});

test("[QUIET] an unknown prefix stays silent", () => {
  // "F", "INV", "KR" — we do not know what those mean, so we say nothing.
  for (const nr of ["F0300343", "INV0300343", "KR0300343", "2033161"]) {
    assert.equal(check({ invoiceNumber: nr }).suspected, false, nr);
  }
});

test("[QUIET] without a counterpart from the same supplier the signal stays silent", () => {
  // This is the second requirement, and the important one: the evidence comes from the supplier
  // itself, not from our assumption about two letters. If everything is CR, then CR says nothing.
  assert.equal(check({ vendorNumbers: ["CR0300343", "CR0300510", "CR0300777"] }).suspected, false);
  assert.equal(check({ vendorNumbers: ["CR0300343"] }).suspected, false, "only itself is no evidence");
  assert.equal(check({ vendorNumbers: [] }).suspected, false);
  // Numberless documents from the same supplier do not count as a counterpart.
  assert.equal(check({ vendorNumbers: ["CR0300343", null, "", "   "] }).suspected, false);
  // Nor does a purely numeric number — it has no prefix. Otherwise every supplier who once sends a
  // letterless number would suddenly "have" a counterpart.
  assert.equal(check({ vendorNumbers: ["CR0300343", "2033161"] }).suspected, false);
});

test("the other known credit markers work too", () => {
  for (const nr of ["CN0001", "CRN0001", "CRED0001", "CREDIT0001", "CRE0001"]) {
    assert.equal(
      check({ invoiceNumber: nr, vendorNumbers: [nr, "RE0801378"] }).suspected,
      true,
      nr,
    );
  }
});

test("nonsense does not get through", () => {
  assert.equal(check({ invoiceNumber: null }).suspected, false);
  assert.equal(check({ totalIncBtw: null }).suspected, false);
  assert.equal(check({ totalIncBtw: Number.NaN }).suspected, false);
  assert.equal(check({ totalIncBtw: Number.POSITIVE_INFINITY }).suspected, false);
  assert.equal(creditnotaSignalText({ suspected: false, prefix: "", contrastPrefix: null }), null);
});

test("the whole list from the screenshot yields exactly two signals", () => {
  // Three documents from one supplier, all three booked positive as 'factuur'. The two CR numbers
  // should stand out; the RE invoice should be left alone.
  const rows = [
    { invoiceNumber: "CR0300343", totalIncBtw: 51.8 },
    { invoiceNumber: "CR0300510", totalIncBtw: 24.25 },
    { invoiceNumber: "RE0801378", totalIncBtw: 871.4 },
  ];
  const flagged = rows.filter(
    (r) => looksLikeCreditnota({ ...r, invoiceType: "factuur", vendorNumbers: WHOLESALER }).suspected,
  );
  assert.deepEqual(flagged.map((r) => r.invoiceNumber), ["CR0300343", "CR0300510"]);
  // And what is wrongly sitting in "still to pay" is the sum of those two.
  assert.equal(Math.round(flagged.reduce((s, r) => s + r.totalIncBtw, 0) * 100) / 100, 76.05);
});

// ── asCreditAmounts ───────────────────────────────────────────────────────────
// The tick "Dit is een creditnota" used to set invoice_type and nothing else, while its own label
// promised the money consequences. Nothing in this codebase reads the type when money is counted —
// openAmountSigned reads `total_inc_btw < 0`, and /api/aangifte sums btw_amount raw — so the sign
// is the only thing that makes a credit note behave like one.

test("[CREDIT-SIGN] a positively printed credit note is flipped, and the identity survives", () => {
  // The real Dutch Sweets row: 47.52 + 4.28 = 51.80, booked as a debt.
  const out = asCreditAmounts({ totalExBtw: 47.52, btwAmount: 4.28, totalIncBtw: 51.8 });
  assert.equal(out.flipped, true);
  assert.equal(out.totalIncBtw, -51.8);
  assert.equal(out.totalExBtw, -47.52);
  assert.equal(out.btwAmount, -4.28);
  assert.ok(Math.abs(out.totalExBtw + out.btwAmount - out.totalIncBtw) < 0.005, "ex + btw = incl still");
});

test("[CREDIT-SIGN] amounts that are already negative are left alone", () => {
  // The owner typed the minus themselves, or the reader read it. Flipping again would turn their
  // credit note back into a debt — the exact error this function exists to prevent.
  const out = asCreditAmounts({ totalExBtw: -100, btwAmount: -9, totalIncBtw: -109 });
  assert.equal(out.flipped, false);
  assert.deepEqual([out.totalExBtw, out.btwAmount, out.totalIncBtw], [-100, -9, -109]);
});

test("[CREDIT-SIGN] a zero total has no sign to give it", () => {
  const out = asCreditAmounts({ totalExBtw: 0, btwAmount: 0, totalIncBtw: 0 });
  assert.equal(out.flipped, false);
  assert.equal(out.totalIncBtw, 0);
});

test("[CREDIT-SIGN] the triplet flips as ONE, so a mixed-sign reading is not rewritten", () => {
  // A triplet whose parts do not share a sign: 200 + (−9) = 191. It happens on returned-goods lines
  // and on a partly credited invoice, and it satisfies the identity exactly as it stands.
  //
  // Per-field -Math.abs() would return (−200, −9, −191), and −200 + −9 = −209 ≠ −191: an identity
  // that held before the tick and is broken by it, which is the arithmetic gate's own alarm going
  // off because of us. One multiplication by −1 keeps whatever relationship the reading had.
  const before = { totalExBtw: 200, btwAmount: -9, totalIncBtw: 191 };
  assert.ok(Math.abs(before.totalExBtw + before.btwAmount - before.totalIncBtw) < 0.005, "the fixture itself holds");
  const out = asCreditAmounts(before);
  assert.equal(out.flipped, true);
  assert.deepEqual([out.totalExBtw, out.btwAmount, out.totalIncBtw], [-200, 9, -191]);
  assert.ok(Math.abs(out.totalExBtw + out.btwAmount - out.totalIncBtw) < 0.005, "and still holds after");
});

test("[CREDIT-SIGN] flipping resolves the sign conflict the app warns about", () => {
  // The two functions must agree: what creditnotaSignConflict flags, asCreditAmounts must fix.
  const before = { totalExBtw: 47.52, btwAmount: 4.28, totalIncBtw: 51.8 };
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: before.totalIncBtw }), true);
  const after = asCreditAmounts(before);
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: after.totalIncBtw }), false);
});

// ─── [CREDIT-SAFE] The stance every payable-widget reads ──────────────────────
// The case that prompted it: CREDITFACTUUR CR0301267 from Dutch Sweets Company, printed
// "Totaal bedrag (EUR) : € -33,87", stored +33,87 because the reader took the figures from the
// btw-berekening table (which prints them positive). The screen badged it "⚠ Lijkt een creditnota"
// AND offered a filled-in payment QR of € 33,87 AND dunned it "2 dagen te laat".

/** Dutch Sweets sends CR credit notes beside RE invoices — the contrast requirement 2 needs. */
const SWEETS = ["CR0301267", "RE0802039", "RE0802533", "RE0803119"];

test("[CREDIT-SAFE] the real case: a positively stored CR credit note is not payable", () => {
  const stance = creditStance({
    invoiceNumber: "CR0301267",
    totalIncBtw: 33.87,
    invoiceType: "factuur",
    vendorNumbers: SWEETS,
  });
  assert.equal(stance, "suspected");
  assert.equal(payableAsDebt(stance), false, "this is the QR that must not be offered");
});

test("[CREDIT-SAFE] an ordinary invoice from the same supplier stays payable", () => {
  // The other half of the guarantee. If RE0802039 also stopped being payable, the screen would have
  // traded one wrong answer for a worse one: an owner who cannot pay their bills.
  const stance = creditStance({
    invoiceNumber: "RE0802039",
    totalIncBtw: 740.47,
    invoiceType: "factuur",
    vendorNumbers: SWEETS,
  });
  assert.equal(stance, "none");
  assert.equal(payableAsDebt(stance), true);
});

test("[CREDIT-SAFE] a correctly booked credit note is 'credit', not 'suspected'", () => {
  // Booked right and stored negative: there is nothing to ask and nothing to repair. It must not
  // be payable either — the EPC builder already refuses a negative amount, and this says the same
  // thing one layer earlier, where the button lives.
  for (const inv of [
    { invoiceType: "creditnota", totalIncBtw: -33.87 },
    { invoiceType: "factuur", totalIncBtw: -33.87 }, // the money decides even when the type lags
  ]) {
    const stance = creditStance({ invoiceNumber: "CR0301267", vendorNumbers: SWEETS, ...inv });
    assert.equal(stance, "credit", JSON.stringify(inv));
    assert.equal(payableAsDebt(stance), false);
  }
});

test("[CREDIT-SAFE] type says creditnota, money says debt → 'conflict', and not payable", () => {
  const stance = creditStance({
    invoiceNumber: "2033161",
    totalIncBtw: 51.8,
    invoiceType: "creditnota",
    vendorNumbers: ["2033161"],
  });
  assert.equal(stance, "conflict");
  assert.equal(payableAsDebt(stance), false);
});

test("[CREDIT-SAFE] a CR number with no contrasting prefix is still payable", () => {
  // Requirement 2 of looksLikeCreditnota carries straight through: without a counterpart from the
  // same supplier, "CR" is our guess about two letters. Guesses do not block payments.
  const stance = creditStance({
    invoiceNumber: "CR0301267",
    totalIncBtw: 33.87,
    invoiceType: "factuur",
    vendorNumbers: ["CR0301267", "CR0300510"],
  });
  assert.equal(stance, "none");
  assert.equal(payableAsDebt(stance), true);
});

test("[CREDIT-SAFE] an unreadable total is not a credit note — it is unread", () => {
  // NaN is not negative. Answering 'credit' here would silently pull a row whose amount we failed
  // to read out of the payable list, which hides a real bill instead of protecting one.
  const stance = creditStance({
    invoiceNumber: "2033161",
    totalIncBtw: Number.NaN,
    invoiceType: "factuur",
    vendorNumbers: ["2033161"],
  });
  assert.equal(stance, "none");
});

test("[CREDIT-SAFE] answering 'ja' makes the row payable-free and quiet in one step", () => {
  // What the "Ja, dit is een creditnota" button does, end to end: the route flips the triplet with
  // asCreditAmounts and sets the type. Both signals must then be satisfied — no lingering warning
  // on a row that was just repaired, and no re-offer of the payment.
  const before = { totalExBtw: 31.07, btwAmount: 2.8, totalIncBtw: 33.87 };
  const after = asCreditAmounts(before);
  const stance = creditStance({
    invoiceNumber: "CR0301267",
    totalIncBtw: after.totalIncBtw,
    invoiceType: "creditnota",
    vendorNumbers: SWEETS,
  });
  assert.equal(stance, "credit");
  assert.equal(payableAsDebt(stance), false);
  assert.deepEqual(
    [after.totalExBtw, after.btwAmount, after.totalIncBtw],
    [-31.07, -2.8, -33.87],
    "the paper's own -33,87",
  );
});

// ─── [CREDIT-PREFIX-GATE] The number alone, and only to hold the human in the loop ────────────
// A weaker test than looksLikeCreditnota on purpose: it feeds the auto-advance gate, where the
// question is "may nobody look at this?", not "shall we flip the sign?".

test("[CREDIT-PREFIX-GATE] a credit-numbered row booked as a debt is held, with no contrast needed", () => {
  // No sibling RE… number anywhere: requirement 2 of looksLikeCreditnota is not met and it stays
  // silent — correctly, it would flip a sign. This one still holds the row for a glance.
  assert.equal(
    looksLikeCreditnotaByNumber({ invoiceNumber: "CR0301267", totalIncBtw: 33.87, invoiceType: "factuur" }),
    true,
  );
  assert.equal(
    looksLikeCreditnota({ invoiceNumber: "CR0301267", totalIncBtw: 33.87, invoiceType: "factuur", vendorNumbers: ["CR0301267"] }).suspected,
    false,
    "the sign-flip signal stays silent — the two bars are deliberately different",
  );
});

test("[CREDIT-PREFIX-GATE] silent once the question is settled", () => {
  // Already typed as a credit note, or already stored negative: the row behaves as a credit and
  // has nothing left to ask. Without this it would wear a permanent amber badge for being correct.
  for (const settled of [
    { invoiceNumber: "CR0301267", totalIncBtw: 33.87, invoiceType: "creditnota" },
    { invoiceNumber: "CR0301267", totalIncBtw: -33.87, invoiceType: "factuur" },
  ]) {
    assert.equal(looksLikeCreditnotaByNumber(settled), false, JSON.stringify(settled));
  }
});

test("[CREDIT-PREFIX-GATE] quiet on everything that merely starts with letters", () => {
  // The false-positive side, and the one that costs the owner attention rather than money. The
  // prefix list is short on purpose (no bare "C", no "KR"); these must all pass straight through.
  for (const n of [
    "RE0803119", "2033161", "CAMERA-1784373759249", "F-2026-0042",
    "CREM-2024-001",   // the leading ALPHA run is "CREM", not "CRE"
    "C-9931",          // a bare C is not on the list, and must not become one
    "KR-2026-14",      // "krediet"… or an article range. Too ambiguous to cost a tap.
    "", "   ",
  ]) {
    assert.equal(
      looksLikeCreditnotaByNumber({ invoiceNumber: n, totalIncBtw: 121, invoiceType: "factuur" }),
      false,
      `${JSON.stringify(n)} must not be read as a credit number`,
    );
  }
});

// ─── [CREDIT-WOORD] Het woord op het papier ─────────────────────────────────────

test("[CREDIT-WOORD] de kop die deze hele controle heeft veroorzaakt", () => {
  // Het echte document, zoals de tekstlaag het oplevert: het model gaf hierop is_credit_note=false.
  const kop =
    "Dutch Sweets Company B.V.\nPostbus 1234, 5000 AA Tilburg\n\n" +
    "CREDITFACTUUR\n\nNummer: CR0301267\nDatum: 16-07-2026\n\n" +
    "Totaal bedrag (EUR) : € -33,87\n";
  assert.equal(creditWordInHeader(kop), true);
});

test("[CREDIT-WOORD] 'creditnota' in de voorwaarden onderaan is GEEN creditnota", () => {
  // Dit is de reden dat alleen de kop telt. Deze zin staat op een groot deel van alle gewone
  // inkoopfacturen; er hier op afgaan zou het alarm waardeloos maken door het te vaak te laten
  // afgaan — en dat is erger dan de fout die het moest vangen.
  const factuur =
    "Hano Groothandel B.V.\nFACTUUR\nNummer: 2026-0912\nDatum: 03-08-2026\n" +
    "Vervaldatum: 17-08-2026\nKlantnummer: 88213\n" +
    "Levering week 31, diverse artikelen\n".repeat(12) +
    "\nBETALINGSVOORWAARDEN\nBetaling binnen 14 dagen. Bij retour van goederen " +
    "ontvangt u een creditnota op het hier vermelde rekeningnummer.\n";
  assert.ok(factuur.length > 600, "de zin moet echt buiten de kop vallen, anders meet dit niets");
  assert.equal(creditWordInHeader(factuur), false);
});

test("[CREDIT-WOORD] een ontkenning in de kop is geen aankondiging", () => {
  assert.equal(creditWordInHeader("FACTUUR\nDit is geen creditnota.\nNummer 2026-1"), false);
});

test("[CREDIT-WOORD] varianten en spelling", () => {
  assert.equal(creditWordInHeader("CREDITNOTA\n"), true);
  assert.equal(creditWordInHeader("Credit Nota nr. 5\n"), true);
  assert.equal(creditWordInHeader("CREDIT NOTE\n"), true);
  assert.equal(creditWordInHeader("creditnote 9\n"), true);
});

test("[CREDIT-WOORD] losse woorden die er alleen op lijken, tellen niet", () => {
  assert.equal(creditWordInHeader("FACTUUR\nCreditcard betaling ontvangen\n"), false);
  assert.equal(creditWordInHeader("FACTUUR\nKredietbeperking 2%\n"), false);
  assert.equal(creditWordInHeader("FACTUUR\nCreditering volgt separaat\n"), false);
});

test("[CREDIT-WOORD] geen tekstlaag is geen bewijs van het tegendeel", () => {
  assert.equal(creditWordInHeader(null), false);
  assert.equal(creditWordInHeader(""), false);
});
