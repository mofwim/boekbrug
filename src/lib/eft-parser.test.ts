// [EFT] Pure node test — run: npx tsx src/lib/eft-parser.test.ts
// The fixture is the REAL Equens CTAP terminal settlement receipt from KIWI FOOD
// MARKET (terminal 274865), transcribed verbatim — so the parser is proven against
// production hardware output, not a mock. This is corner 2 of the reconciliation
// triangle: the acquirer's GROSS card total per shift, the bridge between the till's
// PIN figure and the bank's NET deposit.
import { parseEftSettlement } from "./eft-parser";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const near = (a: number, b: number, t = 0.005) => Math.abs(a - b) <= t;

// Verbatim transcription of the printed thermal receipt (as OCR would yield it).
const RECEIPT = `KIWI FOOD

           TOTALEN RAPPORT
             EIND TOTALEN
DATUM:            12/07/2026 18:26:36

TMS TERM-ID:                274865
PERIODE NR:                     21
SHIFT NR:                        0
PERIODE START:    11/07/2026 18:48:19
PERIODE EINDE:    12/07/2026 18:26:36
DATUM EERSTE TRX: 12/07/2026 09:31:54
DATUM LAATSTE TRX:12/07/2026 18:24:12

        EFT TOTALEN
                     #TRX       EUR
BETALING:             130    1546,46
                    ------  --------
TOTAAL:                       1546,46

        Equens CTAP

V Pay                 #TRX       EUR
BETALING:              18     192,59
TOTAAL:                        192,59

Maestro               #TRX       EUR
BETALING:              53     638,03
TOTAAL:                        638,03

Debit Mastercard      #TRX       EUR
BETALING:              34     537,04
TOTAAL:                        537,04

Visa Debit            #TRX       EUR
BETALING:              22     155,32
TOTAAL:                        155,32

MasterCard            #TRX       EUR
BETALING:               3      23,48
TOTAAL:                         23,48

ACT.PERIODE GESLOTEN
TOTALEN OP NUL GEZET

        EINDE RAPPORT`;

console.log("\n— parseEftSettlement (real Equens CTAP receipt) —");
{
  const { settlement: s, warnings } = parseEftSettlement(RECEIPT);
  check("a settlement is returned", s !== null);
  check("terminal id 274865", s?.terminalId === "274865");
  check("periode nr 21", s?.periodNr === "21");
  check("shift nr 0", s?.shiftNr === "0");

  // GROSS card total for the shift — the number that must tie to the till PIN total.
  check("gross total 1546.46", near(s!.grossTotal, 1546.46));
  check("tx count 130", s?.txCount === 130);

  // Period crosses midnight (start 11/07 evening) but every trx is on 12/07 → the
  // settlement belongs to the 12/07 calendar day (the shift-vs-calendar-day rule).
  check("settlementDate = 2026-07-12 (from trx timestamps, not period start)", s?.settlementDate === "2026-07-12");
  check("periodStart parsed", s?.periodStart === "2026-07-11T18:48:19");
  check("periodEnd parsed", s?.periodEnd === "2026-07-12T18:26:36");
  check("first trx parsed", s?.firstTrx === "2026-07-12T09:31:54");
  check("last trx parsed", s?.lastTrx === "2026-07-12T18:24:12");

  // Per-scheme breakdown (Equens CTAP).
  check("5 card schemes", s?.byScheme.length === 5);
  const vpay = s?.byScheme.find((x) => /v ?pay/i.test(x.scheme));
  check("V Pay 18 / 192.59", !!vpay && vpay.count === 18 && near(vpay.amount, 192.59));
  const maestro = s?.byScheme.find((x) => /maestro/i.test(x.scheme));
  check("Maestro 53 / 638.03", !!maestro && maestro.count === 53 && near(maestro.amount, 638.03));
  const dmc = s?.byScheme.find((x) => /debit mastercard/i.test(x.scheme));
  check("Debit Mastercard 34 / 537.04", !!dmc && dmc.count === 34 && near(dmc.amount, 537.04));
  const visa = s?.byScheme.find((x) => /visa debit/i.test(x.scheme));
  check("Visa Debit 22 / 155.32", !!visa && visa.count === 22 && near(visa.amount, 155.32));
  const mc = s?.byScheme.find((x) => /^mastercard/i.test(x.scheme));
  check("MasterCard 3 / 23.48", !!mc && mc.count === 3 && near(mc.amount, 23.48));

  // Internal identity the parser guarantees: schemes reconcile to the grand total.
  const schemeSum = (s?.byScheme ?? []).reduce((a, x) => a + x.amount, 0);
  check("Σ scheme amounts = gross total", near(schemeSum, 1546.46, 0.02));
  const countSum = (s?.byScheme ?? []).reduce((a, x) => a + x.count, 0);
  check("Σ scheme counts = tx count", countSum === 130);

  // A clean, self-consistent receipt imports with no warnings.
  check("no warnings on a self-consistent receipt", warnings.length === 0);
}

console.log("\n— cross-check surfaces an inconsistent receipt (never silent) —");
{
  // Grand total says 1000 but the one scheme only sums to 900 → warning, not silent.
  const BAD = `TMS TERM-ID: 100
EFT TOTALEN
BETALING: 10 1000,00
Equens CTAP
Maestro
BETALING: 9 900,00
TOTAAL: 900,00`;
  const { settlement, warnings } = parseEftSettlement(BAD);
  check("still returns a settlement", settlement !== null);
  check("scheme-total-mismatch warning raised", warnings.some((w) => w.code === "scheme_total_mismatch"));
}

console.log("\n— robustness —");
{
  check("empty text → no settlement + warning",
    (() => { const r = parseEftSettlement(""); return r.settlement === null && r.warnings.some((w) => w.code === "no_eft_total"); })());
  check("settlementDate falls back to period end when no trx timestamps",
    (() => {
      const r = parseEftSettlement("TMS TERM-ID: 5\nPERIODE EINDE: 30/06/2026 23:59:00\nEFT TOTALEN\nBETALING: 4 40,00");
      return r.settlement?.settlementDate === "2026-06-30";
    })());
  check("grouped-integer amount '1.234' parses to 1234, not 1.23",
    (() => {
      const r = parseEftSettlement("EFT TOTALEN\nBETALING: 40 1.234");
      return r.settlement !== null && Math.abs(r.settlement.grossTotal - 1234) < 0.005;
    })());
  check("DD-MM-YYYY (dash) timestamps parse too",
    (() => {
      const r = parseEftSettlement("EFT TOTALEN\nBETALING: 1 5,00\nDATUM LAATSTE TRX: 01-05-2026 10:00:00");
      return r.settlement?.settlementDate === "2026-05-01";
    })());
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
