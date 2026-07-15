// src/app/api/search/route.ts
// [BOEK-012] Smart search API — server only — May 2026
// [BOEK-FOUNDATION-TYPES] Null safety for nullable FK fields — May 2026
// [SEARCH] Correctness/safety/coverage hardening + working deep-links — Jul 2026
//   - Sanitises every term before it enters a PostgREST .or() string (comma/paren/
//     wildcard injection was breaking queries).
//   - NL amount normalisation ("1.500,00" now matches the stored 1500.00).
//   - Numeric terms require length >= 2 (kills the "%1%" false-positive flood).
//   - Excludes trashed documents; includes RECEIVED invoices (sender OR receiver).
//   - zzp'ers now search their own clients table; accountants search linked profiles.
//   - Result hrefs use the params the target pages actually read: ?focus= (facturen,
//     klanten) and ?folder=&focus= (bestanden). Previously ?highlight=/?file= were dead.
// ⚠️  This is the ONLY file allowed to import supabase-server.ts for search.
//     All Supabase queries are here. search.ts has types only.
//     Runs on the anon key + user cookies → RLS is enforced on every query.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { parseAmountNL } from "@/lib/parse-nl";
import type { SearchResult, SearchResultGroup, SearchTarget } from "@/lib/search";

// ─── [SEARCH] Term sanitation ────────────────────────────────────────────────
// PostgREST .or() uses commas as separators and parentheses as grouping; % and _
// are ILIKE wildcards. Raw user input containing any of these broke or subverted
// the filter grammar. Replace them with spaces (never glue tokens together).
function sanitizeTerm(t: string): string {
  return t.replace(/[,()%_*\\":]/g, " ").replace(/\s+/g, " ").trim();
}

// ─── [BOEK-012] Query normalization ──────────────────────────────────────────
// "2026-004 moha" → ["2026-004", "moha", "2026", "004"]
// Numbers < 2 digits are dropped (a bare "1" matches almost everything). The full
// multi-word string is only kept as a term when it is a single token (otherwise it
// never matches a single column and just wastes an OR predicate). Capped at 6 terms.
function normalizeQuery(q: string): string[] {
  const trimmed = q.trim();
  const numbers = (trimmed.match(/\d+/g) ?? []).filter((n) => n.length >= 2);
  const words = trimmed.split(/\s+/).filter((w) => w.length > 1);
  const singleToken = /\s/.test(trimmed) ? [] : [trimmed];
  const cleaned = [...new Set([...singleToken, ...words, ...numbers])]
    .map(sanitizeTerm)
    .filter((t) => t.length >= 2);
  return [...new Set(cleaned)].slice(0, 6);
}

// ─── [SEARCH] Amount matching ────────────────────────────────────────────────
// DB stores total_inc_btw as numeric (e.g. "1500", "1500.5"). Users type NL money
// ("1.500,00" / "1.500" / "1500,00"). Only kick in for money-shaped queries so a
// normal name/number search never triggers a spurious amount match.
function amountConditions(q: string): string[] {
  const trimmed = q.trim();
  if (!/\d/.test(trimmed) || !/^[\d.,\s€]+$/.test(trimmed)) return [];
  const n = parseAmountNL(trimmed);
  if (!(n > 0)) return [];
  const intPart = Math.trunc(n).toString(); // digits only → safe to interpolate
  return [
    `total_inc_btw::text.ilike.${intPart}`,   // exact "1500"
    `total_inc_btw::text.ilike.${intPart}.%`, // "1500.00", "1500.5"
  ];
}

// Builds Supabase .or() string: fields × terms cartesian product (terms pre-sanitised)
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
  if (terms.length === 0) return NextResponse.json(EMPTY);

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

  // invoice_lines pre-query — find invoice IDs matching on line descriptions.
  // No explicit tenant column exists on invoice_lines; RLS scopes SELECT to the
  // owner/receiver/accountant, and the final invoices query re-filters by
  // sender/receiver ∈ senderIds, so this is safe (defence in depth).
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

  const idList = senderIds.join(",");

  // Parallel queries across all sources
  const [invoicesRes, docsRes, clientsRes] = await Promise.all([

    // Source 1: invoices — sender OR receiver (received/incoming invoices included)
    target === "all" || target === "invoices"
      ? supabase
          .from("invoices")
          .select("id, invoice_number, client_name, client_email, status, total_inc_btw, created_at")
          // (sender_id ∈ ids OR receiver_id ∈ ids) — AND-ed with the text .or() below
          .or(`sender_id.in.(${idList}),receiver_id.in.(${idList})`)
          .or(
            [
              buildOr(["invoice_number", "client_name", "client_email"], terms),
              ...amountConditions(q),
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

    // Source 2: documents — own, non-trashed
    target === "all" || target === "documents"
      ? supabase
          .from("documents")
          .select("id, file_name, doc_type, ai_doc_type, period, year, notes, folder_id, created_at")
          .eq("user_id", user.id)
          .eq("trashed", false)
          .or(buildOr(["file_name", "doc_type", "ai_doc_type", "notes"], terms))
          .order("created_at", { ascending: false })
          .limit(4)
      : Promise.resolve({ data: [] as any[] }),

    // Source 3: clients — accountant: linked profiles; zzp'er: own clients registry
    target === "all" || target === "clients"
      ? role === "accountant"
        ? senderIds.length > 1
          ? supabase
              .from("profiles")
              .select("id, full_name, company_name, email, kvk_number, created_at")
              .in("id", senderIds.filter((id) => id !== user.id))
              .or(buildOr(["full_name", "company_name", "email", "kvk_number"], terms))
              .limit(5)
          : Promise.resolve({ data: [] as any[] })
        : supabase
            .from("clients")
            .select("id, name, email, kvk_number, city, created_at")
            .eq("user_id", user.id)
            .or(buildOr(["name", "email", "kvk_number", "city"], terms))
            .limit(5)
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
      href: `/dashboard/facturen?focus=${inv.id}`,
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
      // Bestanden reads ?folder=&focus= (root docs carry no folder → focus only)
      href: doc.folder_id
        ? `/dashboard/bestanden?folder=${doc.folder_id}&focus=${doc.id}`
        : `/dashboard/bestanden?focus=${doc.id}`,
      createdAt: doc.created_at,
    }))
  );

  const clients: SearchResult[] = dedup(
    (clientsRes.data ?? []).map((row: any) =>
      role === "accountant"
        ? {
            type: "client" as const,
            id: row.id,
            title: row.full_name ?? row.company_name ?? row.email ?? "—",
            subtitle: row.company_name ?? row.email ?? "",
            meta: row.kvk_number ? `KVK ${row.kvk_number}` : undefined,
            href: `/dashboard/klanten?focus=${row.id}`,
            createdAt: row.created_at,
          }
        : {
            type: "client" as const,
            id: row.id,
            title: row.name ?? "—",
            subtitle: row.email ?? row.city ?? "",
            meta: row.kvk_number ? `KVK ${row.kvk_number}` : undefined,
            href: `/dashboard/klanten?focus=${row.id}`,
            createdAt: row.created_at,
          }
    )
  );

  return NextResponse.json({ invoices, documents, clients });
}
