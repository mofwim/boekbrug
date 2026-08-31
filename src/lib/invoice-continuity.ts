// src/lib/invoice-continuity.ts
// [DOORLOPEND] Does the invoice numbering actually run unbroken? The rule, with no I/O.
// Run: npx tsx --test src/lib/invoice-continuity.test.ts
//
// ── WHY THIS EXISTS ──
//
// Article 35 Wet OB requires a doorlopende nummerreeks: sequential, no gaps, never reused. It is
// the first thing an accountant checks and among the first things a boekencontrole asks about, and
// until now nothing in this app could answer it. The numbering itself is atomic — next_invoice_seq()
// allocates under a row lock — but atomic is not the same as gapless:
//
//     const generated = await generateInvoiceNumber(...)   // the counter moves HERE
//     …                                                    // and if anything below throws,
//     await supabase.from('invoices').insert(...)           // that number exists nowhere
//
// A PDF that fails to render, a mail that bounces mid-send, a deploy in the wrong second: the
// counter has moved and no invoice carries the number. Nothing is wrong with the app afterwards.
// Nothing logs it. The owner finds out from his accountant, a year later, about an invoice he
// cannot reconstruct because it was never written.
//
// ── THE TWO CHECKS, AND WHY ONE IS NOT ENOUGH ──
//
//   1. HOLES.       Scan the issued numbers for missing values between the lowest and the highest.
//   2. THE COUNTER. Compare the highest issued number with invoice_counters.last_seq.
//
// The second is not redundancy. A hole-scan can only see a gap that has an invoice on BOTH sides of
// it — so it is structurally blind to the most likely gap of all, the one at the end: the last send
// failed, the counter stands at 12, the highest invoice is 11, and there is no hole anywhere. That
// is invisible to every "check my numbering" tool that only looks at the invoices.
//
// ── AND THE RULE THAT KEEPS IT FROM CRYING WOLF ──
//
// THE SERIES STARTS AT THE OWNER'S FIRST INVOICE, NOT AT 1.
//
// A zzp'er who moves to BoekBrug mid-year starts at 45 because his previous package ended at 44.
// Counting from 1 would greet him with forty-four "missing" invoices on his first day — and a tool
// that is wrong the first time it speaks is a tool nobody reads the second time. The numbers before
// his first are not gaps in this administration; they are somebody else's records.

/** One invoice, as much of it as this check needs. */
export type NumberedInvoice = {
  invoice_number?: string | null;
  /** 'factuur' | 'creditnota' | 'pro_forma' — the series it belongs to, keyed like invoice_counters. */
  invoice_type?: string | null;
};

/** How one series renders its numbers. Mirrors invoice_counters (user_id, year, type). */
export type SeriesFormat = {
  /** 'factuur' | 'creditnota' */
  type: string;
  /** e.g. "{year}{seq}", "{seq}-{year}", "CR-{year}{seq}", "{seq}". */
  template: string;
  /** Digit width of the counter as the owner types it ("045" → 3). */
  padding: number;
};

/** Where the counter stands for one (type, year), as invoice_counters holds it. */
export type CounterRow = { type?: string | null; year?: number | null; last_seq?: number | null };

export type SeriesReport = {
  /** The series this is about: type plus the year in its numbers, or null for a continuous series. */
  type: string;
  year: number | null;
  /**
   * The lowest and highest sequence number actually issued in this administration.
   *
   * [REEKS-ZONDER-FACTUUR] Null when the series has no invoices at all — which is a real state, not
   * an empty one: a counter can stand above zero while nothing was ever written under it. Zero
   * would be a claim ("the series runs from 0 to 0") about numbers that do not exist.
   */
  first: number | null;
  last: number | null;
  /** How many invoices carry a number in this series. */
  issued: number;
  /** Sequence values with no invoice, BETWEEN first and last. Never below first — see the header. */
  missing: number[];
  /**
   * The counter stands above the highest issued number, so this many numbers were allocated and
   * never written. 0 when they agree, null when the counter could not be read.
   */
  burnedAtEnd: number | null;
  /** Numbers appearing twice. Structurally impossible (UNIQUE (sender_id, invoice_number)) — see below. */
  duplicates: string[];
};

export type ContinuityReport = {
  series: SeriesReport[];
  /**
   * Numbers that match no known series format.
   *
   * NOT dropped and NOT counted as gaps. A number in an old format — imported history, a template
   * the owner changed halfway — is neither proof of a gap nor proof of its absence, and both of
   * those lies are available here. It is reported as its own thing, and it makes `clean` false: we
   * cannot call a series unbroken while holding numbers we could not place in it.
   */
  unreadable: string[];
  /**
   * True only when every series is unbroken, no number was burned, nothing is duplicated AND every
   * number could be read. Anything less is not "probably fine" — it is a question for the owner.
   */
  clean: boolean;
};

/**
 * A pattern that recovers the sequence (and year, if any) from a rendered number.
 *
 * Built by walking the template once, emitting a capture where a token stands and escaping
 * everything between. It inverts formatInvoiceNumber() exactly, and it reports which capture is
 * which — so a "045-2026" and a "2026-045" are read correctly without anybody having to reason
 * about capture order at the call site.
 *
 * The literals ARE escaped, and that is not decoration: with a template like "{seq}.{year}" an
 * unescaped dot matches any character, and "045x2026" is then quietly filed as invoice 45.
 *
 * An earlier version built this by substituting placeholder strings (" SEQ ") into the template and
 * regexing them back out. It worked, and it also put a stray byte into this file where one of those
 * placeholders' spaces should have been — invisible, because both halves were mangled the same way
 * and every test still passed. Walking the string removes the round-trip and the whole class with
 * it.
 */
function seriesPattern(format: SeriesFormat): { re: RegExp; seqGroup: number; yearGroup: number } {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // At least the padding, but the counter may have outgrown it: an owner who padded to 3 and has
  // issued 1200 invoices renders "1200", and a fixed {3} would leave every one of them unread.
  const seqPattern = `(\\d{${Math.max(1, format.padding)},})`;

  let body = "";
  let rest = format.template;
  let group = 0;
  let seqGroup = 0;
  let yearGroup = 0;
  for (;;) {
    const match = /\{(seq|year)\}/.exec(rest);
    if (!match) {
      body += escape(rest);
      break;
    }
    body += escape(rest.slice(0, match.index));
    group += 1;
    if (match[1] === "seq") {
      body += seqPattern;
      seqGroup = group;
    } else {
      body += "(\\d{4})";
      yearGroup = group;
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return { re: new RegExp(`^${body}$`), seqGroup, yearGroup };
}

/**
 * Split a rendered number into its year and sequence, for one series format.
 *
 * Returns null when the number does not belong to this format at all — which is information, not a
 * failure: the caller tries every known format before calling a number unreadable.
 */
export function readNumber(
  invoiceNumber: string,
  format: SeriesFormat,
): { year: number | null; seq: number } | null {
  const { re, seqGroup, yearGroup } = seriesPattern(format);
  if (seqGroup === 0) return null; // a template with no {seq} numbers nothing
  const match = re.exec(invoiceNumber.trim());
  if (!match) return null;

  const seq = Number.parseInt(match[seqGroup], 10);
  if (!Number.isFinite(seq) || seq < 0) return null;
  const year = yearGroup === 0 ? null : Number.parseInt(match[yearGroup], 10);
  if (year !== null && !Number.isFinite(year)) return null;
  return { year, seq };
}

/** The series key an invoice belongs to. Same shape as invoice_counters: type plus year. */
const keyOf = (type: string, year: number | null) => `${type} ${year ?? ""}`;

/**
 * Check the numbering of an administration.
 *
 * `formats` decides which series exist and how each renders — the caller owns that, because it
 * depends on the owner's stored template and this module must stay free of database shapes.
 * `counters` may be empty: then `burnedAtEnd` is null everywhere, which reads as "we did not
 * check that half", never as "nothing was burned".
 */
export function checkContinuity(args: {
  invoices: readonly NumberedInvoice[];
  formats: readonly SeriesFormat[];
  counters?: readonly CounterRow[] | null;
}): ContinuityReport {
  const { invoices, formats } = args;
  const counters = args.counters ?? null;

  const seen = new Map<string, { type: string; year: number | null; seqs: number[]; numbers: string[] }>();
  const unreadable: string[] = [];

  for (const invoice of invoices) {
    const number = (invoice.invoice_number ?? "").trim();
    if (number === "") continue; // a draft carries no number and is not part of the series

    // Only the formats for THIS invoice's type. Without that filter a creditnota "CR-20260001"
    // could be read by a permissive factuur template and land in the wrong series — inventing a
    // hole in one and hiding one in the other.
    const candidates = formats.filter((f) => f.type === (invoice.invoice_type ?? "factuur"));
    if (candidates.length === 0) continue; // a type we do not check (pro forma is not a fiscal document)

    let placed = false;
    for (const format of candidates) {
      const read = readNumber(number, format);
      if (!read) continue;
      const key = keyOf(format.type, read.year);
      const bucket = seen.get(key) ?? { type: format.type, year: read.year, seqs: [], numbers: [] };
      bucket.seqs.push(read.seq);
      bucket.numbers.push(number);
      seen.set(key, bucket);
      placed = true;
      break;
    }
    if (!placed) unreadable.push(number);
  }

  const series: SeriesReport[] = [];
  for (const bucket of seen.values()) {
    const sorted = [...bucket.seqs].sort((a, b) => a - b);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    // Between first and last, and never below first. The header says why at length: a series that
    // starts at 45 because the previous package ended at 44 has no gap at 1..44.
    const present = new Set(sorted);
    const missing: number[] = [];
    for (let n = first + 1; n < last; n += 1) if (!present.has(n)) missing.push(n);

    // Belt and braces: UNIQUE (sender_id, invoice_number) makes this impossible in the database, so
    // finding one means the constraint is absent in this deployment — which is worth knowing, and
    // costs one Set to check.
    const counts = new Map<string, number>();
    for (const n of bucket.numbers) counts.set(n, (counts.get(n) ?? 0) + 1);
    const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);

    // The end of the series, which the hole-scan above is structurally blind to.
    const counter = counters?.find(
      (c) => (c.type ?? "") === bucket.type && (c.year ?? null) === bucket.year,
    );
    const lastSeq = counter?.last_seq;
    const burnedAtEnd =
      counters === null || counter === undefined || typeof lastSeq !== "number"
        ? null
        : Math.max(0, lastSeq - last);

    series.push({ type: bucket.type, year: bucket.year, first, last, issued: sorted.length, missing, duplicates, burnedAtEnd });
  }

  // ── [REEKS-ZONDER-FACTUUR] De reeksen waar de teller wél iets over zegt en de facturen niets ──
  //
  // De lus hierboven loopt over de emmers die uit de FACTUREN zijn gebouwd. Een reeks zonder ook
  // maar één factuur heeft dus geen emmer, en burnedAtEnd — de enige controle die het EINDE van een
  // reeks ziet — wordt er nooit voor uitgerekend. De uitslag zegt dan "alles loopt door" over
  // nummers die zijn uitgegeven en nooit geschreven.
  //
  // Dat is geen theoretisch geval en het is geen kwestie van een lege administratie. De gewone vorm
  // is een ondernemer die facturen stuurt maar nog nooit een creditnota heeft gemaakt, terwijl er
  // wel een creditnota-nummer is toegekend (een concept dat is weggegooid). Gemeten in de
  // productiedatabase toen dit werd geschreven: twee eigenaren met een creditnota-teller op 1 en 2
  // en nul creditnota's — drie toegekende nummers die nergens staan, en alle drie de eigenaren
  // lazen op hun scherm dat hun nummering klopt.
  //
  // `series.every(...)` over een lege lijst is `true`, en dat is precies hoe die stilte eruitziet:
  // niet als een fout, maar als een geruststelling.
  for (const counter of counters ?? []) {
    const type = counter.type ?? "";
    const year = counter.year ?? null;
    // Alleen reeksen die dit rapport überhaupt beoordeelt. Een teller voor een type waarvoor geen
    // formaat is meegegeven (pro forma) hoort hier net zo min als in de lus hierboven.
    if (!formats.some((f) => f.type === type)) continue;
    if (seen.has(keyOf(type, year))) continue;
    const lastSeq = counter.last_seq;
    if (typeof lastSeq !== "number" || lastSeq <= 0) continue;
    series.push({
      type, year,
      first: null, last: null, issued: 0,
      missing: [],
      duplicates: [],
      // Alles wat de teller heeft uitgegeven is verbrand: er staat geen enkel nummer tegenover.
      burnedAtEnd: lastSeq,
    });
  }

  // Stable order so two runs read the same: by type, then by year, oldest first.
  series.sort((a, b) => a.type.localeCompare(b.type) || (a.year ?? 0) - (b.year ?? 0));

  const clean =
    unreadable.length === 0 &&
    series.every((s) => s.missing.length === 0 && s.duplicates.length === 0 && (s.burnedAtEnd ?? 0) === 0);

  return { series, unreadable, clean };
}

/**
 * How many numbers are unaccounted for across the whole administration, or null when we could not
 * establish it.
 *
 * Null the moment anything was unreadable or a counter was missing — the same refusal as
 * security-overview.ts: a total computed over a partial read is not a smaller truth, it is a
 * confident wrong number on a screen an owner would quote to his accountant.
 */
export function totalUnaccounted(report: ContinuityReport): number | null {
  if (report.unreadable.length > 0) return null;
  if (report.series.some((s) => s.burnedAtEnd === null)) return null;
  return report.series.reduce((sum, s) => sum + s.missing.length + (s.burnedAtEnd ?? 0), 0);
}
