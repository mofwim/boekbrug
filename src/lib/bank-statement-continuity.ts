// src/lib/bank-statement-continuity.ts
// [STATEMENT-CONTINUITY] Ontbreekt er een stuk bankgeschiedenis?
//
// WAAROM DIT BESTAAT
// bank-statement-balance.ts controleert één afschrift IN ZICHZELF: beginsaldo + mutaties =
// eindsaldo. Dat vangt een half ingelezen bestand. Wat het NIET vangt is het bestand dat er
// helemaal niet is: wie januari en maart uploadt en februari vergeet, heeft twee afschriften
// die allebei perfect kloppen — en een maand aan betalingen die nergens bestaat. De readiness
// zag dat ook niet: die keek alleen of het kwartaal ÉÉN transactie had.
//
// Dat gat is precies de belofte van dit product: niet "de boekhouding klopt", maar "er is niets
// zoekgeraakt". Een ontbrekende maand betekent onbetaalde facturen die betaald lijken, omzet die
// niet is aangesloten, en een BTW-aangifte over een periode die niet compleet is.
//
// TWEE ONAFHANKELIJKE SIGNALEN — met opzet, want ze vangen verschillende fouten:
//   1. DATUMGAT   — afschrift A eindigt 31-01, het volgende begint 01-03 ⇒ februari ontbreekt.
//   2. SALDOBREUK — A eindigt op € 4.512,80 en B begint op € 4.980,15 ⇒ er zit iets tussen,
//                   ook als de datums naadloos aansluiten (een deel-export, een ander rekening-
//                   nummer, een handmatig geknipt bestand).
// Een saldobreuk is het sterkere signaal: die liegt niet, ook niet als de datums kloppen.
//
// DISCIPLINE
//   · Per rekening (IBAN). Twee rekeningen door elkaar zijn geen gat.
//   · Alleen uitspraken doen waar de data ze draagt: zonder saldi geen saldocontrole, en dat
//     zeggen we dan ook (`balancesKnown: false`) in plaats van "in orde" te suggereren.
//   · Overlap is geen gat maar wél een signaal: dezelfde periode twee keer geïmporteerd kan
//     dubbele transacties betekenen.
// Puur, geen I/O — getest in bank-statement-continuity.test.ts.

import { round2 } from './invoice-totals'

/** Eén ingelezen afschrift, zoals het bij de import is vastgelegd. */
export interface StatementPeriod {
  /** documents.id van het opgeslagen afschrift — zodat de UI het bestand kan aanwijzen. */
  documentId: string;
  /** Rekening waar dit afschrift over gaat. Null = onbekend (oudere import). */
  iban: string | null;
  /** Eerste en laatste dag die het afschrift beslaat, ISO (YYYY-MM-DD). */
  from: string;
  to: string;
  /** Begin-/eindsaldo zoals het afschrift ze zelf noemt. Null bij een formaat zonder saldi. */
  opening: number | null;
  closing: number | null;
  /** Bestandsnaam, puur om de eigenaar het bestand te laten herkennen. */
  fileName?: string | null;
}

export type ContinuityIssueKind = "date_gap" | "balance_break" | "overlap";

export interface ContinuityIssue {
  kind: ContinuityIssueKind;
  iban: string | null;
  /** Het afschrift vóór het gat en dat erna (voor "tussen X en Y"). */
  before: StatementPeriod;
  after: StatementPeriod;
  /** Bij een datumgat: de ontbrekende dagen (exclusief de afschriftdagen zelf). */
  missingFrom?: string;
  missingTo?: string;
  missingDays?: number;
  /** Bij een saldobreuk: het verschil (eindsaldo A − beginsaldo B). Positief = geld verdwenen. */
  difference?: number;
  /** Eén zin, klaar voor het scherm. Nederlands, feitelijk, zonder alarm. */
  message: string;
}

export interface ContinuityResult {
  issues: ContinuityIssue[];
  /** Aantal rekeningen dat we hebben gezien (voor een eerlijke "we keken naar N rekeningen"). */
  accounts: number;
  /** False wanneer geen enkel afschrift saldi draagt — dan is de saldocontrole niet gedraaid. */
  balancesKnown: boolean;
  /** Het bereik dat we in totaal aan afschriften hebben, per rekening. */
  covered: Array<{ iban: string | null; from: string; to: string; statements: number }>;
}

const DAY_MS = 86_400_000;

function toMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}
function isIso(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function addDays(iso: string, n: number): string {
  return new Date(toMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
}
function eur(n: number): string {
  return `€ ${Math.abs(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function nlDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}-${Number(m)}-${y}`;
}

/**
 * Zoek gaten in de bankgeschiedenis.
 *
 * @param statements alle ingelezen afschriften (volgorde maakt niet uit)
 * @param opts.toleranceEur saldoverschil dat als afronding telt (default 1 cent)
 * @param opts.maxGapDays   een gat kleiner dan dit meldt niet — afschriften sluiten in de
 *                          praktijk niet altijd exact op elkaar aan (weekend, een dag overlap
 *                          in de export). Default 1 dag: alleen een écht gat telt.
 */
export function findStatementGaps(
  statements: StatementPeriod[],
  opts?: { toleranceEur?: number; maxGapDays?: number },
): ContinuityResult {
  const tol = opts?.toleranceEur ?? 0.01;
  const maxGapDays = opts?.maxGapDays ?? 1;

  // Alleen afschriften met een leesbare periode doen mee; een afschrift zonder datums kan
  // niets bewijzen en mag ook geen gat suggereren.
  const usable = (statements ?? []).filter((s) => isIso(s.from) && isIso(s.to) && toMs(s.from) <= toMs(s.to));

  const byAccount = new Map<string, StatementPeriod[]>();
  for (const s of usable) {
    const key = (s.iban ?? "").toUpperCase();
    const arr = byAccount.get(key) ?? [];
    arr.push(s);
    byAccount.set(key, arr);
  }

  const issues: ContinuityIssue[] = [];
  const covered: ContinuityResult["covered"] = [];
  let balancesKnown = false;

  for (const [, list] of byAccount) {
    const sorted = [...list].sort((a, b) => (a.from === b.from ? toMs(a.to) - toMs(b.to) : toMs(a.from) - toMs(b.from)));
    covered.push({
      iban: sorted[0].iban ?? null,
      from: sorted[0].from,
      to: sorted.reduce((max, s) => (toMs(s.to) > toMs(max) ? s.to : max), sorted[0].to),
      statements: sorted.length,
    });

    for (let i = 1; i < sorted.length; i++) {
      const before = sorted[i - 1];
      const after = sorted[i];
      const label = before.iban ? ` op ${before.iban}` : "";

      // 1. Overlap — dezelfde dagen twee keer ingelezen.
      if (toMs(after.from) <= toMs(before.to)) {
        issues.push({
          kind: "overlap",
          iban: before.iban ?? null,
          before,
          after,
          message:
            `Twee bankafschriften${label} overlappen (${nlDate(after.from)} t/m ${nlDate(before.to)}). ` +
            `Controleer of dezelfde transacties niet dubbel zijn ingelezen.`,
        });
        continue; // bij overlap zegt een saldovergelijking niets zinnigs
      }

      // 2. Datumgat — er zitten dagen tussen waarvoor geen afschrift bestaat.
      const gapDays = Math.round((toMs(after.from) - toMs(before.to)) / DAY_MS) - 1;
      if (gapDays >= maxGapDays) {
        const missingFrom = addDays(before.to, 1);
        const missingTo = addDays(after.from, -1);
        issues.push({
          kind: "date_gap",
          iban: before.iban ?? null,
          before,
          after,
          missingFrom,
          missingTo,
          missingDays: gapDays,
          message:
            gapDays === 1
              ? `Er ontbreekt een bankafschrift${label} voor ${nlDate(missingFrom)}.`
              : `Er ontbreekt een bankafschrift${label} voor ${nlDate(missingFrom)} t/m ${nlDate(missingTo)} (${gapDays} dagen).`,
        });
        continue; // het saldoverschil is hier het GEVOLG van het gat, geen tweede melding waard
      }

      // 3. Saldobreuk — de datums sluiten aan, de saldi niet. Het sterkste signaal dat er
      //    tussen deze twee bestanden iets ontbreekt of dat er iets van een andere rekening is.
      if (before.closing != null && after.opening != null) {
        balancesKnown = true;
        const diff = round2(before.closing - after.opening);
        if (Math.abs(diff) > tol) {
          issues.push({
            kind: "balance_break",
            iban: before.iban ?? null,
            before,
            after,
            difference: diff,
            message:
              `De saldi sluiten niet op elkaar aan${label}: het afschrift tot ${nlDate(before.to)} eindigt op ` +
              `${eur(before.closing)} en het volgende begint op ${eur(after.opening)} — een verschil van ${eur(diff)}. ` +
              `Er ontbreekt waarschijnlijk een afschrift of een deel ervan.`,
          });
        }
      }
    }

    // Zelfs zonder breuk: weten we überhaupt of saldi bekend zijn?
    if (!balancesKnown) {
      balancesKnown = sorted.some((s) => s.opening != null || s.closing != null);
    }
  }

  // Nieuwste gaten eerst — dat is wat de eigenaar nu nog kan ophalen bij zijn bank.
  issues.sort((a, b) => toMs(b.after.from) - toMs(a.after.from));

  return { issues, accounts: byAccount.size, balancesKnown, covered };
}

/**
 * Eén zin voor het overzicht ("Klaar"-scherm). Nooit "compleet" claimen wanneer we geen saldi
 * hebben gezien — dan hebben we alleen de datums kunnen controleren, en dat zeggen we.
 */
export function summarizeContinuity(r: ContinuityResult): string {
  if (r.accounts === 0) return "Nog geen bankafschriften ingelezen.";
  if (r.issues.length === 0) {
    return r.balancesKnown
      ? "Je bankafschriften sluiten op elkaar aan — geen ontbrekende periode gevonden."
      : "Je bankafschriften sluiten qua periode op elkaar aan. Saldi staan niet in deze bestanden, dus dat deel konden we niet controleren.";
  }
  const gaps = r.issues.filter((i) => i.kind === "date_gap").length;
  const breaks = r.issues.filter((i) => i.kind === "balance_break").length;
  const overlaps = r.issues.filter((i) => i.kind === "overlap").length;
  const parts: string[] = [];
  if (gaps > 0) parts.push(gaps === 1 ? "1 ontbrekende periode" : `${gaps} ontbrekende periodes`);
  if (breaks > 0) parts.push(breaks === 1 ? "1 saldobreuk" : `${breaks} saldobreuken`);
  if (overlaps > 0) parts.push(overlaps === 1 ? "1 overlappend afschrift" : `${overlaps} overlappende afschriften`);
  return `In je bankgeschiedenis: ${parts.join(" · ")}.`;
}

// ── [DEKKING] Beslaan de afschriften het hele kwartaal? ────────────────────────────────

/**
 * Wat er van een periode NIET door een afschrift wordt gedekt, per rekening.
 *
 * ── WAAROM DIT NAAST findStatementGaps STAAT EN NIET ERIN ──
 *
 * findStatementGaps kijkt tussen afschriften ONDERLING: A eindigt 31-01, B begint 01-03, dus
 * februari ontbreekt. Dat is precies dezelfde vorm als de gatencontrole op de factuurnummering —
 * en dus ook precies even blind aan de RANDEN. Wie alleen januari uploadt heeft geen enkel gat
 * tussen zijn afschriften: er is er maar één. Februari en maart ontbreken gewoon, en niets in
 * die controle kan dat zien.
 *
 * Voor het kwartaalpakket is dat de belangrijkste vraag die er is. Het pakket levert een
 * afletering af — welke bankregel bij welke factuur hoort — en die leest als een afgeronde
 * klus. Over een maand die nooit is ingelezen is elke regel keurig gekoppeld en klopt er niets
 * van: de facturen die in die maand betaald zijn staan nog open, en de omzet die erin binnenkwam
 * is nergens aangesloten.
 *
 * ── DE DISCIPLINE ──
 *
 * Per rekening, om dezelfde reden als hierboven: twee rekeningen door elkaar zijn geen gat.
 * `checked: false` wanneer er van deze gebruiker géén afschriftperiodes bekend zijn — dan is er
 * niet gekeken, en dat is iets anders dan "gedekt". Een dag telt als gedekt zodra één afschrift
 * van die rekening hem beslaat; overlap is hier geen probleem (dat meldt findStatementGaps).
 */
export interface PeriodCoverage {
  iban: string | null;
  /** De stukken van de gevraagde periode die geen enkel afschrift beslaat. */
  missing: Array<{ from: string; to: string; days: number }>;
  /** Hoeveel afschriften van deze rekening de periode raken. */
  statements: number;
}

export interface CoverageResult {
  accounts: PeriodCoverage[];
  /** True wanneer elke rekening de hele periode dekt. False zodra er ook maar één dag mist. */
  complete: boolean;
  /** False wanneer er geen afschriftperiodes zijn — niet gekeken, nooit "wel gedekt". */
  checked: boolean;
}

export function coverageOfPeriod(
  statements: StatementPeriod[],
  from: string,
  to: string,
): CoverageResult {
  if (!isIso(from) || !isIso(to) || toMs(from) > toMs(to)) {
    return { accounts: [], complete: false, checked: false };
  }
  const usable = (statements ?? []).filter((s) => isIso(s.from) && isIso(s.to) && toMs(s.from) <= toMs(s.to));
  if (usable.length === 0) return { accounts: [], complete: false, checked: false };

  const byAccount = new Map<string, StatementPeriod[]>();
  for (const s of usable) {
    const key = (s.iban ?? "").trim() || "";
    byAccount.set(key, [...(byAccount.get(key) ?? []), s]);
  }

  const accounts: PeriodCoverage[] = [];
  for (const [key, list] of byAccount) {
    // Alleen de stukken die binnen de gevraagde periode vallen, op datum.
    const spans = list
      .map((s) => ({
        from: toMs(s.from) < toMs(from) ? from : s.from,
        to: toMs(s.to) > toMs(to) ? to : s.to,
      }))
      .filter((s) => toMs(s.from) <= toMs(s.to))
      .sort((a, b) => toMs(a.from) - toMs(b.from));

    const missing: Array<{ from: string; to: string; days: number }> = [];
    // De wandelaar: alles vóór `cursor` is gedekt. Elk span dat later begint laat een gat achter.
    let cursor = from;
    for (const span of spans) {
      if (toMs(span.from) > toMs(cursor)) {
        const gapTo = addDays(span.from, -1);
        missing.push({
          from: cursor,
          to: gapTo,
          days: Math.round((toMs(gapTo) - toMs(cursor)) / DAY_MS) + 1,
        });
      }
      if (toMs(span.to) >= toMs(cursor)) cursor = addDays(span.to, 1);
    }
    // En de rand aan het EIND, waar de controle tussen afschriften structureel blind voor is.
    if (toMs(cursor) <= toMs(to)) {
      missing.push({ from: cursor, to, days: Math.round((toMs(to) - toMs(cursor)) / DAY_MS) + 1 });
    }
    accounts.push({ iban: key === "" ? null : key, missing, statements: spans.length });
  }

  accounts.sort((a, b) => (a.iban ?? "").localeCompare(b.iban ?? ""));
  return { accounts, complete: accounts.every((a) => a.missing.length === 0), checked: true };
}

/**
 * Eén zin over de dekking, of null wanneer er niets te melden valt.
 *
 * Null wanneer NIET gekeken kon worden: daar hoort de afletering zelf iets over te zeggen, en
 * twee verschillende zinnen over hetzelfde onbekende maken het alleen onduidelijker.
 */
export function coverageSentence(c: CoverageResult): string | null {
  if (!c.checked || c.complete) return null;
  const gaps = c.accounts.flatMap((a) => a.missing.map((m) => ({ iban: a.iban, ...m })));
  if (gaps.length === 0) return null;
  const days = gaps.reduce((sum, g) => sum + g.days, 0);
  const first = gaps[0];
  const where = first.iban ? ` (${first.iban})` : "";
  const rest = gaps.length > 1 ? ` en ${gaps.length - 1} andere periode${gaps.length > 2 ? "s" : ""}` : "";
  return (
    `Van dit kwartaal ${days === 1 ? "ontbreekt 1 dag" : `ontbreken ${days} dagen`} aan bankafschrift: ` +
    `${nlDate(first.from)} t/m ${nlDate(first.to)}${where}${rest}. ` +
    "Wat in die periode is betaald of ontvangen staat niet in dit pakket."
  );
}
