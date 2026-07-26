// src/lib/search.ts
// [BOEK-012] Types + pure client-safe helpers ONLY — May 2026
// ⚠️  NO imports from supabase-server, next/headers, or any server-only module.
//     All Supabase queries live in src/app/api/search/route.ts (server only).
//     Client components import ONLY from this file — never from route.ts directly.

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchResultType = "invoice" | "document" | "client" | "banktransaction" | "cashentry";
export type SearchTarget = "invoices" | "documents" | "clients" | "bank" | "kas" | "all";

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
  bankTransactions: SearchResult[];
  cashEntries: SearchResult[];
}

// ─── [BOEK-012] Pure helpers — safe to import in any component ────────────────

// Flatten grouped results to ordered flat list (used by SearchBar for keyboard nav).
// Order MUST match the render order of the sections in SearchBar so keyboard nav aligns.
export function flattenGroups(groups: SearchResultGroup): SearchResult[] {
  return [
    ...groups.invoices,
    ...groups.documents,
    ...groups.clients,
    ...groups.bankTransactions,
    ...groups.cashEntries,
  ];
}

// Empty group constant — avoids re-creating on every render
export const EMPTY_GROUP: SearchResultGroup = {
  invoices: [],
  documents: [],
  clients: [],
  bankTransactions: [],
  cashEntries: [],
};