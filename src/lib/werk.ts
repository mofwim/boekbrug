// src/lib/werk.ts
// [WERK] The trade's own work: one primitive, the trade's noun on it. Pure, no I/O.
// Run: npx tsx --test src/lib/werk.test.ts
//
// ── WHY THIS EXISTS ──
//
// The owner's decision: the accounting is not the product. A mechanic opens the app for his
// workshop, a courier for his ritten, a builder for his klussen, a cleaner for her opdrachten.
// The money is what that work produces. So the first screen for a trade owner is his WORK, in
// his own word, and this module is the one place that knows the word, the states a piece of work
// passes through in that trade, the fields the trade writes on it, and the lines it charges.
//
// ── MEASURED, NOT INVENTED ──
//
// The shapes below follow the simple tools these trades already use (docs/MARKT.md, researched
// 8 September 2026): a werkorder is opened on a KENTEKEN, carries kilometerstand, klacht and
// monteur, moves Gepland → In behandeling → Wacht → Gereed → Gefactureerd, and charges arbeid
// (uren × uurtarief) and onderdelen (aantal × prijs). A rit is an order for an opdrachtgever with
// a laadadres and losadres, moves Gepland → Onderweg → Afgeleverd → Gefactureerd, and charges a
// ritprijs or km × tarief plus wachttijd. A werkbon (klus) has a werkadres and charges uren,
// materiaal and meerwerk as separate lines. A schoonmaak opdracht has a locatie and, in this first
// version, is one-off: the recurring contract with its beurten is the next batch.
//
// One table, one screen, one API (work_items.sql, /dashboard/werk, /api/werk). What differs per
// trade is data here — a list a person can read end to end and check — never a second component.
//
// ── THE RULES ──
//
// · A trade without a work layer gets nothing new. hasWorkLayer() is false for a kapper; the app
//   for him is exactly what it was. The layer is added, never imposed.
// · The status set is one closed list; the trade chooses which of them it uses and what it calls
//   them. A garage waits for parts; a courier never does. The union is the CHECK in the table.
// · Money on the work is what it will CHARGE (lines), never what it cost. Costs are the purchase
//   invoices attached to it, hours are the time entries attached to it; the margin here is
//   arithmetic on what the caller fetched from those tables.
// · Validation refuses what it cannot read: a kilometre count that is not a number is rejected,
//   never written as text; a line without a description or with a btw rate that does not exist
//   in the Netherlands never reaches the row.

import { round2 } from "./invoice-totals";
import { parseVak } from "./vak-profile";
import { ALLOWED_BTW_RATES } from "./draft-totals";

export type WorkStatus = "open" | "bezig" | "wacht_klant" | "wacht_onderdeel" | "klaar" | "gefactureerd" | "geannuleerd";

export const WORK_STATUSES: readonly WorkStatus[] = [
  "open", "bezig", "wacht_klant", "wacht_onderdeel", "klaar", "gefactureerd", "geannuleerd",
];

/** The states an owner can move a piece of work INTO by hand. Invoicing is a door, not a tap. */
export const HAND_STATUSES: readonly WorkStatus[] = ["open", "bezig", "wacht_klant", "wacht_onderdeel", "klaar", "geannuleerd"];

export type FieldType = "text" | "number" | "date";

export interface WorkField {
  key: string;
  type: FieldType;
  /** Message key for the label (werk.veld.*). */
  labelKey: string;
  /** Shown on the card next to the title. */
  onCard?: boolean;
  /** Refused when missing — the one or two things the trade's form insists on. */
  required?: boolean;
}

/** A kind of line the trade charges: its label and the unit it is counted in. */
export interface LineKind {
  kind: string;
  labelKey: string;
  unit: "uur" | "stuk" | "km" | "post" | "dag";
}

/** The work skin of one trade: its noun, its statuses, its fields, its line kinds. Keys, not text — [TAAL]. */
export interface WorkSkin {
  /** The skin id; several trades can share one (every bouw trade is a 'klus'). */
  skin: "werkorder" | "rit" | "klus" | "opdracht";
  nounKey: string;
  pluralKey: string;
  statuses: readonly WorkStatus[];
  /** The trade's own word for each status it uses — literal keys, one per status. */
  statusLabels: Readonly<Partial<Record<WorkStatus, string>>>;
  fields: readonly WorkField[];
  lineKinds: readonly LineKind[];
  /** Does this skin open on a kenteken? */
  vehicle: boolean;
}

const WERKORDER: WorkSkin = {
  skin: "werkorder",
  nounKey: "werk.noun.werkorder",
  pluralKey: "werk.noun.werkorders",
  statuses: ["open", "bezig", "wacht_onderdeel", "wacht_klant", "klaar", "gefactureerd", "geannuleerd"],
  statusLabels: {
    open: "werk.status.werkorder.open", bezig: "werk.status.werkorder.bezig",
    wacht_onderdeel: "werk.status.werkorder.wacht_onderdeel", wacht_klant: "werk.status.werkorder.wacht_klant",
    klaar: "werk.status.werkorder.klaar", gefactureerd: "werk.status.werkorder.gefactureerd", geannuleerd: "werk.status.werkorder.geannuleerd",
  },
  fields: [
    { key: "km_stand", type: "number", labelKey: "werk.veld.kmStand", onCard: true },
    { key: "klacht", type: "text", labelKey: "werk.veld.klacht" },
    { key: "monteur", type: "text", labelKey: "werk.veld.monteur" },
  ],
  lineKinds: [
    { kind: "arbeid", labelKey: "werk.regel.arbeid", unit: "uur" },
    { kind: "onderdeel", labelKey: "werk.regel.onderdeel", unit: "stuk" },
  ],
  vehicle: true,
};

const RIT: WorkSkin = {
  skin: "rit",
  nounKey: "werk.noun.rit",
  pluralKey: "werk.noun.ritten",
  statuses: ["open", "bezig", "klaar", "gefactureerd", "geannuleerd"],
  statusLabels: {
    open: "werk.status.rit.open", bezig: "werk.status.rit.bezig", klaar: "werk.status.rit.klaar",
    gefactureerd: "werk.status.rit.gefactureerd", geannuleerd: "werk.status.rit.geannuleerd",
  },
  fields: [
    { key: "van", type: "text", labelKey: "werk.veld.laadadres", onCard: true, required: true },
    { key: "naar", type: "text", labelKey: "werk.veld.losadres", onCard: true, required: true },
    { key: "referentie", type: "text", labelKey: "werk.veld.referentie" },
    { key: "colli", type: "number", labelKey: "werk.veld.colli" },
    { key: "gewicht_kg", type: "number", labelKey: "werk.veld.gewicht" },
    { key: "km", type: "number", labelKey: "werk.veld.km", onCard: true },
    { key: "chauffeur", type: "text", labelKey: "werk.veld.chauffeur" },
  ],
  lineKinds: [
    { kind: "ritprijs", labelKey: "werk.regel.ritprijs", unit: "post" },
    { kind: "km", labelKey: "werk.regel.km", unit: "km" },
    { kind: "uur", labelKey: "werk.regel.uur", unit: "uur" },
    { kind: "wachttijd", labelKey: "werk.regel.wachttijd", unit: "uur" },
    { kind: "extra", labelKey: "werk.regel.extra", unit: "post" },
  ],
  vehicle: true,
};

const KLUS: WorkSkin = {
  skin: "klus",
  nounKey: "werk.noun.klus",
  pluralKey: "werk.noun.klussen",
  statuses: ["open", "bezig", "wacht_klant", "klaar", "gefactureerd", "geannuleerd"],
  statusLabels: {
    open: "werk.status.klus.open", bezig: "werk.status.klus.bezig", wacht_klant: "werk.status.klus.wacht_klant",
    klaar: "werk.status.klus.klaar", gefactureerd: "werk.status.klus.gefactureerd", geannuleerd: "werk.status.klus.geannuleerd",
  },
  fields: [
    { key: "adres", type: "text", labelKey: "werk.veld.werkadres", onCard: true, required: true },
  ],
  lineKinds: [
    { kind: "arbeid", labelKey: "werk.regel.arbeid", unit: "uur" },
    { kind: "materiaal", labelKey: "werk.regel.materiaal", unit: "stuk" },
    { kind: "meerwerk", labelKey: "werk.regel.meerwerk", unit: "post" },
  ],
  vehicle: false,
};

const OPDRACHT: WorkSkin = {
  skin: "opdracht",
  nounKey: "werk.noun.opdracht",
  pluralKey: "werk.noun.opdrachten",
  statuses: ["open", "bezig", "klaar", "gefactureerd", "geannuleerd"],
  statusLabels: {
    open: "werk.status.opdracht.open", bezig: "werk.status.opdracht.bezig", klaar: "werk.status.opdracht.klaar",
    gefactureerd: "werk.status.opdracht.gefactureerd", geannuleerd: "werk.status.opdracht.geannuleerd",
  },
  fields: [
    { key: "locatie", type: "text", labelKey: "werk.veld.locatie", onCard: true, required: true },
    { key: "afgesproken_uren", type: "number", labelKey: "werk.veld.afgesprokenUren", onCard: true },
    { key: "medewerker", type: "text", labelKey: "werk.veld.medewerker" },
  ],
  lineKinds: [
    { kind: "vast", labelKey: "werk.regel.vast", unit: "post" },
    { kind: "arbeid", labelKey: "werk.regel.arbeid", unit: "uur" },
    { kind: "extra", labelKey: "werk.regel.extra", unit: "post" },
  ],
  vehicle: false,
};

/**
 * Trade slug (VAKKEN) → skin. Every bouw trade shares the klus skin: a loodgieter, an elektricien
 * and a schilder all do klussen at an address. Trades not listed have no work layer and the app
 * stays as it is for them.
 */
const SKIN_BY_VAK: Readonly<Record<string, WorkSkin>> = {
  automonteur: WERKORDER,
  transport: RIT,
  "bouw-klus": KLUS,
  loodgieter: KLUS,
  elektricien: KLUS,
  schilder: KLUS,
  hovenier: KLUS,
  schoonmaak: OPDRACHT,
};

/** Does this owner get the work layer? Unknown or unlisted trade → no. */
export function hasWorkLayer(vak: string | null | undefined): boolean {
  const slug = parseVak(vak);
  return slug !== null && slug in SKIN_BY_VAK;
}

/** The skin for a trade, or null when the trade has no work layer. */
export function workSkin(vak: string | null | undefined): WorkSkin | null {
  const slug = parseVak(vak);
  return slug ? SKIN_BY_VAK[slug] ?? null : null;
}

export function isWorkStatus(v: unknown): v is WorkStatus {
  return typeof v === "string" && (WORK_STATUSES as readonly string[]).includes(v);
}

/** The generic words, for a status a skin does not use itself. Literal keys — [TAAL] reads them. */
const GENERIC_STATUS_KEYS: Readonly<Record<WorkStatus, string>> = {
  open: "werk.status.open", bezig: "werk.status.bezig", wacht_klant: "werk.status.wacht_klant",
  wacht_onderdeel: "werk.status.wacht_onderdeel", klaar: "werk.status.klaar",
  gefactureerd: "werk.status.gefactureerd", geannuleerd: "werk.status.geannuleerd",
};

/** Message key for a status, in the trade's own words; a status the skin does not use falls back to the generic word. */
export function statusKey(skin: WorkSkin, status: WorkStatus): string {
  return skin.statusLabels[status] ?? GENERIC_STATUS_KEYS[status];
}

// ── Fields ────────────────────────────────────────────────────────────────────────────────────

export type FieldValues = Record<string, string | number>;

export type FieldsVerdict =
  | { ok: true; fields: FieldValues }
  | { ok: false; key: string; reason: "required" | "not_a_number" | "negative" | "not_a_date" | "too_long" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_MAX = 300;

/**
 * Read the trade fields out of an untrusted body. Unknown keys are dropped, empty values are
 * dropped, a required field that is empty is refused, and a value that is not what its type says
 * is REFUSED rather than stored as text — a "km" of "ongeveer 40" would otherwise sit in a number
 * field until a sum divides by it.
 */
export function readFields(skin: WorkSkin, body: unknown): FieldsVerdict {
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: FieldValues = {};
  for (const f of skin.fields) {
    const raw = src[f.key];
    const empty = raw === undefined || raw === null || String(raw).trim() === "";
    if (empty) {
      if (f.required) return { ok: false, key: f.key, reason: "required" };
      continue;
    }
    if (f.type === "text") {
      const s = String(raw).trim();
      if (s.length > TEXT_MAX) return { ok: false, key: f.key, reason: "too_long" };
      out[f.key] = s;
      continue;
    }
    if (f.type === "date") {
      const s = String(raw).trim();
      if (!ISO.test(s)) return { ok: false, key: f.key, reason: "not_a_date" };
      out[f.key] = s;
      continue;
    }
    // number — accept "12,5" as a Dutch owner types it.
    const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
    if (!Number.isFinite(n)) return { ok: false, key: f.key, reason: "not_a_number" };
    if (n < 0) return { ok: false, key: f.key, reason: "negative" };
    out[f.key] = n;
  }
  return { ok: true, fields: out };
}

// ── Lines ─────────────────────────────────────────────────────────────────────────────────────

/** One thing the work charges. The same shape the invoice draft door validates. */
export interface WorkLine {
  kind: string;
  description: string;
  quantity: number;
  unit: string;
  /** Ex btw. */
  unit_price: number;
  btw_rate: number;
}

export type LinesVerdict =
  | { ok: true; lines: WorkLine[] }
  | { ok: false; index: number; reason: "not_a_list" | "too_many" | "bad_kind" | "no_description" | "bad_quantity" | "bad_price" | "bad_btw" };

export const LINES_MAX = 50;
export const DEFAULT_LINE_BTW = 21;

function readNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Read the lines out of an untrusted body, in the skin's own kinds. An empty list is fine. */
export function readLines(skin: WorkSkin, body: unknown): LinesVerdict {
  if (body === undefined || body === null) return { ok: true, lines: [] };
  if (!Array.isArray(body)) return { ok: false, index: -1, reason: "not_a_list" };
  if (body.length > LINES_MAX) return { ok: false, index: -1, reason: "too_many" };
  const out: WorkLine[] = [];
  for (let i = 0; i < body.length; i++) {
    const r = (body[i] ?? {}) as Record<string, unknown>;
    const kind = skin.lineKinds.find((k) => k.kind === r.kind);
    if (!kind) return { ok: false, index: i, reason: "bad_kind" };
    const description = typeof r.description === "string" ? r.description.trim().slice(0, TEXT_MAX) : "";
    if (!description) return { ok: false, index: i, reason: "no_description" };
    const quantity = readNumber(r.quantity);
    if (quantity === null || quantity <= 0) return { ok: false, index: i, reason: "bad_quantity" };
    const price = readNumber(r.unit_price);
    if (price === null || price < 0) return { ok: false, index: i, reason: "bad_price" };
    const btw = r.btw_rate === undefined || r.btw_rate === null || r.btw_rate === "" ? DEFAULT_LINE_BTW : readNumber(r.btw_rate);
    if (btw === null || !ALLOWED_BTW_RATES.includes(btw)) return { ok: false, index: i, reason: "bad_btw" };
    out.push({ kind: kind.kind, description, quantity, unit: kind.unit, unit_price: round2(price), btw_rate: btw });
  }
  return { ok: true, lines: out };
}

/** What the lines add up to, ex btw. */
export function linesTotalEx(lines: readonly WorkLine[]): number {
  return round2(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0));
}

/** Read stored lines back (jsonb) without trusting them: anything malformed is dropped. */
export function storedLines(raw: unknown): WorkLine[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkLine[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object") continue;
    const q = readNumber(r.quantity);
    const p = readNumber(r.unit_price);
    const b = readNumber(r.btw_rate);
    if (typeof r.description !== "string" || q === null || p === null || b === null) continue;
    out.push({ kind: String(r.kind ?? ""), description: r.description, quantity: q, unit: String(r.unit ?? "stuk"), unit_price: p, btw_rate: b });
  }
  return out;
}

// ── Margin ────────────────────────────────────────────────────────────────────────────────────

export interface WorkMoney {
  /** Ex btw: the sales invoice this work became, else what its lines add up to; null when neither. */
  revenueExBtw: number | null;
  /** Ex btw, summed over the purchase invoices attached to this work. */
  costsExBtw: number;
}

export interface WorkMargin {
  revenue: number | null;
  costs: number;
  margin: number | null;
  /** 0..1, null without revenue or with revenue 0. */
  share: number | null;
}

/**
 * Margin = revenue − attached purchase costs. Hours are NOT subtracted: for a one-person trade
 * the hour rate is the revenue, not a cost, and subtracting it would tell a solo mechanic he
 * makes nothing. Hours are shown beside the margin, never inside it.
 */
export function workMargin(m: WorkMoney): WorkMargin {
  const costs = round2(m.costsExBtw);
  if (m.revenueExBtw === null) return { revenue: null, costs, margin: null, share: null };
  const revenue = round2(m.revenueExBtw);
  const margin = round2(revenue - costs);
  return { revenue, costs, margin, share: revenue > 0 ? round2(margin / revenue) : null };
}

// ── Counts for Vandaag ────────────────────────────────────────────────────────────────────────

export interface WorkCounts {
  open: number;
  bezig: number;
  wacht: number;
  klaar: number;
}

/** What the trade owner wants to hear first: how many are ready to invoice, how many wait. */
export function workCounts(rows: ReadonlyArray<{ status: string }>): WorkCounts {
  const c: WorkCounts = { open: 0, bezig: 0, wacht: 0, klaar: 0 };
  for (const r of rows) {
    if (r.status === "open") c.open += 1;
    else if (r.status === "bezig") c.bezig += 1;
    else if (r.status === "wacht_klant" || r.status === "wacht_onderdeel") c.wacht += 1;
    else if (r.status === "klaar") c.klaar += 1;
  }
  return c;
}

/** May this row be invoiced from the work screen? Only finished work, once. */
export function canInvoice(row: { status: string; invoice_id: string | null }): boolean {
  return row.status === "klaar" && !row.invoice_id;
}

/** May this row be deleted? Never once money hangs off it. */
export function canDelete(row: { invoice_id: string | null; attachedCosts: number; attachedHours: number }): boolean {
  return !row.invoice_id && row.attachedCosts === 0 && row.attachedHours === 0;
}
