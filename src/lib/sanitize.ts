// src/lib/sanitize.ts
// [BOEK-SECURITY-2] Search input escaping — May 2026
// =====================================================
// يحمي من injection في Supabase ilike + .or() queries
// =====================================================

/**
 * Escapes special characters in search terms used with Supabase ilike/.or().
 *
 * Characters escaped:
 *   - `\` (backslash) — يجب أن يكون أول escape (وإلا يضرب الـ escapes الأخرى)
 *   - `%` `_` — PostgreSQL LIKE/ILIKE wildcards
 *   - `,` `(` `)` — PostgREST .or() syntax delimiters
 *
 * Also:
 *   - Trims whitespace
 *   - Caps length at 100 chars (DoS protection)
 *
 * @example
 *   const safe = escapeSearchTerm(userInput)
 *   .or(`file_name.ilike.%${safe}%,client_name.ilike.%${safe}%`)
 */
export function escapeSearchTerm(input: string): string {
  if (typeof input !== 'string') return ''

  return input
    .replace(/\\/g, '\\\\')   // backslash أولاً — مهم جداً
    .replace(/%/g,  '\\%')    // LIKE wildcard
    .replace(/_/g,  '\\_')    // LIKE single-char wildcard
    .replace(/,/g,  '\\,')    // .or() separator
    .replace(/\(/g, '\\(')    // .or() group open
    .replace(/\)/g, '\\)')    // .or() group close
    .trim()
    .slice(0, 100)            // DoS protection
}

/**
 * Escapes a value passed DIRECTLY to `.ilike(column, value)` / `.like(...)`.
 *
 * Unlike `escapeSearchTerm`, this does NOT touch `,` `(` `)`: a direct
 * `.ilike(col, val)` sends the value as a bound parameter, so PostgREST never
 * parses those as `.or()` syntax — escaping them would corrupt legitimate names
 * (and `\,` is even an invalid LIKE escape sequence). We neutralise ONLY the LIKE
 * wildcards so the match is literal:
 *   - `\` first (the LIKE escape char itself)
 *   - `%` `_` — LIKE/ILIKE wildcards
 *
 * @example
 *   query.ilike('client_name', escapeLikeValue(vendor))
 */
export function escapeLikeValue(input: string): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

/**
 * Builds a safe .or() filter string for Supabase from a sanitized query.
 * Convenience wrapper to avoid forgetting the escape.
 *
 * @example
 *   .or(buildSearchOr('hello world', ['file_name', 'client_name']))
 *   // → "file_name.ilike.%hello world%,client_name.ilike.%hello world%"
 *   //   with escape applied
 */
export function buildSearchOr(rawInput: string, columns: string[]): string {
  const safe = escapeSearchTerm(rawInput)
  if (!safe) return ''
  return columns.map((col) => `${col}.ilike.%${safe}%`).join(',')
}
