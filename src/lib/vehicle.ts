// src/lib/vehicle.ts
// [VOERTUIG] The Dutch kenteken, and when its APK runs out. Pure, no I/O.
// Run: npx tsx src/lib/vehicle.test.ts
//
// ── WHY A GARAGE NEEDED THIS BEFORE IT NEEDED ANYTHING ELSE ──
// Every Dutch garage system — Motira, Sleutl, GarageOS, GarageManager — is built around two facts
// this app did not hold: the VEHICLE, and the date its APK expires. That is not decoration. A
// mechanic does not think in customers, he thinks in cars: "de grijze Golf van dinsdag" is a
// vehicle with a history, and the person attached to it changes when the car is sold.
//
// And the APK date is the single thing in this whole product line that hands a shop a reason to
// contact a customer again WITHOUT buying it: it is a fixed, dated, legally-required return visit,
// known months ahead. Every one of those systems sells reminders on it.
//
// ── WHAT THIS MODULE IS NOT ──
// It is not a money source and it never becomes one. A vehicle carries no amount, no rate and no
// btw; nothing here reaches financial-result, the aangifte or the drawer. That is deliberate — the
// value is the record and the reminder, and keeping money out of it means this whole feature cannot
// be wrong about a euro.
//
// ── RDW ──
// The RDW open-data API returns make, model and APK expiry for any Dutch plate, free. It is not
// wired up here, and the reason is written down rather than forgotten: the field names could not be
// verified against a live response from the environment this was written in, and a parser built on
// guessed field names is exactly the kind of thing that reads as working and silently stores the
// wrong car. The plate is typed for now. The moment someone confirms the response shape, the lookup
// slots in as an ENRICHMENT of these same fields — nothing here has to change to accept it.

/** A vehicle as the app stores it. */
export interface Vehicle {
  id: string;
  kenteken: string;          // stored bare and uppercase: "12ABC3"
  description: string | null; // "Volkswagen Golf" — typed, or one day from RDW
  customer_name: string | null;
  apk_expiry: string | null;  // ISO 'YYYY-MM-DD'
  notes: string | null;
}

/**
 * Normalise a typed plate to how it is STORED: uppercase, no separators.
 *
 * Stored bare rather than formatted because a Dutch owner types the same plate five ways —
 * "12-ab-3", "12 AB 3", "12ab3" — and a lookup that only matches one of them creates a second
 * record for a car that is already there. Formatting is a display concern, and displayKenteken
 * below is where it belongs.
 */
export function normalizeKenteken(raw: string | null | undefined): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The Dutch sidecodes, in the order they were issued. Each is the LETTER/DIGIT shape of a plate,
 * and the shape alone says where the dashes go — which is why a plate can be formatted without a
 * lookup table of actual plates.
 *
 * 'X' is a letter, '9' is a digit. Groups are separated as the RDW writes them.
 */
const SIDECODES: readonly string[] = [
  "XX-99-99", // 1
  "99-99-XX", // 2
  "99-XX-99", // 3
  "XX-99-XX", // 4
  "XX-XX-99", // 5
  "99-XX-XX", // 6
  "99-XXX-9", // 7
  "9-XXX-99", // 8
  "XX-999-X", // 9
  "X-999-XX", // 10
  "XXX-99-X", // 11
  "X-99-XXX", // 12
  "9-XX-999", // 13
  "999-XX-9", // 14
];

/** Does a bare plate match this sidecode's letter/digit shape? */
function matchesShape(bare: string, sidecode: string): boolean {
  const shape = sidecode.replace(/-/g, "");
  if (bare.length !== shape.length) return false;
  for (let i = 0; i < shape.length; i++) {
    const isDigit = bare[i] >= "0" && bare[i] <= "9";
    if (shape[i] === "9" && !isDigit) return false;
    if (shape[i] === "X" && isDigit) return false;
  }
  return true;
}

/**
 * Format a plate the way it is printed on the car: "12ABC3" → "12-ABC-3".
 *
 * Derived from the sidecode SHAPE, so no table of real plates is needed and a plate issued next
 * year formats correctly the day it exists. A plate matching no sidecode is returned bare rather
 * than grouped by guesswork — showing "AB-CD-EF" for something that is not a plate would make a
 * typo look official, and the owner is the one who has to spot it.
 */
export function displayKenteken(raw: string | null | undefined): string {
  const bare = normalizeKenteken(raw);
  if (!bare) return "";
  for (const sidecode of SIDECODES) {
    if (!matchesShape(bare, sidecode)) continue;
    const sizes = sidecode.split("-").map((g) => g.length);
    const parts: string[] = [];
    let at = 0;
    for (const size of sizes) {
      parts.push(bare.slice(at, at + size));
      at += size;
    }
    return parts.join("-");
  }
  return bare;
}

/**
 * Could this be a Dutch plate at all?
 *
 * Deliberately shape-based and nothing more. It cannot know whether a plate was ever ISSUED — only
 * the RDW knows that — so it answers the question it can answer honestly: does this look like a
 * Dutch registration. Everything since 1951 is six characters in one of the sidecodes above.
 */
export function isKentekenShape(raw: string | null | undefined): boolean {
  const bare = normalizeKenteken(raw);
  return bare.length === 6 && SIDECODES.some((s) => matchesShape(bare, s));
}

/** How urgent this vehicle's APK is. */
export type ApkStatus = "expired" | "due" | "soon" | "ok" | "unknown";

/** An APK inside this many days is 'due' — the window a garage actually calls people in. */
export const APK_DUE_DAYS = 30;
/** …and inside this many it is 'soon': visible, not yet urgent. */
export const APK_SOON_DAYS = 60;

/** Whole days from `today` to `date`. Negative when the date has passed. Null on unreadable input. */
export function daysUntil(date: string | null | undefined, today: string): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const a = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/**
 * Where this vehicle's APK stands.
 *
 * 'unknown' is a real answer and not a failure: a garage types a plate the moment a car is in front
 * of it and often does not know the APK date yet. Treating that as 'ok' would quietly drop the car
 * out of every reminder list, which is the one outcome that makes a reminder feature worthless —
 * the cars it forgets are invisible by construction.
 */
export function apkStatus(expiry: string | null | undefined, today: string): ApkStatus {
  const days = daysUntil(expiry, today);
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= APK_DUE_DAYS) return "due";
  if (days <= APK_SOON_DAYS) return "soon";
  return "ok";
}

/** Sort order for the list: the cars that need calling first, then the rest by date. */
const STATUS_RANK: Record<ApkStatus, number> = { expired: 0, due: 1, soon: 2, ok: 3, unknown: 4 };

/**
 * Order vehicles the way a garage reads them: what is overdue, then what is due, then the rest.
 * Within a rank, the earliest date first — and an unknown APK sorts last but is never dropped.
 * Pure and stable: ties fall back to the plate so the list does not reshuffle between renders.
 */
export function sortByApkUrgency<T extends { apk_expiry: string | null; kenteken: string }>(
  vehicles: readonly T[],
  today: string,
): T[] {
  return [...vehicles].sort((a, b) => {
    const ra = STATUS_RANK[apkStatus(a.apk_expiry, today)];
    const rb = STATUS_RANK[apkStatus(b.apk_expiry, today)];
    if (ra !== rb) return ra - rb;
    const da = a.apk_expiry ?? "";
    const db = b.apk_expiry ?? "";
    if (da !== db) return da < db ? -1 : 1;
    return a.kenteken.localeCompare(b.kenteken);
  });
}

/** The vehicles worth putting in front of the owner today: overdue or due inside the window. */
export function vehiclesNeedingApk<T extends { apk_expiry: string | null; kenteken: string }>(
  vehicles: readonly T[],
  today: string,
): T[] {
  return sortByApkUrgency(vehicles, today).filter((v) => {
    const s = apkStatus(v.apk_expiry, today);
    return s === "expired" || s === "due";
  });
}
