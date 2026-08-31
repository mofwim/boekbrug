// [REIMPORT-CARRY] Pure node test — run: npx tsx --test src/lib/reimport-carry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReimportFieldConfidence, type ReimportCarryInput } from "./reimport-carry";

const HELD = "2026-07-29T10:00:00.000Z";

const input = (over: Partial<ReimportCarryInput> = {}): ReimportCarryInput => ({
  priorFc: null,
  aiConfidence: null,
  freshHasTotal: true,
  verdict: { ok: true },
  heldAt: HELD,
  freshIsReminder: false,
  freshReminderOf: null,
  ...over,
});

const safecoreOf = (fc: Record<string, unknown> | null) =>
  (fc?._safecore ?? null) as Record<string, unknown> | null;

// ── DE BUG ────────────────────────────────────────────────────────────────────────────────────

test("een dubbel-signaal overleeft het opnieuw inlezen", () => {
  // DIT IS DE BUG: de route verving _safecore in zijn geheel door het verse rekenoordeel.
  // Een factuur met "mogelijk dubbel met F-2026-014" werd door één druk op de knop schoon,
  // classifyImportHealth zag geen vlag meer, en dezelfde kostenpost kon een tweede keer worden
  // geboekt. De knop die vertrouwen moest herstellen, wiste juist de waarschuwing.
  const fc = buildReimportFieldConfidence(input({
    priorFc: {
      _safecore: {
        arithmetic_ok: false,
        reason: "bedragen tellen niet op",
        possible_duplicate: true,
        possible_duplicate_of: "F-2026-014",
        possible_duplicate_reason: "zelfde bedrag en leverancier, 2 dagen ertussen",
      },
    },
    freshHasTotal: true,
    verdict: { ok: true }, // de verse lezing rekent nu wél op
  }));

  const sc = safecoreOf(fc);
  assert.equal(sc?.possible_duplicate, true, "de dubbel-vlag moet blijven staan");
  assert.equal(sc?.possible_duplicate_of, "F-2026-014");
  assert.equal(sc?.possible_duplicate_reason, "zelfde bedrag en leverancier, 2 dagen ertussen");

  // …en het rekenoordeel is wél vernieuwd: de oude hold hoort weg te zijn.
  assert.equal(sc?.arithmetic_ok, undefined, "een schone verse lezing laat geen oud hold staan");
  assert.equal(sc?.reason, undefined);
});

test("een dedup-notitie overleeft eveneens — de route zoekt de tweeling niet opnieuw op", () => {
  const fc = buildReimportFieldConfidence(input({
    priorFc: { _safecore: { dedup: "vendor", dedup_reason: "zelfde leverancier en bedrag" } },
  }));
  const sc = safecoreOf(fc);
  assert.equal(sc?.dedup, "vendor");
  assert.equal(sc?.dedup_reason, "zelfde leverancier en bedrag");
});

// ── HET REKENOORDEEL ──────────────────────────────────────────────────────────────────────────

test("verse bedragen die niet kloppen zetten een vers hold", () => {
  const fc = buildReimportFieldConfidence(input({
    verdict: { ok: false, reason: "excl + btw is niet incl", flags: ["sum"] },
  }));
  const sc = safecoreOf(fc);
  assert.equal(sc?.arithmetic_ok, false);
  assert.equal(sc?.reason, "excl + btw is niet incl");
  assert.deepEqual(sc?.flags, ["sum"]);
  assert.equal(sc?.held_at, HELD, "de tijdstempel komt van buiten — deze module blijft puur");
});

test("zonder verse bedragen blijft het OUDE oordeel gelden", () => {
  // De opgeslagen bedragen zijn niet aangeraakt, dus het oordeel erover is nog steeds het juiste.
  const fc = buildReimportFieldConfidence(input({
    priorFc: { _safecore: { arithmetic_ok: false, reason: "oud probleem", held_at: "2026-01-01T00:00:00.000Z" } },
    freshHasTotal: false,
    verdict: null,
  }));
  const sc = safecoreOf(fc);
  assert.equal(sc?.arithmetic_ok, false);
  assert.equal(sc?.reason, "oud probleem");
  assert.equal(sc?.held_at, "2026-01-01T00:00:00.000Z", "geen vers hold verzinnen voor oude bedragen");
});

// ── DE HERINNERING: juist NIET meedragen ──────────────────────────────────────────────────────

test("de herinneringsvlag komt van de verse lezing, niet uit het verleden", () => {
  // Blind meedragen zou de vlag onherstelbaar maken door het enige middel dat ervoor bestaat.
  const weg = buildReimportFieldConfidence(input({
    priorFc: { _safecore: { reminder: true, reminder_of: "F-2026-001" } },
    freshIsReminder: false,
  }));
  assert.equal(safecoreOf(weg)?.reminder, undefined, "een onterechte herinneringsvlag moet te wissen zijn");
  assert.equal(safecoreOf(weg)?.reminder_of, undefined);

  const blijft = buildReimportFieldConfidence(input({
    priorFc: { _safecore: { possible_duplicate: true } },
    freshIsReminder: true,
    freshReminderOf: "F-2026-009",
  }));
  assert.equal(safecoreOf(blijft)?.reminder, true);
  assert.equal(safecoreOf(blijft)?.reminder_of, "F-2026-009");
  assert.equal(safecoreOf(blijft)?.possible_duplicate, true, "en de dubbel-vlag blijft er los naast staan");
});

// ── DE OVERIGE SLEUTELS ───────────────────────────────────────────────────────────────────────

test("de camera-hints overleven altijd — dat is het audit-spoor van de betaalwijze", () => {
  const fc = buildReimportFieldConfidence(input({
    priorFc: {
      _intake_kind: "receipt",
      _intake_paid_method: "kas",
      _intake_paid_evidence: "KONTANT 120,00 Afronding 0,02",
      _intake_paid_card4: "6596",
    },
  }));
  assert.equal(fc?._intake_kind, "receipt");
  assert.equal(fc?._intake_paid_method, "kas");
  assert.equal(fc?._intake_paid_evidence, "KONTANT 120,00 Afronding 0,02");
  assert.equal(fc?._intake_paid_card4, "6596");
});

test("_btw_derived hoort bij de bedragen die het verklaart", () => {
  const behouden = buildReimportFieldConfidence(input({
    priorFc: { _btw_derived: { read: null, used: 405.9 } },
    freshHasTotal: false,
    verdict: null,
  }));
  assert.ok(behouden?._btw_derived, "oude bedragen blijven staan, dus hun verklaring ook");

  const weg = buildReimportFieldConfidence(input({
    priorFc: { _btw_derived: { read: null, used: 405.9 } },
    freshHasTotal: true,
  }));
  assert.equal(weg?._btw_derived, undefined, "verse bedragen → de oude verklaring gaat mee weg");
});

test("[BTW-SPLIT] elke verklaring van de OPGESLAGEN bedragen volgt dezelfde regel", () => {
  // De gevaarlijke richting: "Opnieuw inlezen" levert niets op, de bedragen blijven dus staan —
  // en de lege verse lezing zou de verklaring eronder wegvegen. Dan wordt een factuur die werd
  // vastgehouden ineens schoon zonder dat er iets aan veranderd is.
  const rows = [{ rate: 9, base: 1101.38, btw: 99.06 }, { rate: 21, base: 112.12, btw: 23.58 }];
  const prior = { _btw_rows: rows, _total_printed: 1336.14, _total_derived: "total" };

  const behouden = buildReimportFieldConfidence(input({ priorFc: prior, freshHasTotal: false, verdict: null }));
  assert.deepEqual(behouden?._btw_rows, rows, "de btw-specificatie hoort bij de bedragen die blijven staan");
  assert.equal(behouden?._total_printed, 1336.14);
  assert.equal(behouden?._total_derived, "total");

  const weg = buildReimportFieldConfidence(input({ priorFc: prior, freshHasTotal: true }));
  assert.equal(weg?._btw_rows, undefined, "verse bedragen → verse specificatie, of geen");
  assert.equal(weg?._total_printed, undefined);
  assert.equal(weg?._total_derived, undefined);
});

test("[STATIEGELD-GAT] de statiegeld-vondst hoort bij het GAT dat blijft staan", () => {
  // Dezelfde regel, en dit is precies het geval waarvoor de lijst is geschreven. De vondst zegt:
  // "het verschil van € 176,40 staat op de factuur als Statiegeld". Levert "Opnieuw inlezen" niets
  // op, dan blijven de bedragen staan — dus staat het gat er nog — maar de verklaring en de
  // één-tik-oplossing verdwenen, en de controlelijst viel terug op "excl. + btw komt niet uit op
  // het totaal". De knop maakte de factuur dan minder begrijpelijk dan ervoor.
  const vondst = { gap: 176.4, label: "Statiegeld", correctedExcl: 1011.7 };

  const behouden = buildReimportFieldConfidence(input({
    priorFc: { _statiegeld: vondst },
    freshHasTotal: false,
    verdict: null,
  }));
  assert.deepEqual(behouden?._statiegeld, vondst, "het gat blijft staan, dus zijn verklaring ook");

  // …en bij verse bedragen gaat hij mee weg: die zijn opnieuw gelezen, dus opnieuw beoordeeld.
  const weg = buildReimportFieldConfidence(input({
    priorFc: { _statiegeld: vondst },
    freshHasTotal: true,
  }));
  assert.equal(weg?._statiegeld, undefined, "verse bedragen → verse vondst, of geen");
});

test("de verse AI-zekerheden komen er gewoon bij", () => {
  const fc = buildReimportFieldConfidence(input({
    aiConfidence: { vendor: 0.97, invoice_number: 0.4 },
    priorFc: { _safecore: { possible_duplicate: true } },
  }));
  assert.equal(fc?.vendor, 0.97);
  assert.equal(fc?.invoice_number, 0.4);
  assert.equal(safecoreOf(fc)?.possible_duplicate, true);
});

test("niets te bewaren → null, geen leeg object", () => {
  assert.equal(buildReimportFieldConfidence(input()), null);
  assert.equal(buildReimportFieldConfidence(input({ priorFc: {}, aiConfidence: {} })), null);
});

test("een kapotte _safecore laat de rest niet omvallen", () => {
  for (const kapot of [null, "tekst", 42, [], undefined]) {
    const fc = buildReimportFieldConfidence(input({
      priorFc: { _safecore: kapot, _intake_kind: "receipt" },
      freshHasTotal: false,
      verdict: null,
    }));
    assert.equal(fc?._intake_kind, "receipt", `_safecore = ${JSON.stringify(kapot)} mag de rest niet slopen`);
  }
});

// ── [INCASSO-ONGEDAAN] The marker that records what the APP did ──────────────
//
// incassoDecision holds an invoice that stands OPEN and carries _auto_incasso: the marker is only
// ever written after a successful booking, so that combination means we booked it and somebody put
// it back — a storno, exactly what the cron's own notification tells the owner to do. The
// idempotency key itself lives in the bank_tx_invoices row that the undo deletes, so this marker is
// what is left.
//
// "Opnieuw inlezen" rebuilds field_confidence from an allow-list. The marker matched no entry on
// it, so one tap returned the invoice to being an ordinary open invoice of a marked supplier — and
// the next hourly pass re-booked the whole balance on a collection that was reversed.
//
// These pin the carry-over from both sides, because the allow-list has already lost a key once
// (_statiegeld) and its own header warns that it will happen again.

test("[INCASSO-ONGEDAAN] a re-import keeps the record that we booked this invoice ourselves", () => {
  const mark = { at: "2026-05-16T02:00:00.000Z", paid_on: "2026-05-15", supplier: "Eneco" };
  const out = buildReimportFieldConfidence({
    priorFc: { _auto_incasso: mark },
    aiConfidence: null,
    freshHasTotal: false,
    verdict: null,
    heldAt: "2026-05-16T02:00:00.000Z",
    freshIsReminder: false,
    freshReminderOf: null,
  });
  assert.deepEqual(out?._auto_incasso, mark, "the auto-incasso marker did not survive a re-import");
});

test("[INCASSO-ONGEDAAN] …including when the fresh read DID produce amounts", () => {
  // The important half. AMOUNT_EXPLAINING_KEYS are deliberately dropped once fresh amounts arrive,
  // because they explain the old ones. This marker is the opposite kind of fact: it says what we
  // did with money, and re-reading the pdf can neither re-derive it nor refute it. A re-read that
  // succeeds is the MORE likely case, so guarding it behind !freshHasTotal would leave the hole
  // open for almost every real re-import.
  const mark = { at: "2026-05-16T02:00:00.000Z", paid_on: "2026-05-15", supplier: "Eneco" };
  const out = buildReimportFieldConfidence({
    priorFc: { _auto_incasso: mark, _btw_derived: true },
    aiConfidence: null,
    freshHasTotal: true,
    verdict: null,
    heldAt: "2026-05-16T02:00:00.000Z",
    freshIsReminder: false,
    freshReminderOf: null,
  });
  assert.deepEqual(out?._auto_incasso, mark, "the marker was dropped once the re-read found a total");
  assert.equal(out?._btw_derived, undefined, "an amount explanation wrongly survived fresh amounts");
});

test("[INCASSO-ONGEDAAN] an invoice we never booked gains no marker from a re-import", () => {
  const out = buildReimportFieldConfidence({
    priorFc: { _intake_kind: "camera" },
    aiConfidence: null,
    freshHasTotal: true,
    verdict: null,
    heldAt: "2026-05-16T02:00:00.000Z",
    freshIsReminder: false,
    freshReminderOf: null,
  });
  assert.equal(out?._auto_incasso, undefined, "a marker was invented for an invoice nobody booked");
});
