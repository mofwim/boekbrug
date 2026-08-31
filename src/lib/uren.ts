// src/lib/uren.ts
// [UREN] Gewerkte uren, en wat er van te factureren valt. Pure functies, geen I/O.
// Run: npx tsx --test src/lib/uren.test.ts
//
// WAAROM DIT BESTAND BESTAAT
//
// De app kon een uur al factureren — invoice_lines draagt quantity × unit_price en units.ts kent
// 'uur'. Wat er niet was, is de plek waar dat uur vandaan komt. De zzp'er die per uur werkt hield
// ze bij in een schrift of in Excel en tikte ze aan het eind van de maand over, en overtikken lekt
// maar één kant op: een vergeten uur wordt nooit gefactureerd.
//
// DE ENE REGEL DIE ALLES DRAAGT
//
// Een uur dat op een factuur staat, WIJST naar die factuur (time_entries.invoice_id). "Nog te
// factureren" is daarmee geen berekening maar een kolom, en hetzelfde uur kan niet twee keer mee.
// Dit bestand rekent daaromheen en verzint die waarheid nooit zelf: het krijgt rijen en zegt wat
// eruit volgt.
//
// [CENT] Eén afronding, die van de app (invoice-totals.round2). Uren zijn de plek waar dat het
// meest knelt: 1,5 uur × € 33,33 is 49,995, en dat getal moet op de factuurregel als één bedrag
// staan dat optelt tot het totaal. De draft-route zegt hetzelfde over dezelfde som.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the Dutch that appears here
// is in field names that mirror the database columns, and in nothing else — the sentences the
// owner reads live in messages.ts.

import { round2, isValidBtwRate } from "./invoice-totals";
// [TARIEF-STRIKT] The list itself is no longer imported here — isValidBtwRate above answers the
// question, and it reads BTW_RATES from the same module the invoice door does. A second list of
// legal btw rates is a list that drifts, and the one that drifts is the one nobody is testing;
// asking one function instead of holding one list closes that for good.

/** One recorded stretch of work, as the database stores it. */
export interface TimeEntry {
  id: string;
  /** The customer this was worked for. Null = not linked to a card yet. */
  client_id: string | null;
  /** The DAY it was worked, never the day it was typed in. */
  worked_on: string;
  /** What was done — this becomes the line the customer reads on the invoice. */
  description: string;
  hours: number;
  /** Ex btw. Null = not agreed yet, which is a different thing from zero. */
  hourly_rate: number | null;
  /** The invoice this hour is already on. Null = still billable. */
  invoice_id: string | null;
}

/** What one hour is worth, or null when no rate has been set. */
export function entryValue(entry: Pick<TimeEntry, "hours" | "hourly_rate">): number | null {
  const hours = Number(entry.hours);
  const rate = entry.hourly_rate;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (rate === null || rate === undefined) return null;
  const r = Number(rate);
  if (!Number.isFinite(r) || r < 0) return null;
  // [CENT] The app's one rounding. 1,5 × 33,33 = 49,995 becomes 50,00 here and on the invoice
  // line, because two roundings of the same product disagree by exactly the half cent that ends
  // up in a customer's total.
  return round2(hours * r);
}

/**
 * Is this hour still billable?
 *
 * The column, never a guess. A row with an invoice_id is on an invoice — that is what the foreign
 * key means — and no amount of date arithmetic may overrule it.
 */
export function isBillable(entry: Pick<TimeEntry, "invoice_id">): boolean {
  return entry.invoice_id === null || entry.invoice_id === undefined;
}

/** The unbilled hours of one customer, and what they are worth. */
export interface BillableGroup {
  /** Null groups the hours that carry no customer card yet — see the note in the migration. */
  clientId: string | null;
  entries: TimeEntry[];
  /** Total hours, rounded once. */
  hours: number;
  /**
   * What those hours come to, ex btw — counting only the entries that HAVE a rate.
   *
   * Entries without one are in `entries` and in `hours` but not in this figure, and
   * `withoutRate` says how many. An amount that silently swallowed them would be a number the
   * owner cannot reconcile with the list printed beside it.
   */
  amountExBtw: number;
  /** How many of these entries have no rate yet. > 0 ⇒ amountExBtw is deliberately incomplete. */
  withoutRate: number;
}

/**
 * Group the billable hours per customer, newest work first.
 *
 * Only entries that are actually billable are considered: an hour already on an invoice is not a
 * candidate, and this function will not put it back in the pool no matter what else it says.
 */
export function groupBillable(entries: readonly TimeEntry[]): BillableGroup[] {
  const byClient = new Map<string | null, TimeEntry[]>();
  for (const e of entries) {
    if (!isBillable(e)) continue;
    const hours = Number(e.hours);
    // A row that cannot state how long it took is not a billable quantity. It stays in the
    // database and stays visible on the screen; it just cannot be turned into a line.
    if (!Number.isFinite(hours) || hours <= 0) continue;
    const key = e.client_id ?? null;
    const list = byClient.get(key) ?? [];
    list.push(e);
    byClient.set(key, list);
  }

  const groups: BillableGroup[] = [];
  for (const [clientId, list] of byClient) {
    // Newest work first: the hour the owner is most likely to be looking for is the one they
    // logged most recently.
    const sorted = [...list].sort((a, b) => (b.worked_on ?? "").localeCompare(a.worked_on ?? ""));
    let hours = 0;
    let amount = 0;
    let withoutRate = 0;
    for (const e of sorted) {
      hours += Number(e.hours);
      const value = entryValue(e);
      if (value === null) withoutRate += 1;
      else amount += value;
    }
    groups.push({
      clientId,
      entries: sorted,
      hours: round2(hours),
      amountExBtw: round2(amount),
      withoutRate,
    });
  }

  // Biggest amount first — that is the invoice worth sending today. A tie falls back to hours, so
  // a group of unpriced work does not sort randomly.
  return groups.sort((a, b) => (b.amountExBtw - a.amountExBtw) || (b.hours - a.hours));
}

/**
 * One invoice line, in the shape /api/invoice/draft ACCEPTS.
 *
 * Checked against that route, not guessed: validateDraftLines() refuses any line whose `btw_rate`
 * is not one of 0/9/21 (`${row.btw_rate} is geen bestaand BTW-tarief`), and the route reads
 * `description` and `unit` back off the ORIGINAL body rather than off the validated copy. So a
 * line built here without a rate would not produce a cheaper invoice — it would produce no invoice
 * at all, and the owner would be told their hours "kloppen niet".
 *
 * `line_total` is deliberately absent: the route computes it with lineNetEx() so line discounts go
 * through exactly one place ([REGEL-KORTING]). Sending our own would be a second answer to the
 * question that module exists to answer once.
 */
export interface InvoiceLineDraft {
  description: string;
  quantity: number;
  unit_price: number;
  /** 0, 9 or 21 — the only rates a Dutch invoice may carry (draft-totals.ALLOWED_BTW_RATES). */
  btw_rate: number;
  /** 'uur' — a known unit, so the e-factuur carries UN/ECE code HUR instead of C62 ("piece"). */
  unit: string;
}

/**
 * The rate an hour carries when the owner has not said otherwise.
 *
 * 21 is what the invoice editor seeds a new line with, and matching it is the point: the owner who
 * bills their hours should see the same rate they would have typed. Never 0 — that reads as
 * "vrijgesteld" on the invoice and silently takes real turnover out of the aangifte.
 */
export const DEFAULT_HOUR_BTW_RATE = 21;

/** The unit an hour is billed in. 'uur' is a known unit in units.ts, so it survives to the UBL. */
export const HOUR_UNIT = "uur";

/**
 * Turn billable hours into invoice lines — one line per entry, not one lump.
 *
 * A customer who receives "40 uur — € 3.400" cannot check it against anything. A customer who
 * receives the eleven days that make it up can, and the entries were recorded per day precisely so
 * that is possible. This is the same argument the rest of this codebase makes about a number
 * needing its evidence beside it; here the evidence costs nothing, because it is already written
 * down.
 *
 * Entries WITHOUT a rate are refused rather than billed at zero. Zero is a real rate the owner may
 * choose (goodwill, a redone hour), and a line of € 0,00 that the owner never intended is money
 * they will not get back once the invoice is sent.
 */
export function linesFromEntries(
  entries: readonly TimeEntry[],
  // [TARIEF-STRIKT] `unknown`, not `number`, and that widening is the fix. The route calls this as
  // linesFromEntries(gevonden, Number(body.uren_btw_rate)) — and Number(null) is 0, a legal rate,
  // so a request carrying `uren_btw_rate: null` billed a whole hours invoice at 0% while the type
  // said the rate had already been validated. Taking the raw value means the check below is the
  // one that decides, which is what the comment under it always claimed.
  btwRate: unknown = DEFAULT_HOUR_BTW_RATE,
): {
  lines: InvoiceLineDraft[];
  /** Entries left out because they carry no rate. Named, never silently dropped. */
  skippedWithoutRate: TimeEntry[];
  /** The ids that ARE on these lines — what the caller must stamp with the invoice. */
  billedIds: string[];
} {
  // A rate the route would refuse is not silently replaced by a cheaper one: it falls back to the
  // app's default, which is the same number the editor would have put there. isValidBtwRate is
  // what decides — `ALLOWED_LINE_BTW_RATES.includes(Number(btwRate))` accepted null, "", " ", []
  // and false as 0%, which is the one outcome DEFAULT_HOUR_BTW_RATE's own comment forbids: "Never
  // 0 — that reads as vrijgesteld on the invoice and silently takes real turnover out of the
  // aangifte."
  const rate = isValidBtwRate(btwRate) ? Number(btwRate) : DEFAULT_HOUR_BTW_RATE;

  const lines: InvoiceLineDraft[] = [];
  const skipped: TimeEntry[] = [];
  const billedIds: string[] = [];
  // Oldest first on the invoice: a customer reads the period from the top down, the way a
  // statement is written.
  const ordered = [...entries]
    .filter(isBillable)
    .sort((a, b) => (a.worked_on ?? "").localeCompare(b.worked_on ?? ""));

  for (const e of ordered) {
    const value = entryValue(e);
    if (value === null) {
      skipped.push(e);
      continue;
    }
    lines.push({
      description: lineDescription(e),
      quantity: round2(Number(e.hours)),
      unit_price: round2(Number(e.hourly_rate)),
      btw_rate: rate,
      unit: HOUR_UNIT,
    });
    billedIds.push(e.id);
  }
  return { lines, skippedWithoutRate: skipped, billedIds };
}

/**
 * The sentence on the invoice line: the date, then the work.
 *
 * Dutch on purpose — this is read by the owner's CUSTOMER, on a document that is never translated
 * (AGENTS.md). dd-mm is how every Dutch invoice writes a work date, and the year is left off
 * because the invoice already carries its period.
 *
 * An empty result is impossible by construction: the database refuses a blank description
 * (CHECK btrim(description) <> ''), and art. 35a Wet OB is why — a line without a description is
 * an amount without a reason, and validateDraftLines refuses it too.
 */
export function lineDescription(entry: Pick<TimeEntry, "worked_on" | "description">): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(entry.worked_on ?? ""));
  const text = String(entry.description ?? "").trim();
  if (!m) return text;
  return `${m[3]}-${m[2]} \u00b7 ${text}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// [UREN-EENMALIG] The two checks that stand between "billed once" and "billed twice or never".
// Pure on purpose: they are the safety property of this feature, and a safety property that can
// only be exercised by calling a route is a safety property nobody tests.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * How many hours may go on one invoice.
 *
 * 200 is not a round number picked for comfort — it is validateDraftLines' own ceiling on lines,
 * and one entry becomes one line. A larger number here would be refused downstream with a message
 * about lines, on a screen that is talking about hours.
 */
export const MAX_ENTRIES_PER_INVOICE = 200;

/** Why a set of ids was refused. A code, not a sentence: the screen owns the words. */
export type TimeEntryIdsRefusal = "not_a_list" | "empty" | "too_many" | "not_an_id";

/**
 * Read the ids of the hours to bill out of a request.
 *
 * Duplicates are collapsed rather than refused: a browser that sends the same hour twice means it
 * once, and the alternative — an error the owner cannot act on — is worse than the obvious reading.
 * Anything that is not an id at all IS refused, because a request that cannot say which hours it
 * means must not be answered by guessing.
 */
export function parseTimeEntryIds(
  raw: unknown,
): { ok: true; ids: string[] } | { ok: false; code: TimeEntryIdsRefusal } {
  if (!Array.isArray(raw)) return { ok: false, code: "not_a_list" };
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") return { ok: false, code: "not_an_id" };
    const id = v.trim();
    // The shape the database uses. A non-uuid would come back as a Postgres error deep inside the
    // stamping step, where the only honest thing left to do is undo an invoice that was already
    // created — so it is caught here, before anything exists to roll back.
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
      return { ok: false, code: "not_an_id" };
    }
    seen.add(id.toLowerCase());
  }
  if (seen.size === 0) return { ok: false, code: "empty" };
  if (seen.size > MAX_ENTRIES_PER_INVOICE) return { ok: false, code: "too_many" };
  return { ok: true, ids: [...seen] };
}

/**
 * Did every hour that went ON the invoice actually get marked as billed?
 *
 * This is the whole invariant, and it is a COUNT question rather than a trust question. The stamp
 * runs as `UPDATE … WHERE id = ANY(ids) AND user_id = owner AND invoice_id IS NULL`, so an hour
 * comes back only if it was really this owner's and really still unbilled. An id that does not come
 * back was somebody else's, already on another invoice, or deleted between reading and writing —
 * and in every one of those cases the invoice now contains a line for work that is still sitting in
 * the billable pool, waiting to be billed a second time.
 *
 * There is no safe way to continue from that, which is why the caller undoes the invoice. Warning
 * and carrying on would leave the owner with a document whose lines are not backed by the hours
 * they name, and they would find out from a customer.
 */
export function verifyStamped(
  billedIds: readonly string[],
  stampedIds: readonly string[],
): { ok: true } | { ok: false; missing: string[] } {
  const stamped = new Set(stampedIds.map((s) => s.toLowerCase()));
  const missing = billedIds.filter((id) => !stamped.has(id.toLowerCase()));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// [UREN] What may be stored. The database CHECKs are the last reader (see tests/sql/); this is the
// first one, and it exists so the owner gets a sentence they can act on instead of a constraint
// name they cannot.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The most hours one row may claim. The database says the same thing; see the migration. */
export const MAX_HOURS_PER_ENTRY = 24;

/** The longest a description may be. Long enough for a real sentence, short enough for a line. */
export const MAX_DESCRIPTION_LENGTH = 500;

/** Why an entry was refused. A code — the screen owns the words. */
export type TimeEntryRefusal =
  | "no_date" | "bad_date" | "no_description" | "description_too_long"
  | "no_hours" | "hours_too_many" | "bad_rate";

export interface TimeEntryInput {
  client_id: string | null;
  worked_on: string;
  description: string;
  hours: number;
  hourly_rate: number | null;
}

/**
 * Read one recorded stretch of work out of a request.
 *
 * Every refusal names ONE field, because a form that says "the hours are wrong" without saying
 * which field is a form the owner retries at random.
 *
 * [CENT] Hours are rounded to two decimals here, not at the database. numeric(6,2) would round
 * 1,005 to 1,01 silently on the way in, and the owner would see a number they did not type — the
 * same class of surprise as a total that disagrees with its own lines.
 */
export function normalizeTimeEntryInput(
  raw: unknown,
): { ok: true; entry: TimeEntryInput } | { ok: false; code: TimeEntryRefusal } {
  const row = (raw ?? {}) as Record<string, unknown>;

  const worked = typeof row.worked_on === "string" ? row.worked_on.trim() : "";
  if (!worked) return { ok: false, code: "no_date" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(worked)) return { ok: false, code: "bad_date" };
  // A date the calendar does not have — 2026-02-30 passes the shape and is not a day anyone worked.
  const parsed = new Date(`${worked}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== worked) {
    return { ok: false, code: "bad_date" };
  }

  const description = typeof row.description === "string" ? row.description.trim() : "";
  if (!description) return { ok: false, code: "no_description" };
  if (description.length > MAX_DESCRIPTION_LENGTH) return { ok: false, code: "description_too_long" };

  const hours = round2(Number(row.hours));
  if (!Number.isFinite(Number(row.hours)) || hours <= 0) return { ok: false, code: "no_hours" };
  if (hours > MAX_HOURS_PER_ENTRY) return { ok: false, code: "hours_too_many" };

  // A rate is OPTIONAL and an empty field is not a typo — the owner may write down work before the
  // price is agreed. But a field that was FILLED IN with something unusable is a question, never a
  // silent null: a null here means "no rate yet", and the hour then waits instead of being billed.
  let rate: number | null = null;
  const rawRate = row.hourly_rate;
  const rateGiven = rawRate !== null && rawRate !== undefined && String(rawRate).trim() !== "";
  if (rateGiven) {
    const r = round2(Number(rawRate));
    if (!Number.isFinite(Number(rawRate)) || r < 0) return { ok: false, code: "bad_rate" };
    rate = r;
  }

  const clientId = typeof row.client_id === "string" && row.client_id.trim() ? row.client_id.trim() : null;

  return { ok: true, entry: { client_id: clientId, worked_on: worked, description, hours, hourly_rate: rate } };
}
