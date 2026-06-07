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

// ── Dutch error messages (confirmed) ─────────────────────
export const KVK_ERROR = "KVK-nummer moet uit 8 cijfers bestaan";
export const BTW_ERROR = "BTW-nummer moet de vorm NL000000000B00 hebben";

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