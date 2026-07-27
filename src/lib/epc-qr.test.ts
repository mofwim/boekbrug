// [PAY-SAFE / M3] Regression tests for the EPC069-12 payment-QR builder.
//   run: npx tsx --test src/lib/epc-qr.test.ts
//
// WHY THIS FILE EXISTS — the whole payload is a NEWLINE-DELIMITED block, and the
// beneficiary IBAN is line 7. The vendor NAME on line 6 comes from OCR of a
// supplier's invoice, i.e. from someone outside the company. A name containing a
// newline shifts every following line up, so an attacker who gets
//
//     "Legit BV\nNL91ABNA0417164300"
//
// onto their invoice puts THEIR IBAN on the IBAN line of the QR the owner scans
// — while the on-screen IBAN still shows the real one. The owner's banking app
// pre-fills the attacker's account and the owner confirms it themselves.
//
// That is money leaving the company, caused by one missing `.replace()`. The
// guard is a single line in epc-qr.ts and nothing else protects it, so it is
// exactly the kind of thing a future tidy-up deletes without anyone noticing.
// These tests are what notice.
//
// Pure functions, no I/O — this file never builds a real QR image or contacts a
// bank; the payload string is the entire contract.

import { buildEpcQrPayload, isValidIban, normalizeIban } from "./epc-qr";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// A real, checksum-valid NL IBAN (the ECB's documentation example).
const GOOD_IBAN = "NL91ABNA0417164300";
// A second valid IBAN, standing in for the attacker's account.
const ATTACKER_IBAN = "NL02ABNA0123456789";

const lines = (payload: string) => payload.split("\n");
/** Line 7 of the EPC block (1-indexed in the spec) is the beneficiary IBAN. */
const ibanLine = (payload: string) => lines(payload)[6];
/** Line 6 is the beneficiary name. */
const nameLine = (payload: string) => lines(payload)[5];

console.log("\n[PAY-SAFE] the payload is well-formed");

check(
  "a clean input builds a 12-line EPC block",
  (() => {
    const r = buildEpcQrPayload({ iban: GOOD_IBAN, name: "Acme BV", amount: 121, reference: "F-2026-001" });
    return r.ok === true && lines(r.payload!).length === 12;
  })()
);

check(
  "the fixed header lines follow EPC069-12",
  (() => {
    const l = lines(buildEpcQrPayload({ iban: GOOD_IBAN, name: "Acme BV", amount: 10 }).payload!);
    return l[0] === "BCD" && l[1] === "002" && l[2] === "1" && l[3] === "SCT" && l[4] === "";
  })()
);

check(
  "the IBAN lands on line 7 and the amount on line 8",
  (() => {
    const l = lines(buildEpcQrPayload({ iban: GOOD_IBAN, name: "Acme BV", amount: 12.34 }).payload!);
    return l[6] === GOOD_IBAN && l[7] === "EUR12.34";
  })()
);

console.log("\n[PAY-SAFE / M3] THE MONEY-THEFT VECTOR: a newline in the vendor name");

check(
  "a \\n in the name cannot push an attacker IBAN onto the IBAN line",
  (() => {
    const r = buildEpcQrPayload({
      iban: GOOD_IBAN,
      name: `Legit BV\n${ATTACKER_IBAN}`,
      amount: 100,
    });
    // The ONLY assertion that matters: line 7 is still the real beneficiary.
    return r.ok === true && ibanLine(r.payload!) === GOOD_IBAN;
  })()
);

check(
  "a \\r\\n in the name is neutralised too (Windows-authored invoices)",
  (() => {
    const r = buildEpcQrPayload({
      iban: GOOD_IBAN,
      name: `Legit BV\r\n${ATTACKER_IBAN}`,
      amount: 100,
    });
    return r.ok === true && ibanLine(r.payload!) === GOOD_IBAN;
  })()
);

check(
  "a lone \\r in the name is neutralised",
  (() => {
    const r = buildEpcQrPayload({ iban: GOOD_IBAN, name: `Legit BV\r${ATTACKER_IBAN}`, amount: 100 });
    return r.ok === true && ibanLine(r.payload!) === GOOD_IBAN;
  })()
);

check(
  "the injected text survives as visible TEXT on the name line — not silently dropped",
  // Neutralised, not deleted: the owner should still SEE the strange vendor name
  // rather than have the app quietly hide evidence of a tampered invoice.
  (() => {
    const r = buildEpcQrPayload({ iban: GOOD_IBAN, name: `Legit BV\n${ATTACKER_IBAN}`, amount: 100 });
    return nameLine(r.payload!).includes("Legit BV") && nameLine(r.payload!).includes(ATTACKER_IBAN);
  })()
);

check(
  "many newlines still yield exactly 12 lines",
  (() => {
    const r = buildEpcQrPayload({ iban: GOOD_IBAN, name: "a\nb\nc\nd\ne\nf\ng", amount: 100 });
    return r.ok === true && lines(r.payload!).length === 12;
  })()
);

check(
  "a newline in the REFERENCE cannot shift lines either",
  (() => {
    const r = buildEpcQrPayload({
      iban: GOOD_IBAN,
      name: "Acme BV",
      amount: 100,
      reference: `F-001\n${ATTACKER_IBAN}`,
    });
    return r.ok === true && lines(r.payload!).length === 12 && ibanLine(r.payload!) === GOOD_IBAN;
  })()
);

console.log("\n[PAY-SAFE] no QR is better than a wrong QR");

check(
  "an invalid IBAN refuses to build",
  buildEpcQrPayload({ iban: "NL00BANK0000000000", name: "Acme BV", amount: 10 }).ok === false
);

check(
  "an empty IBAN refuses to build",
  buildEpcQrPayload({ iban: "", name: "Acme BV", amount: 10 }).ok === false
);

check(
  "a name that is ONLY newlines is treated as missing, not as an empty QR",
  (() => {
    const r = buildEpcQrPayload({ iban: GOOD_IBAN, name: "\n\n", amount: 10 });
    return r.ok === false && typeof r.error === "string";
  })()
);

check("a zero amount refuses to build", buildEpcQrPayload({ iban: GOOD_IBAN, name: "A", amount: 0 }).ok === false);
check("a negative amount refuses to build", buildEpcQrPayload({ iban: GOOD_IBAN, name: "A", amount: -5 }).ok === false);
check("NaN refuses to build", buildEpcQrPayload({ iban: GOOD_IBAN, name: "A", amount: NaN }).ok === false);
check("Infinity refuses to build", buildEpcQrPayload({ iban: GOOD_IBAN, name: "A", amount: Infinity }).ok === false);

console.log("\n[PAY-SAFE] field limits (a truncation must never move the IBAN line)");

check(
  "a 200-char name is capped at 70 and the block stays 12 lines",
  (() => {
    const r = buildEpcQrPayload({ iban: GOOD_IBAN, name: "x".repeat(200), amount: 10 });
    return r.ok === true && nameLine(r.payload!).length === 70 && lines(r.payload!).length === 12;
  })()
);

check(
  "a 300-char reference is capped at 140",
  (() => {
    const r = buildEpcQrPayload({ iban: GOOD_IBAN, name: "A", amount: 10, reference: "y".repeat(300) });
    return r.ok === true && lines(r.payload!)[10].length === 140;
  })()
);

console.log("\n[PAY-SAFE] IBAN validation (mod-97-10)");

check("a valid NL IBAN passes", isValidIban(GOOD_IBAN));
check("spaces and lowercase are tolerated", isValidIban("nl91 abna 0417 1643 00"));
check("a one-digit typo fails the checksum", !isValidIban("NL91ABNA0417164301"));
check("null fails", !isValidIban(null));
check("empty fails", !isValidIban(""));
check("too short fails", !isValidIban("NL91AB"));
check("normalizeIban strips spaces and uppercases", normalizeIban(" nl91 abna 0417164300 ") === GOOD_IBAN);

console.log(`\n[PAY-SAFE] ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
