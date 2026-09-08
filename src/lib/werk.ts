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
// materiaal and meerwerk as separate lines. A schoonmaak opdracht has a locatie and either happens
// once or REPEATS: the small planners (CleanPlanner, Schoonsoft, Buttons for Cleaners) all make
// the opdracht once, let it repeat, tick a beurt off when it is done, and turn the done beurten
// into one invoice — per beurt or per period. A fietsenmaker's reparatiebon (CycleSoftware) opens
// on the bike and its framenummer, carries the klacht, and ends on "klaar voor ophalen". A
// courier's opdrachtgever expects one verzamelfactuur for the week's ritten (EasyTrans, NextUp),
// not one invoice per rit.
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
  /** The btw rate a new line of this kind starts on; editable, and refused if it is not Dutch. */
  btw?: number;
}

/** The work skin of one trade: its noun, its statuses, its fields, its line kinds. Keys, not text — [TAAL]. */
export interface WorkSkin {
  /** The skin id; several trades can share one (every bouw trade is a 'klus'). */
  skin: "werkorder" | "rit" | "klus" | "opdracht" | "reparatie" | "les";
  nounKey: string;
  pluralKey: string;
  statuses: readonly WorkStatus[];
  /** The trade's own word for each status it uses — literal keys, one per status. */
  statusLabels: Readonly<Partial<Record<WorkStatus, string>>>;
  fields: readonly WorkField[];
  lineKinds: readonly LineKind[];
  /** Does this skin open on a kenteken? */
  vehicle: boolean;
  /**
   * May a piece of this work REPEAT — a weekly schoonmaak, a fortnightly garden — with beurten
   * ticked off as they happen and invoiced together? False for work that happens once.
   */
  recurring: boolean;
  /** The trade's own words for a beurt, when "beurt" is not its word (a rijschool gives lessen). Literal keys. */
  visitKeys?: { list: string; done: string; invoice: string; open: string };
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
    // The price agreed at the counter, ex btw — what "boven begroting" is measured against.
    { key: "begroot", type: "number", labelKey: "werk.veld.begroot" },
    { key: "klacht", type: "text", labelKey: "werk.veld.klacht" },
    { key: "monteur", type: "text", labelKey: "werk.veld.monteur" },
    // [WERK-3] The customer's phone: "uw auto staat klaar" is one tap, not a lookup.
    { key: "telefoon", type: "text", labelKey: "werk.veld.telefoon" },
  ],
  lineKinds: [
    { kind: "arbeid", labelKey: "werk.regel.arbeid", unit: "uur" },
    { kind: "onderdeel", labelKey: "werk.regel.onderdeel", unit: "stuk" },
  ],
  vehicle: true,
  recurring: false,
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
    // [WERK-3] The time window the opdrachtgever gave; the card then reads like a dispatch line.
    { key: "laadtijd", type: "text", labelKey: "werk.veld.laadtijd", onCard: true },
    { key: "lostijd", type: "text", labelKey: "werk.veld.lostijd", onCard: true },
    { key: "referentie", type: "text", labelKey: "werk.veld.referentie" },
    { key: "colli", type: "number", labelKey: "werk.veld.colli" },
    { key: "gewicht_kg", type: "number", labelKey: "werk.veld.gewicht" },
    { key: "km", type: "number", labelKey: "werk.veld.km", onCard: true },
    { key: "chauffeur", type: "text", labelKey: "werk.veld.chauffeur" },
    // Who took delivery — the courier's proof, written at the door.
    { key: "ontvanger", type: "text", labelKey: "werk.veld.ontvanger" },
  ],
  lineKinds: [
    { kind: "ritprijs", labelKey: "werk.regel.ritprijs", unit: "post" },
    { kind: "km", labelKey: "werk.regel.km", unit: "km" },
    { kind: "uur", labelKey: "werk.regel.uur", unit: "uur" },
    { kind: "wachttijd", labelKey: "werk.regel.wachttijd", unit: "uur" },
    // Personenvervoer is 9% where goederenvervoer is 21% (vak-sjablonen.ts): the taxi line
    // starts on its own rate so nobody edits it by hand on every rit.
    { kind: "personen", labelKey: "werk.regel.personen", unit: "post", btw: 9 },
    { kind: "extra", labelKey: "werk.regel.extra", unit: "post" },
  ],
  vehicle: true,
  // The same route every week for the same opdrachtgever: EasyTrans calls it a periodic order.
  recurring: true,
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
    // The offerte amount ex btw — the klus is measured against it while it runs, not after.
    { key: "begroot", type: "number", labelKey: "werk.veld.begroot" },
  ],
  lineKinds: [
    { kind: "arbeid", labelKey: "werk.regel.arbeid", unit: "uur" },
    { kind: "materiaal", labelKey: "werk.regel.materiaal", unit: "stuk" },
    { kind: "meerwerk", labelKey: "werk.regel.meerwerk", unit: "post" },
    { kind: "voorrijkosten", labelKey: "werk.regel.voorrijkosten", unit: "post" },
  ],
  vehicle: false,
  recurring: false,
};

/** A hovenier's klus is the builder's klus, except that garden maintenance comes back every fortnight and green waste is a line. */
const TUIN: WorkSkin = {
  ...KLUS,
  // The hovenier's onderhoudsabonnement: the same contract fields as a schoonmaak opdracht.
  fields: [...KLUS.fields, { key: "afgesproken_uren", type: "number", labelKey: "werk.veld.afgesprokenUren" }, { key: "maandbedrag", type: "number", labelKey: "werk.veld.maandbedrag" }, { key: "einddatum", type: "date", labelKey: "werk.veld.einddatum", onCard: true }],
  lineKinds: [...KLUS.lineKinds, { kind: "afvoer", labelKey: "werk.regel.afvoer", unit: "post" }],
  recurring: true,
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
    // [CONTRACT] A fixed amount per period makes this row a contract billed per maand instead of
    // per beurt; the end date is what the renewal signal counts down to.
    { key: "maandbedrag", type: "number", labelKey: "werk.veld.maandbedrag" },
    { key: "einddatum", type: "date", labelKey: "werk.veld.einddatum", onCard: true },
  ],
  lineKinds: [
    { kind: "vast", labelKey: "werk.regel.vast", unit: "post" },
    { kind: "arbeid", labelKey: "werk.regel.arbeid", unit: "uur" },
    { kind: "extra", labelKey: "werk.regel.extra", unit: "post" },
  ],
  vehicle: false,
  recurring: true,
};

/**
 * The reparatiebon of a fietsenmaker. No kenteken — a bike is named by what it is and, when the
 * shop writes it down, its framenummer. Repair labour is 9%, a part sold is 21%
 * (vak-sjablonen.ts says the same), so the two kinds start on their own rate.
 */
const REPARATIE: WorkSkin = {
  skin: "reparatie",
  nounKey: "werk.noun.reparatie",
  pluralKey: "werk.noun.reparaties",
  statuses: ["open", "bezig", "wacht_onderdeel", "wacht_klant", "klaar", "gefactureerd", "geannuleerd"],
  statusLabels: {
    open: "werk.status.reparatie.open", bezig: "werk.status.reparatie.bezig",
    wacht_onderdeel: "werk.status.reparatie.wacht_onderdeel", wacht_klant: "werk.status.reparatie.wacht_klant",
    klaar: "werk.status.reparatie.klaar", gefactureerd: "werk.status.reparatie.gefactureerd", geannuleerd: "werk.status.reparatie.geannuleerd",
  },
  fields: [
    { key: "fiets", type: "text", labelKey: "werk.veld.fiets", onCard: true, required: true },
    { key: "framenummer", type: "text", labelKey: "werk.veld.framenummer" },
    { key: "klacht", type: "text", labelKey: "werk.veld.klacht" },
    { key: "telefoon", type: "text", labelKey: "werk.veld.telefoon" },
  ],
  lineKinds: [
    { kind: "arbeid", labelKey: "werk.regel.arbeid", unit: "uur", btw: 9 },
    { kind: "onderdeel", labelKey: "werk.regel.onderdeel", unit: "stuk", btw: 21 },
  ],
  vehicle: false,
  recurring: false,
};

/**
 * The opdracht of a consultant or any general dienstverlener: a reference the client gave, the
 * hours agreed, and the hours attached from the uren screen become the invoice. No location — the
 * work is wherever the laptop is.
 */
const DIENST: WorkSkin = {
  skin: "opdracht",
  nounKey: "werk.noun.opdracht",
  pluralKey: "werk.noun.opdrachten",
  statuses: ["open", "bezig", "wacht_klant", "klaar", "gefactureerd", "geannuleerd"],
  statusLabels: {
    open: "werk.status.opdracht.open", bezig: "werk.status.opdracht.bezig", wacht_klant: "werk.status.opdracht.wacht_klant",
    klaar: "werk.status.opdracht.klaar", gefactureerd: "werk.status.opdracht.gefactureerd", geannuleerd: "werk.status.opdracht.geannuleerd",
  },
  fields: [
    { key: "referentie", type: "text", labelKey: "werk.veld.referentie", onCard: true },
    { key: "afgesproken_uren", type: "number", labelKey: "werk.veld.afgesprokenUren", onCard: true },
  ],
  lineKinds: [
    { kind: "vast", labelKey: "werk.regel.vast", unit: "post" },
    { kind: "arbeid", labelKey: "werk.regel.arbeid", unit: "uur" },
    { kind: "reiskosten", labelKey: "werk.regel.reiskosten", unit: "km" },
    { kind: "extra", labelKey: "werk.regel.extra", unit: "post" },
  ],
  vehicle: false,
  recurring: true,
};

/**
 * [RIJSCHOOL] One leerling in training is the work; every les is a beurt on it, the lespakket and
 * the examen are its lines, and the invoice covers the lessen given since the last one — or the
 * pakket at once. The lesauto is a vehicle in the register (APK, like a garage's cars).
 */
const LES: WorkSkin = {
  skin: "les",
  nounKey: "werk.noun.leerling",
  pluralKey: "werk.noun.leerlingen",
  statuses: ["open", "bezig", "wacht_klant", "klaar", "gefactureerd", "geannuleerd"],
  statusLabels: {
    open: "werk.status.les.open", bezig: "werk.status.les.bezig", wacht_klant: "werk.status.les.wacht_klant",
    klaar: "werk.status.les.klaar", gefactureerd: "werk.status.les.gefactureerd", geannuleerd: "werk.status.les.geannuleerd",
  },
  fields: [
    { key: "telefoon", type: "text", labelKey: "werk.veld.telefoon" },
    { key: "instructeur", type: "text", labelKey: "werk.veld.instructeur" },
    { key: "lespakket", type: "text", labelKey: "werk.veld.lespakket", onCard: true },
    { key: "examen_datum", type: "date", labelKey: "werk.veld.examenDatum", onCard: true },
  ],
  lineKinds: [
    { kind: "les", labelKey: "werk.regel.les", unit: "uur" },
    { kind: "pakket", labelKey: "werk.regel.pakket", unit: "post" },
    { kind: "examen", labelKey: "werk.regel.examen", unit: "post" },
  ],
  vehicle: true,
  recurring: true,
  visitKeys: { list: "werk.les.lessen", done: "werk.les.lesGedaan", invoice: "werk.les.lesFactuur", open: "werk.les.lessenOpen" },
};

/**
 * Trade slug (VAKKEN) → skin. Every bouw trade shares the klus skin: a loodgieter, an elektricien
 * and a schilder all do klussen at an address. The one trade without a work layer is the kapper:
 * a haircut is rung up at the Kassa the moment it is done, and a werkorder for it would be a
 * second screen for a thing that already took one tap. The app stays as it is for him.
 */
const SKIN_BY_VAK: Readonly<Record<string, WorkSkin>> = {
  automonteur: WERKORDER,
  transport: RIT,
  "bouw-klus": KLUS,
  loodgieter: KLUS,
  elektricien: KLUS,
  schilder: KLUS,
  hovenier: TUIN,
  schoonmaak: OPDRACHT,
  fietsenmaker: REPARATIE,
  dienstverlening: DIENST,
  rijschool: LES,
};

/** Does this owner get the work layer? Unknown or unlisted trade → no. */
export function hasWorkLayer(vak: string | null | undefined): boolean {
  const slug = parseVak(vak);
  return slug !== null && slug in SKIN_BY_VAK;
}

/**
 * Every trade that shares a skin. The list reads the rows of all of them: a bouw-klus owner who
 * becomes a loodgieter keeps seeing his klussen; a garage owner who becomes a cleaner does not see
 * werkorders drawn as opdrachten with statuses the new skin has no words for.
 */
export function vaksForSkin(skinId: WorkSkin["skin"]): string[] {
  return Object.entries(SKIN_BY_VAK).filter(([, s]) => s.skin === skinId).map(([vak]) => vak);
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

/** A day the calendar has: the shape AND the date. 2026-02-30 passes the regex and is nobody's day. */
export function isCalendarDay(iso: unknown): iso is string {
  if (typeof iso !== "string" || !ISO.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

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
      if (!isCalendarDay(s)) return { ok: false, key: f.key, reason: "not_a_date" };
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
/** A quantity or price beyond these is a typo, and 1e308 × 5 is Infinity, which round2 turns into € 0. */
export const QUANTITY_MAX = 1_000_000;
export const PRICE_MAX = 10_000_000;

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
    if (quantity === null || quantity <= 0 || quantity > QUANTITY_MAX) return { ok: false, index: i, reason: "bad_quantity" };
    const price = readNumber(r.unit_price);
    if (price === null || price < 0 || price > PRICE_MAX) return { ok: false, index: i, reason: "bad_price" };
    const btw = r.btw_rate === undefined || r.btw_rate === null || r.btw_rate === "" ? (kind.btw ?? DEFAULT_LINE_BTW) : readNumber(r.btw_rate);
    if (btw === null || !ALLOWED_BTW_RATES.includes(btw)) return { ok: false, index: i, reason: "bad_btw" };
    out.push({ kind: kind.kind, description, quantity: round2(quantity), unit: kind.unit, unit_price: round2(price), btw_rate: btw });
  }
  return { ok: true, lines: out };
}

/** What the lines add up to, ex btw. */
export function linesTotalEx(lines: readonly WorkLine[]): number {
  return round2(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0));
}

/** What the lines add up to inc btw — the amount the customer is told; the invoice recomputes it. */
export function linesTotalInc(lines: readonly WorkLine[]): number {
  return round2(lines.reduce((s, l) => s + round2(l.quantity * l.unit_price) * (1 + l.btw_rate / 100), 0));
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
  /**
   * How far to trust the figure. 'werkelijk': the revenue is an invoice and costs are attached.
   * 'geschat': revenue is known (lines or invoice) but no cost has been attached — the margin is
   * the revenue until a bon lands. 'incompleet': no revenue yet. A pretty number that cannot be
   * trusted is worse than a dash; the label travels with the number.
   */
  confidence: "werkelijk" | "geschat" | "incompleet";
}

/**
 * Margin = revenue − attached purchase costs. Hours are NOT subtracted: for a one-person trade
 * the hour rate is the revenue, not a cost, and subtracting it would tell a solo mechanic he
 * makes nothing. Hours are shown beside the margin, never inside it.
 */
export function workMargin(m: WorkMoney & { invoiced?: boolean; costCount?: number }): WorkMargin {
  const costs = round2(m.costsExBtw);
  if (m.revenueExBtw === null) return { revenue: null, costs, margin: null, share: null, confidence: "incompleet" };
  const revenue = round2(m.revenueExBtw);
  const margin = round2(revenue - costs);
  const confidence = m.invoiced && (m.costCount ?? 0) > 0 ? "werkelijk" : "geschat";
  return { revenue, costs, margin, share: revenue > 0 ? round2(margin / revenue) : null, confidence };
}

// ── Financieel gereed ─────────────────────────────────────────────────────────────────────────
//
// [WERK-4] A piece of work is not ready for its invoice because the monteur is done. It is ready
// when the money side is complete: a client to address, something to charge, every attached hour
// priced, and the state that allows invoicing. This is the Core state the consultant asked for —
// the same list for a klus, a werkorder, a rit and an opdracht — and the screen shows the list,
// not just the verdict, so the owner sees WHICH thing is missing.

export type ReadinessKey = "client" | "lines" | "hoursRate" | "status";

export interface Readiness {
  ok: boolean;
  items: ReadonlyArray<{ key: ReadinessKey; ok: boolean }>;
  /** What the invoice would come to, ex btw: lines (× beurten) plus the priced unbilled hours. */
  amountExBtw: number;
}

export function financialReadiness(args: {
  row: { status: string; invoice_id: string | null; repeat_every: string | null; visits: readonly Visit[]; client_name: string | null; lines: readonly WorkLine[]; fields?: FieldValues; billed_periods?: readonly BilledPeriod[] };
  hours: ReadonlyArray<{ hours: number; hourly_rate: number | null; invoice_id: string | null }>;
  /** For a contract billed per period: the period the button would invoice. */
  period?: string;
  today?: string;
}): Readiness {
  const { row, hours } = args;
  // [CONTRACT] A fee contract is ready when its period is: a client, a fee, an open row, the
  // period not yet billed. Hours and beurten are covered by the fee and do not count.
  const fee = contractFee(row);
  if (fee !== null) {
    const period = args.period ?? (args.today ? periodOf(args.today) : "");
    const items = [
      { key: "client" as const, ok: !!(row.client_name && row.client_name.trim()) },
      { key: "lines" as const, ok: fee > 0 },
      { key: "hoursRate" as const, ok: true },
      { key: "status" as const, ok: args.today ? canInvoicePeriod(row, period, args.today) : false },
    ];
    return { ok: items.every((i) => i.ok), items, amountExBtw: fee };
  }
  const unbilled = hours.filter((h) => !h.invoice_id);
  const hoursRevenue = round2(unbilled.reduce((s, h) => s + (h.hourly_rate !== null ? h.hours * h.hourly_rate : 0), 0));
  const own = row.repeat_every ? visitInvoiceLines(row.lines, unbilledVisits(row.visits)) : row.lines;
  const amountExBtw = round2(linesTotalEx(own) + hoursRevenue);
  const items = [
    { key: "client" as const, ok: !!(row.client_name && row.client_name.trim()) },
    { key: "lines" as const, ok: amountExBtw > 0 },
    { key: "hoursRate" as const, ok: unbilled.every((h) => h.hourly_rate !== null) },
    { key: "status" as const, ok: canInvoice(row) },
  ];
  return { ok: items.every((i) => i.ok), items, amountExBtw };
}

/** Begroot against what the work charges so far, when the trade wrote a begroting on it. */
export function overBudget(row: { fields: FieldValues; lines: readonly WorkLine[] }, hoursRevenue = 0): { begroot: number; actual: number; over: boolean } | null {
  const b = row.fields.begroot;
  if (typeof b !== "number" || !Number.isFinite(b) || b <= 0) return null;
  const actual = round2(linesTotalEx(row.lines) + hoursRevenue);
  return { begroot: round2(b), actual, over: actual > b };
}

// ── The signals for Vandaag ───────────────────────────────────────────────────────────────────
//
// "BoekBrug ziet wat jij vergeet": money that is sitting between the work and the invoice. Each
// signal names a number and a place to tap; none of them books anything. Pure — the page fetches
// the rows and the two counts, this only counts.

export type WorkSignal =
  | { kind: "meerwerk_open"; n: number; amount: number }
  | { kind: "hours_without_rate"; n: number }
  | { kind: "costs_unlinked"; n: number; amount: number }
  | { kind: "over_budget"; n: number }
  | { kind: "contract_ending"; n: number };

const EXTRA_KINDS: ReadonlySet<string> = new Set(["meerwerk", "extra"]);

export function workSignals(input: {
  rows: ReadonlyArray<{ id: string; status: string; fields: FieldValues; lines: readonly WorkLine[] }>;
  /** Unbilled hours on open work that carry no rate — they would fall off the invoice. */
  hoursWithoutRate: number;
  /** Hours attached per open piece of work, to measure against afgesproken_uren. */
  hoursByWork: ReadonlyMap<string, number>;
  /** Purchase invoices of suppliers the owner has attached to work before, now attached to none. */
  unlinkedCosts: { n: number; amount: number };
  /** Today, for the contract end countdown; without it no contract signal is raised. */
  today?: string;
}): WorkSignal[] {
  const out: WorkSignal[] = [];
  const open = input.rows.filter((r) => r.status !== "gefactureerd" && r.status !== "geannuleerd");
  let extraN = 0, extraAmount = 0;
  let overN = 0;
  let endingN = 0;
  for (const r of open) {
    const left = input.today ? daysUntil(r.fields.einddatum, input.today) : null;
    if (left !== null && left <= CONTRACT_ENDING_DAYS) endingN += 1;
    const extra = r.lines.filter((l) => EXTRA_KINDS.has(l.kind));
    if (extra.length > 0) { extraN += 1; extraAmount = round2(extraAmount + linesTotalEx(extra)); }
    const spent = input.hoursByWork.get(r.id) ?? 0;
    const agreed = r.fields.afgesproken_uren;
    const overHours = typeof agreed === "number" && agreed > 0 && spent > agreed;
    const budget = overBudget(r);
    if (overHours || budget?.over) overN += 1;
  }
  if (extraN > 0) out.push({ kind: "meerwerk_open", n: extraN, amount: extraAmount });
  if (input.hoursWithoutRate > 0) out.push({ kind: "hours_without_rate", n: input.hoursWithoutRate });
  if (input.unlinkedCosts.n > 0) out.push({ kind: "costs_unlinked", n: input.unlinkedCosts.n, amount: round2(input.unlinkedCosts.amount) });
  if (overN > 0) out.push({ kind: "over_budget", n: overN });
  if (endingN > 0) out.push({ kind: "contract_ending", n: endingN });
  return out;
}

// ── Counts for Vandaag ────────────────────────────────────────────────────────────────────────

export interface WorkCounts {
  open: number;
  bezig: number;
  wacht: number;
  klaar: number;
  /** What the work that is ready to invoice adds up to, ex btw — "3 klaar voor de factuur · € 2.840". */
  klaarExBtw: number;
}

/**
 * What the trade owner wants to hear first: how many are ready to invoice, how many wait.
 * [WERK-BEURT] Repeating work with a done beurt that is not on an invoice yet is "ready to
 * invoice" too, whatever its status says — that is the Monday question for a cleaner.
 */
export function workCounts(rows: ReadonlyArray<{ status: string; repeat_every?: string | null; visits?: unknown; lines?: unknown; fields?: FieldValues; billed_periods?: unknown }>, today?: string): WorkCounts {
  const c: WorkCounts = { open: 0, bezig: 0, wacht: 0, klaar: 0, klaarExBtw: 0 };
  for (const r of rows) {
    if (r.repeat_every && r.status !== "geannuleerd" && r.status !== "gefactureerd") {
      const fee = contractFee(r);
      if (fee !== null) {
        // [CONTRACT] The current period, not yet on an invoice, is what is ready.
        if (today && canInvoicePeriod({ ...r, billed_periods: storedPeriods(r.billed_periods) }, periodOf(today), today)) { c.klaar += 1; c.klaarExBtw = round2(c.klaarExBtw + fee); continue; }
        if (r.status === "open") c.open += 1; else if (r.status === "bezig") c.bezig += 1;
        continue;
      }
      const open = unbilledVisits(storedVisits(r.visits));
      if (open.length > 0) { c.klaar += 1; c.klaarExBtw = round2(c.klaarExBtw + linesTotalEx(visitInvoiceLines(storedLines(r.lines), open))); continue; }
    }
    if (r.status === "open") c.open += 1;
    else if (r.status === "bezig") c.bezig += 1;
    else if (r.status === "wacht_klant" || r.status === "wacht_onderdeel") c.wacht += 1;
    else if (r.status === "klaar") { c.klaar += 1; c.klaarExBtw = round2(c.klaarExBtw + linesTotalEx(storedLines(r.lines))); }
  }
  return c;
}

/**
 * May this row be invoiced from the work screen? Work that happens once: only when finished, and
 * once. Work that repeats: whenever a beurt has been done that is not on an invoice yet — the
 * row itself stays open, the invoice is stamped on the beurten it covers.
 */
export function canInvoice(row: { status: string; invoice_id: string | null; repeat_every?: string | null; visits?: readonly Visit[]; fields?: FieldValues }): boolean {
  if (row.repeat_every) {
    // [CONTRACT] A contract with a fixed amount per period is billed by period (canInvoicePeriod),
    // never by its beurten — those are covered by the fee.
    if (contractFee(row) !== null) return false;
    return row.status !== "geannuleerd" && row.status !== "gefactureerd" && unbilledVisits(row.visits ?? []).length > 0;
  }
  return row.status === "klaar" && !row.invoice_id;
}

// ── [CONTRACT] A contract on a location, billed per period ────────────────────────────────────
//
// The consultant's Financial Context for schoonmaak — "Contract + Locatie" — is not a second
// table. A recurring opdracht already carries the locatie, the rhythm, the afgesproken uren and
// the beurten; a fixed maandbedrag makes it a contract billed per period, and billed_periods
// records which periods went on which invoice, in the same shape as the beurten. One client with
// three locations is three rows with one client name; the overview groups them.

export interface BilledPeriod { period: string; invoice_id: string }

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export function storedPeriods(raw: unknown): BilledPeriod[] {
  if (!Array.isArray(raw)) return [];
  const out: BilledPeriod[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (r && typeof r === "object" && typeof r.period === "string" && PERIOD.test(r.period) && typeof r.invoice_id === "string") out.push({ period: r.period, invoice_id: r.invoice_id });
  }
  return out;
}

export function isPeriod(v: unknown): v is string {
  return typeof v === "string" && PERIOD.test(v);
}

/** 2026-09-08 → "2026-09". */
export function periodOf(iso: string): string {
  return iso.slice(0, 7);
}

/** The fixed amount per period on a contract, or null when the row is billed per beurt (or is not repeating). */
export function contractFee(row: { repeat_every?: string | null; fields?: FieldValues }): number | null {
  if (!row.repeat_every) return null;
  const v = row.fields?.maandbedrag;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? round2(v) : null;
}

/** May this period go on an invoice? Once, never a future month, never on closed work. */
export function canInvoicePeriod(row: { status: string; repeat_every?: string | null; fields?: FieldValues; billed_periods?: readonly BilledPeriod[] }, period: string, today: string): boolean {
  if (contractFee(row) === null) return false;
  if (row.status === "geannuleerd" || row.status === "gefactureerd") return false;
  if (!isPeriod(period) || period > periodOf(today)) return false;
  return !(row.billed_periods ?? []).some((p) => p.period === period);
}

const MONTHS_NL_LONG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/** "2026-09" → "september 2026". Dutch: it lands on the invoice. */
export function periodLabelNL(period: string): string {
  if (!isPeriod(period)) return period;
  return `${MONTHS_NL_LONG[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
}

/**
 * The one line a period invoice carries: the contract, its location, the month, the fee. The btw
 * rate is the row's own (its first line), so a contract inside a home stays at 9% when the owner
 * wrote it so; without a line it is the Dutch default.
 */
export function periodInvoiceLines(row: { title: string; fields: FieldValues; lines: readonly WorkLine[]; repeat_every?: string | null }, period: string): InvoiceLineDraft[] {
  const fee = contractFee(row);
  if (fee === null) return [];
  const locatie = typeof row.fields.locatie === "string" ? ` · ${row.fields.locatie}` : "";
  return [{ description: `${row.title}${locatie} · ${periodLabelNL(period)}`, quantity: 1, unit_price: fee, btw_rate: row.lines[0]?.btw_rate ?? DEFAULT_LINE_BTW }];
}

/** Days from today to the contract's end; null without an end date. Negative once it has passed. */
export function daysUntil(iso: string | number | undefined, today: string): number | null {
  if (typeof iso !== "string" || !isCalendarDay(iso)) return null;
  const a = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const b = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

export const CONTRACT_ENDING_DAYS = 60;

/** One contract as the overview draws it: what it earns this period, what it cost, how it stands. */
export interface ContractStat {
  id: string;
  title: string;
  client_name: string;
  locatie: string;
  /** Fixed fee per period, or null when billed per beurt. */
  fee: number | null;
  /** This period's revenue ex btw: the fee, or the beurten done this period × the lines. */
  revenueMonth: number;
  hoursMonth: number;
  agreedHours: number | null;
  costsMonth: number;
  marginMonth: number;
  visitsMonth: number;
  einddatum: string | null;
  daysLeft: number | null;
  periodBilled: boolean;
  /** 'goed' | 'aandacht': hours over the agreed ones, or the end within CONTRACT_ENDING_DAYS. */
  health: "goed" | "aandacht";
  reasons: Array<"uren" | "einde">;
}

export function contractStat(args: {
  row: { id: string; title: string; client_name: string | null; status: string; repeat_every: string | null; fields: FieldValues; lines: readonly WorkLine[]; visits: readonly Visit[]; billed_periods: readonly BilledPeriod[] };
  hoursMonth: number;
  costsMonth: number;
  today: string;
}): ContractStat {
  const { row, today } = args;
  const period = periodOf(today);
  const fee = contractFee(row);
  const visitsMonth = row.visits.filter((v) => v.on.startsWith(period)).length;
  const revenueMonth = fee !== null ? fee : round2(linesTotalEx(row.lines) * visitsMonth);
  const agreed = typeof row.fields.afgesproken_uren === "number" && row.fields.afgesproken_uren > 0 ? row.fields.afgesproken_uren : null;
  const einddatum = typeof row.fields.einddatum === "string" ? row.fields.einddatum : null;
  const daysLeft = daysUntil(einddatum ?? undefined, today);
  const reasons: Array<"uren" | "einde"> = [];
  if (agreed !== null && args.hoursMonth > agreed) reasons.push("uren");
  if (daysLeft !== null && daysLeft <= CONTRACT_ENDING_DAYS) reasons.push("einde");
  return {
    id: row.id, title: row.title, client_name: row.client_name ?? "", locatie: typeof row.fields.locatie === "string" ? row.fields.locatie : (typeof row.fields.adres === "string" ? row.fields.adres : ""),
    fee, revenueMonth, hoursMonth: round2(args.hoursMonth), agreedHours: agreed, costsMonth: round2(args.costsMonth),
    marginMonth: round2(revenueMonth - args.costsMonth), visitsMonth, einddatum, daysLeft,
    periodBilled: row.billed_periods.some((p) => p.period === period),
    health: reasons.length > 0 ? "aandacht" : "goed", reasons,
  };
}

/** The overview grouped per client, clients with the most attention first, then by name. */
export function contractGroups(stats: readonly ContractStat[]): Array<{ client_name: string; contracts: ContractStat[] }> {
  const by = new Map<string, ContractStat[]>();
  for (const s of stats) by.set(s.client_name, [...(by.get(s.client_name) ?? []), s]);
  return [...by.entries()]
    .map(([client_name, contracts]) => ({ client_name, contracts }))
    .sort((a, b) => (b.contracts.filter((c) => c.health === "aandacht").length - a.contracts.filter((c) => c.health === "aandacht").length) || a.client_name.localeCompare(b.client_name));
}

// ── Repeating work and its beurten ────────────────────────────────────────────────────────────

export type Repeat = "week" | "twee_weken" | "vier_weken" | "maand" | "kwartaal";
export const REPEATS: readonly Repeat[] = ["week", "twee_weken", "vier_weken", "maand", "kwartaal"];
/** The words for each rhythm — literal keys, [TAAL] reads them. */
export const REPEAT_KEYS: Readonly<Record<Repeat, string>> = {
  week: "werk.herhaal.week", twee_weken: "werk.herhaal.tweeWeken", vier_weken: "werk.herhaal.vierWeken", maand: "werk.herhaal.maand", kwartaal: "werk.herhaal.kwartaal",
};

export function isRepeat(v: unknown): v is Repeat {
  return typeof v === "string" && (REPEATS as readonly string[]).includes(v);
}

/** One beurt: the day it was done, and the invoice it went on once it did. */
export interface Visit {
  on: string;
  note: string | null;
  invoice_id: string | null;
}

export const VISITS_MAX = 400;

/** Read stored beurten back (jsonb) without trusting them: a row without a readable date is dropped. */
export function storedVisits(raw: unknown): Visit[] {
  if (!Array.isArray(raw)) return [];
  const out: Visit[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object" || typeof r.on !== "string" || !ISO.test(r.on)) continue;
    out.push({ on: r.on, note: typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, TEXT_MAX) : null, invoice_id: typeof r.invoice_id === "string" ? r.invoice_id : null });
  }
  return out;
}

export type VisitVerdict = { ok: true; visit: Visit } | { ok: false; reason: "not_a_date" | "too_many" | "duplicate_day" };

/**
 * Read one beurt out of an untrusted body: the date must be a day the calendar has, the note is
 * optional, and a second UNBILLED beurt on the same day is refused — a retried tap on a slow
 * connection must not charge one day's cleaning twice. (A billed one on that day is history; a
 * second visit after it is real.)
 */
export function readVisit(body: unknown, existing: readonly Visit[], today: string): VisitVerdict {
  if (existing.length >= VISITS_MAX) return { ok: false, reason: "too_many" };
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const on = typeof src.on === "string" && src.on.trim() ? src.on.trim() : today;
  if (!isCalendarDay(on)) return { ok: false, reason: "not_a_date" };
  if (existing.some((v) => v.on === on && !v.invoice_id)) return { ok: false, reason: "duplicate_day" };
  const note = typeof src.note === "string" && src.note.trim() ? src.note.trim().slice(0, TEXT_MAX) : null;
  return { ok: true, visit: { on, note, invoice_id: null } };
}

export function unbilledVisits(visits: readonly Visit[]): Visit[] {
  return visits.filter((v) => !v.invoice_id);
}

/** Add one rhythm to an ISO day. Months clip to the last day (31 Jan + maand → 28/29 Feb). */
export function addRepeat(iso: string, repeat: Repeat): string {
  const [y, m, d] = iso.split("-").map(Number);
  const days = repeat === "week" ? 7 : repeat === "twee_weken" ? 14 : repeat === "vier_weken" ? 28 : 0;
  const months = repeat === "maand" ? 1 : repeat === "kwartaal" ? 3 : 0;
  let next: Date;
  if (days > 0) next = new Date(Date.UTC(y, m - 1, d + days));
  else {
    // Day 0 of the month after the target month is the target month's last day.
    const lastOfTarget = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
    next = new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastOfTarget)));
  }
  return next.toISOString().slice(0, 10);
}

/** When the next beurt is due: one rhythm after the last one done, or the planned day when none has been. */
export function nextVisitOn(row: { repeat_every: string | null; visits: readonly Visit[]; planned_on: string | null }): string | null {
  if (!isRepeat(row.repeat_every)) return null;
  const last = row.visits.reduce<string | null>((m, v) => (m === null || v.on > m ? v.on : m), null);
  if (last) return addRepeat(last, row.repeat_every);
  return row.planned_on ?? null;
}

/**
 * What the invoice for a set of beurten charges: the work's lines, once per beurt, with the days
 * named on the line. The days are printed in Dutch — this text lands on the invoice, and an
 * invoice is never translated.
 */
export function visitInvoiceLines(lines: readonly WorkLine[], visits: readonly Visit[]): WorkLine[] {
  const n = visits.length;
  if (n === 0) return [];
  const days = [...visits].map((v) => v.on).sort().map(shortDateNL).join(", ");
  return lines.map((l) => ({
    ...l,
    quantity: round2(l.quantity * n),
    description: `${l.description} · ${n === 1 ? "1 beurt" : `${n} beurten`} (${days})`,
  }));
}

const MONTHS_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
/** 2026-09-08 → "8 sep". Pure, no Date, no locale. */
export function shortDateNL(iso: string): string {
  if (!ISO.test(iso)) return iso;
  const mm = Number(iso.slice(5, 7));
  const dd = Number(iso.slice(8, 10));
  return `${dd} ${MONTHS_NL[mm - 1] ?? iso.slice(5, 7)}`;
}

// ── One invoice for several pieces of work ────────────────────────────────────────────────────

export type TogetherVerdict =
  | { ok: true }
  | { ok: false; reason: "too_few" | "not_invoiceable" | "recurring" | "different_clients" | "no_client" };

/**
 * May these rows go on ONE invoice? The courier's week: several afgeleverde ritten for one
 * opdrachtgever. Every row must be invoiceable on its own, none may be repeating work (its
 * beurten are billed from its own row), and they must all name the same client — an invoice
 * has one addressee.
 */
export function canInvoiceTogether(rows: ReadonlyArray<{ status: string; invoice_id: string | null; repeat_every?: string | null; client_id: string | null; client_name: string | null }>): TogetherVerdict {
  if (rows.length < 2) return { ok: false, reason: "too_few" };
  for (const r of rows) {
    if (r.repeat_every) return { ok: false, reason: "recurring" };
    if (!canInvoice(r)) return { ok: false, reason: "not_invoiceable" };
  }
  const key = (r: { client_id: string | null; client_name: string | null }) => r.client_id ?? (r.client_name ?? "").trim().toLowerCase();
  if (!key(rows[0])) return { ok: false, reason: "no_client" };
  if (rows.some((r) => key(r) !== key(rows[0]))) return { ok: false, reason: "different_clients" };
  return { ok: true };
}

/** Rows that could go on one invoice together, grouped by client: the "Verzamelfactuur" offer on the list. */
export function togetherGroups<R extends { id: string; status: string; invoice_id: string | null; repeat_every?: string | null; client_id: string | null; client_name: string | null }>(rows: readonly R[]): Array<{ client_name: string; rows: R[] }> {
  const byClient = new Map<string, R[]>();
  for (const r of rows) {
    if (r.repeat_every || !canInvoice(r)) continue;
    const key = r.client_id ?? (r.client_name ?? "").trim().toLowerCase();
    if (!key) continue;
    byClient.set(key, [...(byClient.get(key) ?? []), r]);
  }
  return [...byClient.values()].filter((g) => g.length >= 2).map((g) => ({ client_name: g[0].client_name ?? "", rows: g }));
}

// ── The lines "Maak factuur" puts on the invoice ──────────────────────────────────────────────

/** The shape the draft door validates. */
export interface InvoiceLineDraft {
  description: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  btw_rate: number;
}

export interface WorkForInvoice {
  title: string;
  fields: FieldValues;
  lines: readonly WorkLine[];
  planned_on: string | null;
  done_on: string | null;
  repeat_every: string | null;
  visits: readonly Visit[];
}

/**
 * The lines one piece of work puts on an invoice, in the order every small tool uses:
 *   1. for a werkorder, the kenteken and kilometerstand as a first line at € 0 — the garage's
 *      customer reads which car this bill is for; on a verzamelfactuur every piece of work gets
 *      such a heading, so the opdrachtgever can tell the ritten apart;
 *   2. the hours attached to the work (built by the caller with linesFromEntries);
 *   3. the lines written on the work — once, or once per beurt for repeating work.
 * Descriptions are Dutch: they land on the invoice.
 */
export function workInvoiceLines(args: { skin: WorkSkin | null; row: WorkForInvoice; kenteken: string | null; hourLines: readonly InvoiceLineDraft[]; heading: boolean; visits?: readonly Visit[] }): InvoiceLineDraft[] {
  const { skin, row, kenteken, hourLines, heading } = args;
  const out: InvoiceLineDraft[] = [];
  const zero = (description: string) => out.push({ description, quantity: 1, unit: "stuk", unit_price: 0, btw_rate: DEFAULT_LINE_BTW });
  if (skin?.skin === "werkorder" && kenteken) {
    const km = row.fields.km_stand;
    const kmText = typeof km === "number" && Number.isFinite(km) ? ` · km-stand ${Math.round(km)}` : "";
    zero(`Kenteken ${kenteken}${kmText}`);
  } else if (heading) {
    const day = row.done_on ?? row.planned_on;
    const route = skin?.skin === "rit" && typeof row.fields.van === "string" && typeof row.fields.naar === "string" ? ` · ${row.fields.van} → ${row.fields.naar}` : "";
    zero(`${row.title}${day ? ` · ${shortDateNL(day)}` : ""}${route}${deliveryText(row.fields)}`);
  }
  for (const l of hourLines) out.push(l);
  const own = row.repeat_every ? visitInvoiceLines(row.lines, args.visits ?? unbilledVisits(row.visits)) : row.lines;
  // "post" is the work layer's word for a lump sum; the invoice has no such unit (units.ts), so
  // the line goes without one rather than with a word the e-factuur cannot code.
  for (const l of own) out.push({ description: l.description, quantity: l.quantity, unit: l.unit === "post" ? undefined : l.unit, unit_price: l.unit_price, btw_rate: l.btw_rate });
  return out;
}

/**
 * The courier's proof on the invoice heading: when it was delivered and who took it. Both come
 * from the rit's fields (the clock is stamped by the API on 'afgeleverd', the name typed at the
 * door). Dutch: it lands on the invoice.
 */
export function deliveryText(fields: FieldValues): string {
  const at = typeof fields.afgeleverd_om === "string" && fields.afgeleverd_om ? ` · afgeleverd ${fields.afgeleverd_om}` : "";
  const who = typeof fields.ontvanger === "string" && fields.ontvanger ? ` · ontvanger: ${fields.ontvanger}` : "";
  return `${at}${who}`;
}

/** The btw rate attached hours go on the invoice at: the skin's own labour rate (a fietsenmaker's repair is 9%). */
export function hourBtwFor(skin: WorkSkin | null, fallback: number): number {
  return skin?.lineKinds.find((k) => k.kind === "arbeid")?.btw ?? fallback;
}

// ── Small daily helpers for the screen ────────────────────────────────────────────────────────

/** Agreed hours against hours spent, when the work names a budget. */
export function hoursBudget(fields: FieldValues, hoursSpent: number): { agreed: number; spent: number; over: boolean } | null {
  const agreed = fields.afgesproken_uren;
  if (typeof agreed !== "number" || !Number.isFinite(agreed) || agreed <= 0) return null;
  return { agreed, spent: round2(hoursSpent), over: hoursSpent > agreed };
}

/** A phone number as a wa.me / tel: target, or null when there is none. Dutch numbers get their country code. */
export function phoneTarget(raw: unknown): { tel: string; wa: string } | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 8) return null;
  const intl = digits.startsWith("+") ? digits.slice(1) : digits.startsWith("00") ? digits.slice(2) : digits.startsWith("0") ? `31${digits.slice(1)}` : digits;
  return { tel: `tel:${digits.startsWith("+") ? digits : `+${intl}`}`, wa: `https://wa.me/${intl.replace(/\D/g, "")}` };
}

/**
 * The "it is ready" message to the customer, in Dutch — it is read by the customer, not the owner.
 * One sentence with the thing (kenteken or bike) and the amount when there is one.
 */
export function readyMessageNL(args: { skin: WorkSkin | null; kenteken: string | null; fields: FieldValues; totalIncBtw: number | null }): string {
  const thing = args.skin?.skin === "werkorder" && args.kenteken ? `uw auto (${args.kenteken})`
    : args.skin?.skin === "reparatie" && typeof args.fields.fiets === "string" ? `uw fiets (${args.fields.fiets})`
    : "uw opdracht";
  const amount = args.totalIncBtw !== null && args.totalIncBtw > 0 ? ` Het totaal is € ${args.totalIncBtw.toFixed(2).replace(".", ",")}.` : "";
  return `Goedendag, ${thing} staat klaar.${amount} Met vriendelijke groet`;
}

/** Which of the open rows are due today or this week: the trade's first question in the morning. */
export function dueOn(row: { planned_on: string | null; repeat_every: string | null; visits: readonly Visit[]; status: string }): string | null {
  if (row.status === "gefactureerd" || row.status === "geannuleerd") return null;
  if (row.repeat_every) return nextVisitOn({ repeat_every: row.repeat_every, visits: row.visits, planned_on: row.planned_on });
  return row.planned_on;
}

export function inWindow(due: string | null, today: string, days: number): boolean {
  if (!due) return false;
  if (due <= today) return true;
  const [y, m, d] = today.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  return due <= end;
}

/** May this row be deleted? Never once money hangs off it — an invoice, an attached cost or hour, or a billed beurt. */
export function canDelete(row: { invoice_id: string | null; attachedCosts: number; attachedHours: number; visits?: readonly Visit[] }): boolean {
  if ((row.visits ?? []).some((v) => v.invoice_id)) return false;
  return !row.invoice_id && row.attachedCosts === 0 && row.attachedHours === 0;
}
