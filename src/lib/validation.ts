// src/lib/validation.ts
// [BOEK-019] Unified KVK / BTW validation — pure, framework-free, node-testable.
//
// Scope (confirmed by Tech Lead, v1.2):
//   - Formal (regex) validation only. No external API (KVK Zoeken / VIES) yet.
//   - Same call shape can later become async + API-backed without changing
//     existing call sites (see "Future: API-backed validation" at the bottom).
//
// Consumers: client creation form (`clients`), profile settings, onboarding.
// This file imports nothing app-specific so it stays testable with plain node
// and reusable from both server and client code.

/** Result of a single field validation. */
export interface ValidationResult {
  /** true = acceptable to save (empty is valid, the fields are optional). */
  valid: boolean;
  /** Dutch, user-facing message. Present only when `valid === false`. */
  error?: string;
}

// ── Canonical formats ────────────────────────────────────
// KVK: exactly 8 digits.              e.g. 12345678
// BTW: NL + 9 digits + B + 2 digits.  e.g. NL123456789B01
export const KVK_REGEX = /^\d{8}$/;
export const BTW_REGEX = /^NL\d{9}B\d{2}$/;
// [BRIDGE-POLISH 3a-3] Dutch IBAN: NL + 2 check digits + 4 bank letters + 10 digits.
// Structural shape only — the mod-97 checksum is verified separately below.
export const IBAN_NL_REGEX = /^NL\d{2}[A-Z]{4}\d{10}$/;

// ── Dutch error messages (confirmed) ─────────────────────
export const KVK_ERROR = "KVK-nummer moet uit 8 cijfers bestaan";
export const BTW_ERROR = "BTW-nummer moet de vorm NL000000000B00 hebben";
// [BRIDGE-POLISH 3a-3]
export const IBAN_ERROR = "IBAN is ongeldig — controleer het rekeningnummer";

const VALID: ValidationResult = { valid: true };

/**
 * Canonical KVK string for storage/validation: trims surrounding whitespace.
 * Returns "" for null / undefined / blank.
 */
export function normalizeKvk(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Canonical BTW string for storage/validation: removes all whitespace and
 * upper-cases (Dutch VAT numbers are conventionally uppercase: NL…B…).
 * Returns "" for null / undefined / blank.
 * Consumers should store this normalized form so it matches what was validated.
 */
export function normalizeBtw(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * Validate a Dutch KVK number (Kamer van Koophandel).
 * Empty / null is VALID — the field is optional (gotcha: KVK may be null).
 * The rule applies only when a value is present.
 */
export function validateKvk(value: string | null | undefined): ValidationResult {
  const v = normalizeKvk(value);
  if (v === "") return VALID; // optional → empty allowed
  if (!KVK_REGEX.test(v)) return { valid: false, error: KVK_ERROR };
  return VALID;
}

/**
 * Validate a Dutch BTW number (VAT).
 * Empty / null is VALID — the field is optional (gotcha: BTW may be null).
 * Case/whitespace tolerant via normalizeBtw; store normalizeBtw(value).
 */
export function validateBtw(value: string | null | undefined): ValidationResult {
  const v = normalizeBtw(value);
  if (v === "") return VALID; // optional → empty allowed
  if (!BTW_REGEX.test(v)) return { valid: false, error: BTW_ERROR };
  return VALID;
}

/**
 * [BRIDGE-POLISH 3a-3]
 * Canonical IBAN string: removes ALL whitespace and upper-cases. Dutch IBANs are
 * conventionally grouped in fours for display ("NL12 ABNA …") but stored compact.
 * Returns "" for null / undefined / blank.
 */
export function normalizeIban(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * [BRIDGE-POLISH 3a-3]
 * ISO 7064 / ISO 13616 mod-97 checksum (the same algorithm every bank uses).
 * Move the first four chars to the end, map letters → numbers (A=10 … Z=35),
 * then the big integer mod 97 must equal 1. Computed digit-by-digit so it works
 * without BigInt. Assumes the structural shape was already checked by the caller.
 */
function ibanMod97(compact: string): number {
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    // A–Z → 10–35; digits → their value
    const code = ch >= "A" && ch <= "Z" ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const d of code) {
      remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder;
}

/**
 * Validate a Dutch IBAN.
 * Empty / null is VALID — the field is optional (same convention as KVK/BTW).
 * Case/whitespace tolerant via normalizeIban; store normalizeIban(value).
 * Checks BOTH the NL structural shape AND the mod-97 checksum, so a typo in the
 * account number is caught, not just a malformed format.
 */
export function validateIban(value: string | null | undefined): ValidationResult {
  const v = normalizeIban(value);
  if (v === "") return VALID; // optional → empty allowed
  if (!IBAN_NL_REGEX.test(v)) return { valid: false, error: IBAN_ERROR };
  if (ibanMod97(v) !== 1) return { valid: false, error: IBAN_ERROR };
  return VALID;
}

/** Validation result that also carries the canonical value to store. */
export interface NormalizedValidationResult extends ValidationResult {
  /**
   * Canonical value the consumer should store. Present ONLY when the value is
   * valid AND non-empty. Undefined for empty (store null) or invalid input —
   * so a consumer can never accidentally persist the raw, un-normalized value.
   */
  normalized?: string;
}

/**
 * Validate a BTW number AND return the canonical form to store in one call.
 * [BOEK-019] zero-errors guard: callers store `result.normalized` (or null
 * when absent), removing the risk of persisting the raw, un-normalized input.
 *
 *   const r = validateAndNormalizeBtw(input);
 *   if (!r.valid) return showError(r.error);
 *   save({ btw_number: r.normalized ?? null });
 *
 * Empty / null is VALID (optional field) and yields no `normalized` value.
 */
export function validateAndNormalizeBtw(
  value: string | null | undefined,
): NormalizedValidationResult {
  const normalized = normalizeBtw(value);
  if (normalized === "") return { valid: true }; // optional → nothing to store
  if (!BTW_REGEX.test(normalized)) return { valid: false, error: BTW_ERROR };
  return { valid: true, normalized };
}

/*
 * Future: API-backed validation (KVK Zoeken / VIES) — deferred (v2.0).
 * The call shape stays the same so call sites don't change. When real lookups
 * are added, introduce async siblings and let callers `await`:
 *
 *   export async function validateKvkRemote(
 *     value: string | null | undefined,
 *   ): Promise<ValidationResult> {
 *     const formal = validateKvk(value);   // fail fast on shape
 *     if (!formal.valid || normalizeKvk(value) === "") return formal;
 *     // ...call KVK Zoeken API; handle 404 / rate-limit / network...
 *     return exists ? { valid: true } : { valid: false, error: "KVK-nummer niet gevonden" };
 *   }
 *
 * Doing the formal check first means the API layer only ever sees well-formed
 * input, and a degraded/offline mode can fall back to formal-only.
 */