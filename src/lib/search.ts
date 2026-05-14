// lib/search.ts
// Search for invoices and documents (BOEK-012)
// Uses ilike — works perfectly for invoice numbers like "2026-004"
// Parallel queries via Promise.all for speed
// src/lib/search.ts
// ilike search — werkt voor factuurnum, naam, email
// Voor accountant: zoekt ook in facturen van al zijn klanten

// lib/search.ts
// Search for invoices and documents (BOEK-012)
// Uses ilike — works perfectly for invoice numbers like "2026-004"
// Parallel queries via Promise.all for speed

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
    new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: "EUR",
    }).format(n);

  // Accountant: collect all client IDs first, then search their invoices
  let senderIds: string[] = [userId];
  if (role === "accountant") {
    const { data: links } = await supabase
      .from("accountant_clients")
      .select("zzper_id")
      .eq("accountant_id", userId);
    const clientIds = (links ?? []).map((l) => l.zzper_id);
    senderIds = [userId, ...clientIds];
  }

  const [invoicesRes, docsRes] = await Promise.all([
    target !== "documents"
      ? supabase
          .from("invoices")
          .select(
            "id, invoice_number, client_name, status, total_inc_btw, created_at"
          )
          .in("sender_id", senderIds)
          .or(
            `invoice_number.ilike.%${q}%,client_name.ilike.%${q}%,client_email.ilike.%${q}%`
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

  const invoices: SearchResult[] = (invoicesRes.data ?? []).map((inv) => ({
    type: "invoice" as const,
    id: inv.id,
    title: inv.invoice_number ?? "—",
    subtitle: inv.client_name ?? "",
    meta: inv.total_inc_btw != null ? fmt(inv.total_inc_btw) : undefined,
    status: inv.status,
    href: `/dashboard/invoice/${inv.id}`,
    createdAt: inv.created_at,
  }));

  const docs: SearchResult[] = (docsRes.data ?? []).map((doc) => ({
    type: "document" as const,
    id: doc.id,
    title: doc.file_name,
    subtitle: doc.doc_type ?? "document",
    meta: [doc.period, doc.year].filter(Boolean).join(" · ") || undefined,
    href: `/dashboard/documents?id=${doc.id}`,
    createdAt: doc.created_at,
  }));

  return [...invoices, ...docs];
}