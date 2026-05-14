// lib/search.ts
// Full-text search helpers for invoices + documents (BOEK-012)
// Uses Supabase's built-in FTS with to_tsquery

import { createServerSupabaseClient } from "./supabase-server";

export type SearchTarget = "invoices" | "documents" | "all";

export interface SearchResult {
  type: "invoice" | "document";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  createdAt: string;
}

/**
 * Search invoices and/or documents for a user.
 * Uses Supabase FTS (search_vector column + GIN index).
 */
export async function searchAll(
  userId: string,
  query: string,
  target: SearchTarget = "all",
  limit = 20
): Promise<SearchResult[]> {
  const supabase = await createServerSupabaseClient();

  // Sanitize query: remove special chars, join words with &
  const ftsQuery = query
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" & ");

  if (!ftsQuery) return [];

  const results: SearchResult[] = [];

  if (target === "invoices" || target === "all") {
    const { data } = await supabase
      .from("invoices")
      .select("id, invoice_number, client_name, status, created_at")
      .eq("sender_id", userId)
      .textSearch("search_vector", ftsQuery, { type: "plain" })
      .order("created_at", { ascending: false })
      .limit(limit);

    (data ?? []).forEach((inv) => {
      results.push({
        type: "invoice",
        id: inv.id,
        title: inv.invoice_number ?? "—",
        subtitle: inv.client_name ?? "",
        href: `/dashboard/invoice/${inv.id}`,
        createdAt: inv.created_at,
      });
    });
  }

  if (target === "documents" || target === "all") {
    const { data } = await supabase
      .from("documents")
      .select("id, file_name, doc_type, created_at")
      .eq("user_id", userId)
      .textSearch("search_vector", ftsQuery, { type: "plain" })
      .order("created_at", { ascending: false })
      .limit(limit);

    (data ?? []).forEach((doc) => {
      results.push({
        type: "document",
        id: doc.id,
        title: doc.file_name,
        subtitle: doc.doc_type ?? "document",
        href: `/dashboard/documents?id=${doc.id}`,
        createdAt: doc.created_at,
      });
    });
  }

  // Sort merged results by date
  return results.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}