// src/lib/search.ts
// [BOEK-012] Full-text search — ilike for invoice numbers + accountant mode — May 2026
// Uses ilike (not FTS) — FTS breaks "2026-004" into "2026" and "004" separately.
// ilike searches exact substring — correct for invoice numbers, names, and descriptions.
// invoice_lines descriptions included via subquery join.

import { createServerSupabaseClient } from "./supabase-server";

export type SearchTarget = "invoices" | "documents" | "all";

export interface SearchResult {
  type: "invoice" | "document";
  id: string;
  title: string;
  subtitle: string;
  meta?: string;
  status?: string;
  href: string;
  createdAt: string;
}

export async function searchAll(
  userId: string,
  query: string,
  target: SearchTarget = "all",
  limit = 8,
  role: "zzper" | "accountant" = "zzper"
): Promise<SearchResult[]> {
  const supabase = await createServerSupabaseClient();
  const q = query.trim();
  if (q.length < 2) return [];

  const fmt = (n: number) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

  // [BOEK-012] Accountant: collect all client IDs, then search their invoices too
  let senderIds: string[] = [userId];
  if (role === "accountant") {
    const { data: links } = await supabase
      .from("accountant_clients")
      .select("zzper_id")
      .eq("accountant_id", userId);
    const clientIds = (links ?? []).map((l: { zzper_id: string }) => l.zzper_id);
    senderIds = [userId, ...clientIds];
  }

  // [BOEK-012] Find invoice IDs that match on invoice_lines.description
  // Used to expand results beyond header fields
  let invoiceIdsFromLines: string[] = [];
  if (target !== "documents") {
    const { data: lineMatches } = await supabase
      .from("invoice_lines")
      .select("invoice_id")
      .ilike("description", `%${q}%`)
      .limit(20);
    invoiceIdsFromLines = [...new Set((lineMatches ?? []).map((l: { invoice_id: string }) => l.invoice_id))];
  }

  const [invoicesRes, docsRes] = await Promise.all([
    target !== "documents"
      ? supabase
          .from("invoices")
          .select("id, invoice_number, client_name, status, total_inc_btw, created_at")
          .in("sender_id", senderIds)
          .or(
            [
              `invoice_number.ilike.%${q}%`,
              `client_name.ilike.%${q}%`,
              `client_email.ilike.%${q}%`,
              invoiceIdsFromLines.length > 0
                ? `id.in.(${invoiceIdsFromLines.join(",")})`
                : null,
            ]
              .filter(Boolean)
              .join(",")
          )
          .order("created_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [] as any[] }),

    target !== "invoices"
      ? supabase
          .from("documents")
          .select("id, file_name, doc_type, period, year, created_at")
          .eq("user_id", userId)
          .or(`file_name.ilike.%${q}%,doc_type.ilike.%${q}%`)
          .order("created_at", { ascending: false })
          .limit(Math.ceil(limit / 2))
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const invoices: SearchResult[] = (invoicesRes.data ?? []).map((inv: any) => ({
    type: "invoice" as const,
    id: inv.id,
    title: inv.invoice_number ?? "—",
    subtitle: inv.client_name ?? "",
    meta: inv.total_inc_btw != null ? fmt(inv.total_inc_btw) : undefined,
    status: inv.status,
    href: `/dashboard/invoice/${inv.id}`,
    createdAt: inv.created_at,
  }));

  const docs: SearchResult[] = (docsRes.data ?? []).map((doc: any) => ({
    type: "document" as const,
    id: doc.id,
    title: doc.file_name,
    subtitle: doc.doc_type ?? "document",
    meta: [doc.period, doc.year].filter(Boolean).join(" · ") || undefined,
    href: `/dashboard/documents?id=${doc.id}`,
    createdAt: doc.created_at,
  }));

  // Merge, deduplicate by id, sort by createdAt desc
  const seen = new Set<string>();
  return [...invoices, ...docs]
    .filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}