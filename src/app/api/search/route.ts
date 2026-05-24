// src/app/api/search/route.ts
// [BOEK-012] Smart search API — server only — May 2026
// [BOEK-FOUNDATION-TYPES] Null safety for nullable FK fields — May 2026
// ⚠️  This is the ONLY file allowed to import supabase-server.ts for search.
//     All Supabase queries are here. search.ts has types only.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { SearchResult, SearchResultGroup, SearchTarget } from "@/lib/search";

// ─── [BOEK-012] Query normalization ──────────────────────────────────────────
// "2026-004 moha" → ["2026-004 moha", "2026", "004", "moha"]
// Searches invoice numbers, amounts, and names simultaneously.

function normalizeQuery(q: string): string[] {
  const trimmed = q.trim();
  const numbers = trimmed.match(/\d+/g) ?? [];
  const words = trimmed.split(/\s+/).filter((w) => w.length > 1);
  return [...new Set([trimmed, ...numbers, ...words])];
}

// Builds Supabase .or() string: fields × terms cartesian product
function buildOr(fields: string[], terms: string[]): string {
  return fields
    .flatMap((f) => terms.map((t) => `${f}.ilike.%${t}%`))
    .join(",");
}

function dedup(arr: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return arr.filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const target = (req.nextUrl.searchParams.get("target") ?? "all") as SearchTarget;

  const EMPTY: SearchResultGroup = { invoices: [], documents: [], clients: [] };

  if (q.length < 2) return NextResponse.json(EMPTY);

  const terms = normalizeQuery(q);

  const fmt = (n: number) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

  // Role check
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role === "accountant" ? "accountant" : "zzper";

  // Accountant: collect all linked client IDs
  let senderIds: string[] = [user.id];
  if (role === "accountant") {
    const { data: links } = await supabase
      .from("accountant_clients")
      .select("zzper_id")
      .eq("accountant_id", user.id);
    // [BOEK-FOUNDATION-TYPES] zzper_id is nullable — filter out nulls
    const clientIds = (links ?? [])
      .map((l) => l.zzper_id)
      .filter((id): id is string => id !== null);
    senderIds = [user.id, ...clientIds];
  }

  // invoice_lines pre-query — find invoice IDs matching on line descriptions
  let invoiceIdsFromLines: string[] = [];
  if (target === "all" || target === "invoices") {
    const { data: lineMatches } = await supabase
      .from("invoice_lines")
      .select("invoice_id")
      .or(buildOr(["description"], terms))
      .limit(30);
    // [BOEK-FOUNDATION-TYPES] invoice_id is nullable — filter out nulls
    invoiceIdsFromLines = [
      ...new Set(
        (lineMatches ?? [])
          .map((l) => l.invoice_id)
          .filter((id): id is string => id !== null)
      ),
    ];
  }

  // Parallel queries across all sources
  const [invoicesRes, docsRes, clientsRes] = await Promise.all([

    // Source 1: invoices
    target === "all" || target === "invoices"
      ? supabase
          .from("invoices")
          .select("id, invoice_number, client_name, client_email, status, total_inc_btw, created_at")
          .in("sender_id", senderIds)
          .or(
            [
              buildOr(["invoice_number", "client_name", "client_email"], terms),
              ...terms.map((t) => `total_inc_btw::text.ilike.%${t}%`),
              invoiceIdsFromLines.length > 0
                ? `id.in.(${invoiceIdsFromLines.join(",")})`
                : null,
            ]
              .filter(Boolean)
              .join(",")
          )
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] as any[] }),

    // Source 2: documents
    target === "all" || target === "documents"
      ? supabase
          .from("documents")
          .select("id, file_name, doc_type, ai_doc_type, period, year, notes, created_at")
          .eq("user_id", user.id)
          .or(buildOr(["file_name", "doc_type", "ai_doc_type", "notes"], terms))
          .order("created_at", { ascending: false })
          .limit(4)
      : Promise.resolve({ data: [] as any[] }),

    // Source 3: clients (accountant only)
    target === "all" || target === "clients"
      ? role === "accountant" && senderIds.length > 1
        ? supabase
            .from("profiles")
            .select("id, full_name, company_name, email, kvk_number, created_at")
            .in("id", senderIds.filter((id) => id !== user.id))
            .or(buildOr(["full_name", "company_name", "email", "kvk_number"], terms))
            .limit(5)
        : Promise.resolve({ data: [] as any[] })
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const invoices: SearchResult[] = dedup(
    (invoicesRes.data ?? []).map((inv: any) => ({
      type: "invoice" as const,
      id: inv.id,
      title: inv.invoice_number ?? "—",
      subtitle: inv.client_name ?? "",
      meta: inv.total_inc_btw != null ? fmt(inv.total_inc_btw) : undefined,
      status: inv.status,
      href: `/dashboard/facturen?highlight=${inv.id}`,
      createdAt: inv.created_at,
    }))
  );

  const documents: SearchResult[] = dedup(
    (docsRes.data ?? []).map((doc: any) => ({
      type: "document" as const,
      id: doc.id,
      title: doc.file_name,
      subtitle: doc.ai_doc_type ?? doc.doc_type ?? "document",
      meta: [doc.period, doc.year].filter(Boolean).join(" · ") || undefined,
      href: `/dashboard/bestanden?file=${doc.id}`,
      createdAt: doc.created_at,
    }))
  );

  const clients: SearchResult[] = dedup(
    (clientsRes.data ?? []).map((p: any) => ({
      type: "client" as const,
      id: p.id,
      title: p.full_name ?? p.company_name ?? p.email ?? "—",
      subtitle: p.company_name ?? p.email ?? "",
      meta: p.kvk_number ? `KVK ${p.kvk_number}` : undefined,
      href: `/dashboard/klanten?highlight=${p.id}`,
      createdAt: p.created_at,
    }))
  );

  return NextResponse.json({ invoices, documents, clients });
}