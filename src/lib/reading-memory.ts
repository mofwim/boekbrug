// src/lib/reading-memory.ts
// [READING-MEMORY] What the owner keeps correcting on a supplier's invoices.
// Pure, no I/O.
//
// ── WHY THIS EXISTS ──
// The reader gets the same supplier wrong in the same way, month after month. Elegance Brands lost
// its second btw rate in June; the extraction prompt was strengthened on 26 July; on 30 July the
// next Elegance Brands invoice arrived with the same field wrong. The owner corrected it both
// times, and both corrections went nowhere: each invoice is read as if no invoice had ever been
// read before.
//
// A human bookkeeper does not work that way. After the second time they know that THIS supplier
// puts statiegeld on a separate 0% line, and they check that line first. This module is that
// knowledge, made explicit.
//
// ── WHAT IT DOES NOT DO ──
// It never changes an amount, and it never pre-fills one. It cannot: a past correction was about a
// past invoice, and applying its number to a new one would be inventing money — the exact thing
// every gate in this line exists to prevent. What it produces is a SENTENCE for the person doing
// the checking: on this supplier you have corrected the btw three times, look there first.
//
// So the app does learn, but it learns where to point the human, not what the answer is. That
// distinction is the whole design: a wrong hint costs a glance, and a wrong auto-correction costs
// a wrong aangifte.

/** The fields a reviewer can correct on the verify screen, in the order they matter. */
export const CORRECTABLE_FIELDS = [
  "total_ex_btw",
  "btw_amount",
  "total_inc_btw",
  "invoice_type",
  "client_name",
  "invoice_number",
  "invoice_date",
] as const;

export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

/** What the reader produced, and what the human confirmed. Any field may be absent or null. */
export type ReadingSnapshot = Partial<Record<CorrectableField, string | number | null | undefined>>;

/** Cents. Below this two amounts are the same number, not a correction. */
const MONEY_EPSILON = 0.005;

const MONEY_FIELDS = new Set<CorrectableField>(["total_ex_btw", "btw_amount", "total_inc_btw"]);

/**
 * An amount, or null when there is no amount there.
 *
 * The blank string is the trap: `Number("")` is 0, not NaN, so a field the reader left empty
 * would compare as "the reader said zero" and every human entry after it would look like a
 * correction of a wrong number. A real 0 (an exempt invoice — the pension premium is 266.62 / 0 /
 * 266.62) IS a reading and must keep counting as one, so this cannot simply treat falsy as absent.
 */
function amountOf(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Which fields the human actually CHANGED.
 *
 * Not "which fields were submitted": the verify screen posts the whole form, so every field comes
 * back on every confirm and a route that recorded those would learn that the owner corrects
 * everything, always — a memory that says everything says nothing.
 *
 * A field counts as corrected only when both sides have a value and they differ. `after` missing
 * means the screen did not send it (unchanged); `before` missing means the reader never produced
 * it, and filling an empty field is not the same as correcting a wrong one — that is a gap the
 * import-health gate already reports in its own words.
 */
export function correctedFields(before: ReadingSnapshot, after: ReadingSnapshot): CorrectableField[] {
  const out: CorrectableField[] = [];
  for (const f of CORRECTABLE_FIELDS) {
    const a = before[f];
    const b = after[f];
    if (a == null || b == null) continue;
    if (MONEY_FIELDS.has(f)) {
      const na = amountOf(a);
      const nb = amountOf(b);
      // No comparison to make on either side; saying nothing beats recording a correction that may
      // not have happened.
      if (na === null || nb === null) continue;
      if (Math.abs(na - nb) > MONEY_EPSILON) out.push(f);
    } else if (String(a).trim() !== String(b).trim()) {
      out.push(f);
    }
  }
  return out;
}

/** One recorded correction, as it comes back out of the audit trail. */
export type CorrectionRecord = {
  /** The supplier as it stood on the invoice at the time. */
  vendor: string | null | undefined;
  fields: readonly string[];
  /** ISO timestamp; used only for ordering and for "how recent". */
  at?: string | null;
};

export type VendorMemory = {
  vendor: string;
  /** How many of this vendor's invoices the owner corrected. */
  corrections: number;
  /** Per field, how many times it was corrected — highest first, then by CORRECTABLE_FIELDS order. */
  byField: Array<{ field: CorrectableField; count: number }>;
  /** The most recent correction's timestamp, when known. */
  lastAt: string | null;
};

/** Keyed the way every screen in this line keys a supplier: trimmed, lowercased. */
export function vendorKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * Fold the recorded corrections into one entry per supplier.
 *
 * Deliberately counts INVOICES, not fields: three corrections on one invoice is one invoice the
 * reader got wrong, and a memory that counted six would make a single bad scan look like a pattern.
 */
export function buildReadingMemory(records: readonly CorrectionRecord[]): Map<string, VendorMemory> {
  const known = new Set<string>(CORRECTABLE_FIELDS);
  const out = new Map<string, VendorMemory>();

  for (const r of records) {
    const key = vendorKey(r.vendor);
    if (!key) continue;
    // An entry with no fields is a confirm that changed nothing — not a correction.
    const fields = r.fields.filter((f): f is CorrectableField => known.has(f as CorrectableField));
    if (fields.length === 0) continue;

    const entry = out.get(key) ?? { vendor: (r.vendor ?? "").trim(), corrections: 0, byField: [], lastAt: null };
    entry.corrections++;
    // Same invoice, same field twice cannot happen within one record, so a plain increment is safe.
    for (const f of new Set(fields)) {
      const seen = entry.byField.find((b) => b.field === f);
      if (seen) seen.count++;
      else entry.byField.push({ field: f, count: 1 });
    }
    if (r.at && (entry.lastAt == null || r.at > entry.lastAt)) entry.lastAt = r.at;
    out.set(key, entry);
  }

  const order = new Map(CORRECTABLE_FIELDS.map((f, i) => [f, i]));
  for (const entry of out.values()) {
    entry.byField.sort((a, b) => b.count - a.count || (order.get(a.field)! - order.get(b.field)!));
  }
  return out;
}

// Dutch, because these are the words on the card. See the language rule at the top of AGENTS.md:
// the identifiers and the reasoning are English, what the entrepreneur reads stays Dutch.
const FIELD_LABEL_NL: Record<CorrectableField, string> = {
  total_ex_btw: "het bedrag excl. btw",
  btw_amount: "het btw-bedrag",
  total_inc_btw: "het totaalbedrag",
  invoice_type: "het soort document",
  client_name: "de leveranciersnaam",
  invoice_number: "het factuurnummer",
  invoice_date: "de factuurdatum",
};

/**
 * How many corrections before we say anything.
 *
 * TWO, not one. One correction is an incident — every supplier produces one eventually, and a hint
 * on every card is a hint on no card. Two on the same supplier is the earliest point at which
 * "this keeps happening here" is a claim we can stand behind.
 */
export const MEMORY_THRESHOLD = 2;

/**
 * The sentence for the card, or null when there is nothing worth saying.
 *
 * Names the FIELD, not a number. "Check the btw here" sends the reviewer to the right line; a
 * remembered amount would send them to the wrong one, because it belongs to a different invoice.
 */
export function readingHint(memory: VendorMemory | undefined): string | null {
  if (!memory || memory.corrections < MEMORY_THRESHOLD) return null;
  // Only the fields corrected more than once — the ones that make this a pattern rather than a
  // list of everything that ever went wrong at this supplier.
  const repeated = memory.byField.filter((b) => b.count >= MEMORY_THRESHOLD);
  const shown = (repeated.length > 0 ? repeated : memory.byField).slice(0, 2);
  if (shown.length === 0) return null;

  const labels = shown.map((b) => FIELD_LABEL_NL[b.field]);
  const what = labels.length === 1 ? labels[0] : `${labels[0]} en ${labels[1]}`;
  return `Bij deze leverancier heb je ${memory.corrections} eerdere facturen zelf gecorrigeerd — meestal ${what}. Controleer dat hier extra.`;
}

/** The hint for one supplier by name, so a screen does not have to know how the map is keyed. */
export function readingHintFor(vendor: string | null | undefined, memory: Map<string, VendorMemory>): string | null {
  return readingHint(memory.get(vendorKey(vendor)));
}
