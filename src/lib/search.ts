// src/lib/search.ts
// [BOEK-012] Types + pure client-safe helpers ONLY — May 2026
// ⚠️  NO imports from supabase-server, next/headers, or any server-only module.
//     All Supabase queries live in src/app/api/search/route.ts (server only).
//     Client components import ONLY from this file — never from route.ts directly.

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchResultType = "invoice" | "document" | "client";
export type SearchTarget = "invoices" | "documents" | "clients" | "all";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;       // invoice_number | file_name | full_name
  subtitle: string;    // client_name | doc_type | company_name
  meta?: string;       // formatted amount | period | kvk
  status?: string;     // invoice status only
  href: string;        // /dashboard/facturen?highlight={id} etc.
  createdAt: string;
}

export interface SearchResultGroup {
  invoices: SearchResult[];
  documents: SearchResult[];
  clients: SearchResult[];
}

// ─── [BOEK-012] Pure helpers — safe to import in any component ────────────────

// Flatten grouped results to ordered flat list (used by SearchBar for keyboard nav)
export function flattenGroups(groups: SearchResultGroup): SearchResult[] {
  return [...groups.invoices, ...groups.documents, ...groups.clients];
}

// Empty group constant — avoids re-creating on every render
export const EMPTY_GROUP: SearchResultGroup = {
  invoices: [],
  documents: [],
  clients: [],
};

// ─── [SMART-FILTER] Shared in-page live-filter matchers ───────────────────────
// One source of truth for every page's dedicated search box, so accent-folding
// and amount matching behave identically everywhere.

/** Lowercase + strip diacritics ("São" → "sao"), null-safe. */
export function foldText(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** True when the raw query looks like a number/amount (digits + € . , - space). */
export function isAmountQuery(rawQuery: string): boolean {
  const raw = rawQuery.trim();
  if (!raw) return false;
  if (!/^[\d.,\s€-]+$/.test(raw)) return false;
  return raw.replace(/[^\d]/g, "").length >= 1;
}

/**
 * Match a stored numeric amount against what the user is typing, the way a
 * human reads the amount left-to-right. Decimal-aware AND thousands-aware:
 *
 *   670.09  ← "670"  "670,"  "670.0"  "670,0"  "670,09"  "670.09"  "67009"
 *   1500.00 ← "1500" "1.500"
 *   670.09  ✗ "700"   (not a prefix — no false positive)
 *   100.00  ✗ "1000"  (integer part "100" is not prefixed by "1000")
 *
 * Only fires for amount-like queries (see isAmountQuery); text queries never
 * reach here, so a client name that contains digits still matches as text.
 */
export function amountMatchesQuery(
  amount: number | null | undefined,
  rawQuery: string
): boolean {
  if (!isAmountQuery(rawQuery)) return false;
  if (amount == null) return false; // no amount → nothing to match (don't fold null→0)
  const amt = Math.abs(Number(amount));
  if (!Number.isFinite(amt)) return false;

  const raw = rawQuery.trim();
  const digits = raw.replace(/[^\d]/g, "");
  const target = amt.toFixed(2);                    // "670.09"
  const targetInt = target.slice(0, -3);            // "670"

  // Exact full-amount digits, no separator typed: "67009" → 670.09. Equality
  // only (not prefix) so "1000" still can't match 100.00 ("10000").
  if (target.replace(".", "") === digits) return true;

  // Decimal-aware prefix: unify the user's decimal separator (comma or dot) to
  // a dot, then match against the canonical "int.dec" string. Handles the
  // reported bug — typing past the comma ("670,0", "670.0") now keeps matching.
  const asDecimal = raw.replace(/[€\s]/g, "").replace(/,/g, ".");
  if (target.startsWith(asDecimal)) return true;

  // Integer/thousands prefix: compare digit-runs against the euro (integer)
  // part only, so the decimal boundary is never crossed ("1000" ≠ 100.00).
  if (targetInt.startsWith(digits)) return true;

  return false;
}

/**
 * Build PostgREST `.or()` fragments so a Supabase-backed search can match a
 * numeric money column against what the user typed — the server-side companion
 * to amountMatchesQuery. Digits-only interpolation, so injection-safe.
 *
 *   column="total_inc_btw", "670"    → ["…ilike.670", "…ilike.670.%"]   (670.xx)
 *   column="total_inc_btw", "670,0"  → ["…ilike.670.0%"]                (670.09, not 670.50)
 *   column="total_inc_btw", "1.500"  → ["…ilike.1500", "…ilike.1500.%"] (thousands dot)
 *
 * NL convention: a trailing separator followed by 1–2 digits is the decimal
 * comma; a dot before exactly 3 digits is the thousands separator.
 */
export function amountOrConditions(column: string, rawQuery: string): string[] {
  const raw = rawQuery.trim().replace(/[\s€]/g, "");
  if (!raw || !/^[\d.,-]+$/.test(raw) || !/\d/.test(raw)) return [];

  const lastSep = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  let intDigits = "";
  let decDigits = "";
  if (lastSep >= 0) {
    const after = raw.slice(lastSep + 1);
    if (/^\d{1,2}$/.test(after)) {
      decDigits = after;                                  // decimal separator
      intDigits = raw.slice(0, lastSep).replace(/\D/g, "");
    } else {
      intDigits = raw.replace(/\D/g, "");                 // thousands / 3+ digits
    }
  } else {
    intDigits = raw.replace(/\D/g, "");
  }

  if (!intDigits || intDigits.length > 15) return [];
  if (decDigits) {
    return [`${column}::text.ilike.${intDigits}.${decDigits}%`];
  }
  return [
    `${column}::text.ilike.${intDigits}`,     // integer-stored exact "670"
    `${column}::text.ilike.${intDigits}.%`,   // "670.09", "670.5"
  ];
}

/**
 * Convenience: does an invoice-like row match a page's live filter?
 * `texts` are the string fields (name, number, …); `amounts` the numeric ones.
 * Text is accent-folded substring; numbers use amountMatchesQuery.
 */
export function rowMatchesQuery(
  rawQuery: string,
  texts: Array<string | null | undefined>,
  amounts: Array<number | null | undefined> = []
): boolean {
  const raw = rawQuery.trim();
  if (!raw) return true;
  const q = foldText(raw);
  if (texts.some((t) => foldText(t).includes(q))) return true;
  if (isAmountQuery(raw) && amounts.some((a) => amountMatchesQuery(a, raw))) return true;
  return false;
}