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
 * Split a money-shaped query into its euro (integer) and cent (decimal) digit
 * runs, applying the NL convention so thousands separators never leak into the
 * value. The single source of truth for BOTH the client matcher and the server
 * OR-builder, so they agree on every input.
 *
 * NL convention: the LAST separator followed by exactly 1–2 digits is the
 * decimal comma; any other dot (before 3 digits) is a thousands separator.
 *
 *   "670"      → { intDigits: "670",  decDigits: "",  hasDecimalSep: false }
 *   "670,"     → { intDigits: "670",  decDigits: "",  hasDecimalSep: false }
 *   "670,0"    → { intDigits: "670",  decDigits: "0", hasDecimalSep: true  }
 *   "1.234,5"  → { intDigits: "1234", decDigits: "5", hasDecimalSep: true  }
 *   "1.500"    → { intDigits: "1500", decDigits: "",  hasDecimalSep: false }
 *
 * Returns null when the query is not money-shaped (letters, empty, no digits).
 */
export function amountQueryParts(
  rawQuery: string
): { intDigits: string; decDigits: string; hasDecimalSep: boolean; decimalSepIsComma: boolean } | null {
  const raw = rawQuery.trim().replace(/[\s€]/g, "");
  if (!raw || !/^[\d.,-]+$/.test(raw) || !/\d/.test(raw)) return null;

  const lastSep = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  if (lastSep >= 0) {
    const after = raw.slice(lastSep + 1);
    if (/^\d{1,2}$/.test(after)) {
      // decimal separator (1–2 trailing digits)
      return {
        intDigits: raw.slice(0, lastSep).replace(/\D/g, ""),
        decDigits: after,
        hasDecimalSep: true,
        decimalSepIsComma: raw[lastSep] === ",",
      };
    }
  }
  // no decimal: everything is the integer part (thousands separators dropped)
  return { intDigits: raw.replace(/\D/g, ""), decDigits: "", hasDecimalSep: false, decimalSepIsComma: false };
}

/**
 * Match a stored numeric amount against what the user is typing, the way a
 * human reads the amount left-to-right. Decimal- AND thousands-aware:
 *
 *   670.09    ← "670"  "670,"  "670.0"  "670,0"  "670,09"  "670.09"
 *   1234.56   ← "1.234"  "1.234,5"  "1.234,56"   (NL thousands dot handled)
 *   1500.00   ← "1500"  "1.500"
 *   670.09    ✗ "700"    (not a prefix — no false positive)
 *   100.00    ✗ "1000"   (integer part "100" is not prefixed by "1000")
 *   6.70      ✗ "670"    (whole-euro query never matches a sub-€10 cents amount)
 *
 * Only fires for amount-like queries (see isAmountQuery); text queries never
 * reach here, so a client name that contains digits still matches as text.
 */
export function amountMatchesQuery(
  amount: number | null | undefined,
  rawQuery: string
): boolean {
  const parts = amountQueryParts(rawQuery);
  if (!parts || !parts.intDigits) return false;
  if (amount == null) return false; // no amount → nothing to match (don't fold null→0)
  const amt = Math.abs(Number(amount));
  if (!Number.isFinite(amt)) return false;

  const target = amt.toFixed(2);         // "670.09"
  const targetInt = target.slice(0, -3); // "670"

  if (parts.hasDecimalSep) {
    // A decimal was typed → prefix-match the canonical "int.dec" against the
    // amount. Thousands separators were already stripped from intDigits, so
    // "1.234,5" → "1234.5" correctly prefixes 1234.56.
    if (target.startsWith(`${parts.intDigits}.${parts.decDigits}`)) return true;
    // A DOT is ambiguous in NL (thousands vs decimal); a COMMA is unambiguously
    // decimal. So for a dot only, also accept the "thousands-in-progress"
    // reading — the digit run still inside the euro part — so "3.4" keeps
    // matching €3.431,70 mid-typing. A comma ("3,4") stays strictly €3,4x.
    if (!parts.decimalSepIsComma && targetInt.startsWith(parts.intDigits + parts.decDigits)) return true;
    return false;
  }
  // No decimal separator → whole-euro prefix on the integer part only, so the
  // decimal boundary is never crossed ("1000" ✗ 100.00, "670" ✗ 6.70).
  return targetInt.startsWith(parts.intDigits);
}

/**
 * Build PostgREST `.or()` fragments so a Supabase-backed search can match a
 * numeric money column against what the user typed — the server-side companion
 * to amountMatchesQuery (shares amountQueryParts, so they agree). Digits-only
 * interpolation, so injection-safe.
 *
 *   column="total_inc_btw", "670"    → ["…ilike.670", "…ilike.670.%"]   (670.xx)
 *   column="total_inc_btw", "670,0"  → ["…ilike.670.0%"]                (670.09, not 670.50)
 *   column="total_inc_btw", "1.500"  → ["…ilike.1500", "…ilike.1500.%"] (thousands dot)
 */
export function amountOrConditions(column: string, rawQuery: string): string[] {
  const parts = amountQueryParts(rawQuery);
  if (!parts || !parts.intDigits || parts.intDigits.length > 15) return [];

  if (parts.hasDecimalSep) {
    const conds = [`${column}::text.ilike.${parts.intDigits}.${parts.decDigits}%`];
    // Mirror the client's dot ambiguity: a dot may be a thousands-in-progress
    // separator, so also match the digit run inside the euro part ("3.4" → 34xx).
    if (!parts.decimalSepIsComma) {
      conds.push(`${column}::text.ilike.${parts.intDigits}${parts.decDigits}%`);
    }
    return conds;
  }
  return [
    `${column}::text.ilike.${parts.intDigits}`,     // integer-stored exact "670"
    `${column}::text.ilike.${parts.intDigits}.%`,   // "670.09", "670.5"
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