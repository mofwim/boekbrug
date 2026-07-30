// [DEDUP-SOFT] Pure node test — run: npx tsx src/lib/possible-duplicate.test.ts
// Guards assessPossibleDuplicate: a SOFT "mogelijk dubbel" flag that never blocks, but must
// catch a re-import the hard key misses (same amount + date, or same amount + vendor a few days
// apart) WITHOUT flagging a genuinely different supplier or a monthly recurring bill.
import { assessPossibleDuplicate, POSSIBLE_DUP_WINDOW_DAYS, type PossibleDupCandidate, type SemanticDedupInput } from "./safecore";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const input = (o: Partial<SemanticDedupInput> = {}): SemanticDedupInput => ({
  invoiceNumber: "F-2001", vendor: "Atapack B.V.", totalIncBtw: 121, invoiceDate: "2026-03-10", ...o,
});
const cand = (o: Partial<PossibleDupCandidate> = {}): PossibleDupCandidate => ({
  id: "inv-1", invoice_number: "F-9999", client_name: "Atapack", invoice_date: "2026-03-10", total_inc_btw: 121, ...o,
});

console.log("\n— same amount + date, different number → possible —");
{
  const r = assessPossibleDuplicate(input(), [cand()]);
  check("flagged", !!r && r.match.id === "inv-1");
  check("reason mentions bedrag, datum en afzender", r?.reason === "zelfde bedrag, datum en afzender");
}

console.log("\n— same amount + date, vendor unknown on one side → possible (no vendor veto) —");
{
  const r = assessPossibleDuplicate(input({ vendor: "onbekend" }), [cand({ client_name: "Atapack" })]);
  check("still flagged on amount+date", !!r && r.reason === "zelfde bedrag en datum");
}

console.log("\n— provably different reliable vendors, same amount+date → NOT a dup (coincidence) —");
{
  const r = assessPossibleDuplicate(input({ vendor: "Atapack B.V." }), [cand({ client_name: "Jansen Groothandel" })]);
  check("different supplier not flagged", r === null);
}

console.log("\n— exact number + SAME date + EXACT total is a HARD dup (blocked upstream) → skipped here —");
{
  const r = assessPossibleDuplicate(input({ invoiceNumber: "F-2001", invoiceDate: "2026-03-10", totalIncBtw: 121 }), [cand({ invoice_number: "F-2001", invoice_date: "2026-03-10", total_inc_btw: 121 })]);
  check("same number + same date + EXACT total skipped", r === null);
}

console.log("\n— [DBLCHK] same number + same date but SUB-CENT total drift → flagged (hard exact-eq misses it) —");
{
  // Hard gate matches total with exact float .eq; soft uses cent-round. 121.004 is cent-equal to
  // 121.00 but NOT exactly equal, so the hard gate misses it — the soft detector must flag, not skip.
  const r = assessPossibleDuplicate(input({ invoiceNumber: "F-2001", invoiceDate: "2026-03-10", totalIncBtw: 121 }), [cand({ invoice_number: "F-2001", invoice_date: "2026-03-10", total_inc_btw: 121.004 })]);
  check("sub-cent drift same-number+same-date flagged", !!r && /zelfde factuurnummer/.test(r.reason));
}

console.log("\n— [CRITICAL] same number + total but DRIFTED date → flagged (hard key missed it) —");
{
  // OCR reads a different date the second time; the hard number-tier key filters on date and misses
  // it. This must NOT slip through silently → strongest possible-dup flag.
  const r = assessPossibleDuplicate(input({ invoiceNumber: "26/3958", invoiceDate: "2026-03-10" }), [cand({ invoice_number: "26/3958", invoice_date: "2026-03-08" })]);
  check("drifted-date same-number flagged", !!r && /zelfde factuurnummer/.test(r.reason));
  // Stored original has a NULL date → also flagged.
  const r2 = assessPossibleDuplicate(input({ invoiceNumber: "26/3958", invoiceDate: "2026-03-10" }), [cand({ invoice_number: "26/3958", invoice_date: null })]);
  check("null-date same-number flagged", !!r2 && /zelfde factuurnummer/.test(r2.reason));
  // But a same number across PROVABLY DIFFERENT vendors is not a dup (per-vendor numbering).
  const r3 = assessPossibleDuplicate(input({ invoiceNumber: "INV-001", vendor: "Atapack B.V.", invoiceDate: "2026-03-10" }), [cand({ invoice_number: "INV-001", client_name: "Jansen Groothandel", invoice_date: "2026-03-08" })]);
  check("same number, different supplier → not flagged", r3 === null);
}

console.log("\n— [ACCENT] an accent variant of the same vendor still matches —");
{
  const r = assessPossibleDuplicate(input({ vendor: "Café de Kroon", invoiceDate: "2026-03-10", invoiceNumber: "A-1" }), [cand({ client_name: "Cafe de Kroon", invoice_date: "2026-03-10", invoice_number: "A-2" })]);
  check("Café ≡ Cafe → same amount+date flagged", !!r && r.reason === "zelfde bedrag, datum en afzender");
}

console.log("\n— same vendor + amount, a few days apart → possible (near-date re-import) —");
{
  const r = assessPossibleDuplicate(input({ invoiceDate: "2026-03-10" }), [cand({ invoice_date: "2026-03-14" })]);
  check("near-date same vendor flagged", !!r && r.reason === "zelfde bedrag en afzender, datum dichtbij");
}

console.log("\n— same vendor + amount, a MONTH apart → NOT flagged (recurring bill) —");
{
  const r = assessPossibleDuplicate(input({ invoiceDate: "2026-03-10" }), [cand({ invoice_date: "2026-04-10", invoice_number: "F-8888" })]);
  check(`> ${POSSIBLE_DUP_WINDOW_DAYS} days apart not flagged`, r === null);
}

console.log("\n— same vendor + amount, NO dates at all → NOT flagged (recurring risk) —");
{
  const r = assessPossibleDuplicate(input({ invoiceDate: null }), [cand({ invoice_date: null, invoice_number: "F-7777" })]);
  check("no-date same-vendor not flagged", r === null);
}

console.log("\n— different amount → never flagged —");
{
  const r = assessPossibleDuplicate(input({ totalIncBtw: 121 }), [cand({ total_inc_btw: 130 })]);
  check("different total not flagged", r === null);
}

console.log("\n— no usable total on input → null —");
{
  check("missing total → null", assessPossibleDuplicate(input({ totalIncBtw: null }), [cand()]) === null);
}

console.log("\n— picks the STRONGEST signal among candidates —");
{
  const r = assessPossibleDuplicate(input({ vendor: "Atapack B.V.", invoiceDate: "2026-03-10" }), [
    cand({ id: "near", client_name: "Atapack", invoice_date: "2026-03-13", invoice_number: "F-1" }),   // rank 2
    cand({ id: "exact", client_name: "Atapack", invoice_date: "2026-03-10", invoice_number: "F-2" }),  // rank 4
  ]);
  check("best (same date + vendor) wins", !!r && r.match.id === "exact");
}

console.log("\n— cent-precision total match (float-safe) —");
{
  const r = assessPossibleDuplicate(input({ totalIncBtw: 121.10 }), [cand({ total_inc_btw: 121.10 })]);
  check("121.10 matches 121.10", !!r);
  const r2 = assessPossibleDuplicate(input({ totalIncBtw: 121.10 }), [cand({ total_inc_btw: 121.11 })]);
  check("121.10 != 121.11", r2 === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// [ABONNEMENT] Een leverancier die ELKE WEEK hetzelfde bedrag factureert.
//
// Het venster is 14 dagen, dus een tussenpoos van 7 dagen viel er precies binnen: zo'n abonnement
// werd ELKE WEEK opnieuw als "mogelijk dubbel" gevlagd, met een ander factuurnummer erop. Dat is
// geen dubbele boeking, dat is de volgende termijn.
//
// Onderdrukken is de GEVAARLIJKE richting, dus de helft van deze tests gaat over wanneer het NIET
// mag: dat is wat het verschil bewaakt tussen "abonnement" en "iemand stuurde het per ongeluk twee
// keer".
// ─────────────────────────────────────────────────────────────────────────────

/** Wekelijkse reeks van dezelfde leverancier, zelfde bedrag, elk met een EIGEN nummer. */
const weekly = (n: number): PossibleDupCandidate[] =>
  Array.from({ length: n }, (_, i) => cand({
    id: `w${i}`,
    invoice_number: `W-${100 + i}`,
    client_name: "Atapack B.V.",
    // 2026-03-02, -03-09, -03-16, ... telkens 7 dagen
    invoice_date: `2026-03-${String(2 + i * 7).padStart(2, "0")}`,
  }));

console.log("\n— [ABONNEMENT] wekelijkse reeks → GEEN vlag meer —");
{
  // Vier eerdere weken; de nieuwe komt exact een week na de laatste (2026-03-23 + 7 = 03-30).
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "W-104", invoiceDate: "2026-03-30" }),
    weekly(4),
  );
  check("wekelijks abonnement wordt niet meer gevlagd", r === null);
}

console.log("\n— [ABONNEMENT] maar zonder aantoonbaar ritme blijft de vlag staan —");
{
  // Slechts TWEE eerdere facturen: te weinig voor een reeks. Dit kan net zo goed een per ongeluk
  // dubbel verstuurde factuur zijn, en dan moet de eigenaar er juist naar kijken.
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "W-102", invoiceDate: "2026-03-16" }),
    weekly(2),
  );
  check("twee eerdere facturen → nog steeds gevlagd", r?.reason === "zelfde bedrag en afzender, datum dichtbij");
}
{
  // Onregelmatige datums: 2 dagen, dan 9, dan 1. Geen ritme → geen onderdrukking.
  const rommel: PossibleDupCandidate[] = [
    cand({ id: "a", invoice_number: "A-1", invoice_date: "2026-03-01" }),
    cand({ id: "b", invoice_number: "A-2", invoice_date: "2026-03-03" }),
    cand({ id: "c", invoice_number: "A-3", invoice_date: "2026-03-12" }),
  ];
  const r = assessPossibleDuplicate(input({ invoiceNumber: "A-4", invoiceDate: "2026-03-13" }), rommel);
  check("onregelmatige reeks → nog steeds gevlagd", !!r);
}

console.log("\n— [ABONNEMENT] de hekken die een echte dubbele boeking beschermen —");
{
  // Zelfde NUMMER als een van de reeks → dit is hetzelfde stuk, nooit onderdrukken.
  const r = assessPossibleDuplicate(input({ invoiceNumber: "W-101", invoiceDate: "2026-03-30" }), weekly(4));
  check("nieuw stuk deelt een nummer met de reeks → gevlagd", !!r);
}
{
  // Geen eigen factuurnummer → we kunnen niet zeggen dat het een ander stuk is.
  const r = assessPossibleDuplicate(input({ invoiceNumber: null, invoiceDate: "2026-03-30" }), weekly(4));
  check("nieuw stuk zonder nummer → gevlagd", !!r);
}
{
  // Een reeks waarin een NUMMER dubbel voorkomt is juist bewijs van iets dubbels, geen ritme.
  const metDubbelNummer = [...weekly(3), cand({ id: "dup", invoice_number: "W-100", invoice_date: "2026-03-23" })];
  const r = assessPossibleDuplicate(input({ invoiceNumber: "W-200", invoiceDate: "2026-03-30" }), metDubbelNummer);
  check("herhaald nummer in de reeks → gevlagd", !!r);
}
{
  // Een uitbarsting (elke dag hetzelfde bedrag) is geen factureerritme.
  const burst = Array.from({ length: 4 }, (_, i) => cand({
    id: `b${i}`, invoice_number: `B-${i}`, invoice_date: `2026-03-0${1 + i}`,
  }));
  const r = assessPossibleDuplicate(input({ invoiceNumber: "B-9", invoiceDate: "2026-03-05" }), burst);
  check("dagelijkse burst → gevlagd, geen abonnement", !!r);
}
{
  // ZELFDE DATUM blijft altijd een signaal: een weekabonnement factureert niet twee keer op
  // dezelfde dag. Rang 4 mag nooit onderdrukt worden.
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "W-104", invoiceDate: "2026-03-23" }),
    weekly(4),
  );
  check("zelfde datum als een reekslid → gevlagd (rang 4 blijft)", r?.reason === "zelfde bedrag, datum en afzender");
}
{
  // Een reeks van een ANDERE leverancier mag nooit als bewijs dienen.
  const anderLeverancier = weekly(4).map((c) => ({ ...c, client_name: "Jansen Bouw" }));
  // Jansen is aantoonbaar een andere leverancier dan Atapack, dus die kandidaten worden hoe dan ook
  // afgewezen (de vendor-veto) — er valt niets te vlaggen en niets te onderdrukken.
  const r = assessPossibleDuplicate(input({ invoiceNumber: "W-104", invoiceDate: "2026-03-30" }), anderLeverancier);
  check("kandidaten van een andere leverancier leveren geen match", r === null);
  // Het echte hek: de reeks van Jansen mag Atapack niet vrijpleiten. Een Atapack-kandidaat dichtbij
  // moet dan nog steeds gevlagd worden.
  const gemengd = [...anderLeverancier, cand({ id: "at", invoice_number: "AT-1", client_name: "Atapack B.V.", invoice_date: "2026-03-28" })];
  const r2 = assessPossibleDuplicate(input({ invoiceNumber: "W-104", invoiceDate: "2026-03-30" }), gemengd);
  check("vreemde reeks pleit deze leverancier niet vrij", !!r2);
}

// ─────────────────────────────────────────────────────────────────────────────
// [DEDUP-CORRECTED] Same invoice NUMBER, DIFFERENT amount — the corrected re-issue.
// The scenario: a supplier invoices the wrong total, then re-sends the SAME invoice number
// with the corrected one. Every other gate in safecore is anchored on the amount (the hard
// key matches number + total; every soft tier above starts by requiring cent-equal totals),
// so both copies imported as two separate costs with two claims of voorbelasting.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n— [DEDUP-CORRECTED] same number, corrected amount → flagged —");
{
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "26302050", totalIncBtw: 5900.0 }),
    [cand({ id: "wrong", invoice_number: "26302050", total_inc_btw: 6662.8 })],
  );
  check("corrected re-issue flagged", !!r && r.match.id === "wrong");
  check("reason names the amount difference", r?.reason === "zelfde factuurnummer, ander bedrag — mogelijk een gecorrigeerde versie");
}
{
  // Direction of the correction is irrelevant — up or down, it is the same document twice.
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "26302050", totalIncBtw: 6662.8 }),
    [cand({ id: "first", invoice_number: "26302050", total_inc_btw: 5900.0 })],
  );
  check("also flagged when the correction is upward", !!r);
}
{
  // Number normalization applies here too: a re-rendered PDF printing "26 302050" is the same bill.
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "26 302050", totalIncBtw: 5900.0 }),
    [cand({ invoice_number: "26302050", total_inc_btw: 6662.8 })],
  );
  check("spacing variant of the number still matches", !!r);
}
{
  // A DATE that also moved must not weaken the signal — a corrected invoice is usually re-dated.
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "26302050", totalIncBtw: 5900.0, invoiceDate: "2026-05-11" }),
    [cand({ invoice_number: "26302050", total_inc_btw: 6662.8, invoice_date: "2026-05-07" })],
  );
  check("re-dated correction still flagged", !!r);
}

console.log("\n— [DEDUP-CORRECTED] the hekken: what must NOT be flagged —");
{
  // Numbers are unique per SUPPLIER, not across them. Two suppliers both numbering from 1 is
  // ordinary; flagging that would put a legitimate bill in the queue every time.
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "2026-001", vendor: "Atapack B.V.", totalIncBtw: 5900 }),
    [cand({ invoice_number: "2026-001", client_name: "Jansen Groothandel", total_inc_btw: 6662.8 })],
  );
  check("same number from a provably different supplier → not flagged", r === null);
}
{
  // A placeholder number is minted per import (UPLOAD-17) and can never legitimately repeat, so
  // it must never anchor this tier — otherwise every uploaded invoice would look like a
  // correction of the previous one.
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "UPLOAD-17", totalIncBtw: 5900 }),
    [cand({ invoice_number: "UPLOAD-17", total_inc_btw: 6662.8 })],
  );
  check("placeholder number never anchors a correction", r === null);
}
{
  // Different number AND different amount is simply the next bill from this supplier.
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "26302051", totalIncBtw: 5900 }),
    [cand({ invoice_number: "26302050", total_inc_btw: 6662.8 })],
  );
  check("a genuinely different invoice → not flagged", r === null);
}
{
  // The weakest tier must never outrank a real same-amount signal: when both are present the
  // stronger reason is the one the owner reads.
  const r = assessPossibleDuplicate(
    input({ invoiceNumber: "26302050", totalIncBtw: 121, invoiceDate: "2026-03-10" }),
    [
      cand({ id: "corrected", invoice_number: "26302050", total_inc_btw: 6662.8 }),
      cand({ id: "sameday", invoice_number: "F-9999", total_inc_btw: 121, invoice_date: "2026-03-10" }),
    ],
  );
  check("a same-amount signal outranks the correction tier", r?.match.id === "sameday");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
