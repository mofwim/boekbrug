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
// [SEARCH] Smart layer — Jul 2026
//   - Relevance ranking (exact > prefix > word-boundary > substring > fuzzy), then recency.
//   - Typo tolerance: when exact/substring results are sparse, augment with pg_trgm
//     fuzzy matches via RPC (search_smart.sql). Gracefully skipped (safeRpc → []) when
//     the migration is not yet applied, so search never breaks.
// ⚠️  This is the ONLY file allowed to import supabase-server.ts for search.
//     All Supabase queries are here. search.ts has types only.
//     Runs on the anon key + user cookies → RLS is enforced on every query.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
// [KAS-ZACHT] A removed cash movement counts in no total — one definition, see cash-live.ts.
import { liveCashEntries } from "@/lib/cash-live";
import { amountOrConditions, foldText, NO_TRUNCATION } from "@/lib/search";
import { parseSearchQuery, filterDateRange } from "@/lib/search-query";
import type { SearchResult, SearchResultGroup, SearchTarget, SearchTruncation } from "@/lib/search";

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
// Amount → ILIKE conditions are built by the SHARED, tested helper amountOrConditions
// (src/lib/search.ts), so the global bar matches amounts identically to the in-page
// filters — decimal- and thousands-aware ("670,09" narrows to 670.09, not 670.50).
// Bank/cash use { signed: true } because a debit is stored negative.

// Builds Supabase .or() string: fields × terms cartesian product (terms pre-sanitised)
function buildOr(fields: string[], terms: string[]): string {
  return fields
    .flatMap((f) => terms.map((t) => `${f}.ilike.%${t}%`))
    .join(",");
}

// Loose structural shape shared by all search-hit rows (invoices, documents,
// profiles, clients) — fields vary per source; absent keys read undefined.
type Hit = { id: string; created_at?: string | null } & Partial<
  Record<
    | "invoice_number" | "client_name" | "client_email" | "status" | "direction"
    | "file_name" | "ai_doc_type" | "doc_type" | "notes" | "period" | "folder_id"
    | "full_name" | "company_name" | "email" | "kvk_number" | "name" | "city"
    // bank_transactions / cash_entries
    | "counterpart_name" | "counterpart_iban" | "reference" | "description"
    | "category" | "date" | "entry_date",
    string | null
  >
> & { total_inc_btw?: number | null; year?: number | null; amount?: number | null };

function dedup(arr: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return arr.filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

// ─── [SEARCH] Relevance ranking ──────────────────────────────────────────────
// Accent-insensitive fold so "café" ranks like "cafe".
// [SMART-FILTER] Uses the shared foldText from src/lib/search.ts (single source of
// truth), so ranking folds exactly like every in-page filter.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Higher = more relevant: exact > starts-with > word-boundary > substring, then
// (for multi-word queries) token-coverage, then fuzzy=0.
// The full query is scored against each single field first (strongest signal). If no
// single field contains the whole string — the common multi-word case, e.g.
// "2026-004 moha" — we fall back to how many query TOKENS appear across the fields,
// so ranking still engages instead of degrading to pure recency.
function rankScore(query: string, fields: Array<string | null | undefined>): number {
  const needle = foldText(query).trim();
  if (!needle) return 0;
  const folded = fields.map((f) => foldText(f)).filter(Boolean);
  if (folded.length === 0) return 0;

  const wb = new RegExp(`\\b${escapeRegex(needle)}`);
  let best = 0;
  for (const v of folded) {
    let s = 0;
    if (v === needle) s = 1000;
    else if (v.startsWith(needle)) s = 800;
    else if (wb.test(v)) s = 600;
    else if (v.includes(needle)) s = 400;
    if (s > best) best = s;
  }
  if (best > 0) return best;

  // Multi-token fallback: reward how many tokens are present across all fields.
  // Keep 1-char tokens so initials still count ("J Jansen" → "Jan Jansen").
  const tokens = needle.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length > 1) {
    const haystack = folded.join(" ");
    const matched = tokens.filter((t) => haystack.includes(t)).length;
    if (matched === tokens.length) return 350; // all tokens present (just below a contiguous substring)
    if (matched > 0) return 100 + matched * 20; // partial coverage
  }
  return 0;
}

// Sort raw rows by relevance, then recency (newest first). Pure, no mutation.
function rankRows<T extends { created_at?: string | null }>(
  rows: T[],
  query: string,
  fieldsOf: (row: T) => Array<string | null | undefined>
): T[] {
  return [...rows].sort((a, b) => {
    const d = rankScore(query, fieldsOf(b)) - rankScore(query, fieldsOf(a));
    if (d !== 0) return d;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [SEARCH] Cap length: bounds the un-indexed per-row trigram work in the fuzzy
  // RPCs (a huge q over many RLS-visible rows would be an amplification vector).
  // Drop a lone trailing surrogate the slice may have split (invalid UTF-8 → PG error).
  const q = (req.nextUrl.searchParams.get("q") ?? "")
    .trim()
    .slice(0, 100)
    .replace(/[\uD800-\uDBFF]$/, "");
  const target = (req.nextUrl.searchParams.get("target") ?? "all") as SearchTarget;
  // [SEARCH] full=1 → the dedicated results page (/dashboard/zoeken) wants more
  // rows per group than the header dropdown's compact preview (8/4/5).
  const full = req.nextUrl.searchParams.get("full") === "1";
  const CAP = full
    ? { invoices: 30, documents: 20, clients: 20, bank: 20, cash: 20 }
    : { invoices: 8, documents: 4, clients: 5, bank: 6, cash: 6 };

  // [ZOEK-EERLIJK] Ask for ONE more row than we will ever show. If it comes back, the database had
  // more to give and the screen has to say so — the cheapest possible way to turn "this is
  // everything" into a fact instead of an assumption. It costs one row per source.
  const PROBE = {
    invoices: CAP.invoices + 1, documents: CAP.documents + 1, clients: CAP.clients + 1,
    bank: CAP.bank + 1, cash: CAP.cash + 1,
  };

  const EMPTY: SearchResultGroup = {
    invoices: [], documents: [], clients: [], bankTransactions: [], cashEntries: [],
    truncated: NO_TRUNCATION,
  };

  if (q.length < 2) return NextResponse.json(EMPTY);

  // [ZOEK-BEGRIJPT] Read the parts of the query that are not search terms — a year, a quarter, a
  // month, inkoop/verkoop, betaald/openstaand — and take them OUT of the text. Leaving them in
  // would make the filter pointless: every 2025 invoice matches the term "2025" anyway.
  //
  // The rules live in search-query.ts and are tested there. What is recognised travels back to the
  // screen, because a query that silently means something other than what was typed is worse than
  // one that ignores half of it: results disappear and nothing says why.
  const parsed = parseSearchQuery(q);
  const range = filterDateRange(parsed.filters);
  const textQ = parsed.text.trim();

  // Only filters, no words left ("inkoop 2026"): that is a legitimate search, and the terms are
  // simply not what narrows it. Anything else still needs at least one usable term.
  const terms = textQ.length >= 2 ? normalizeQuery(textQ) : [];
  const filtersOnly = terms.length === 0 && parsed.recognised.length > 0;
  if (terms.length === 0 && !filtersOnly) return NextResponse.json(EMPTY);

  const fmt = (n: number) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

  // invoice_lines pre-query — find invoice IDs matching on line descriptions.
  // No explicit tenant column exists on invoice_lines; RLS scopes SELECT to the
  // owner/receiver/accountant, and the final invoices query re-filters by
  // sender/receiver ∈ senderIds, so this is safe (defence in depth).
  // [PERF] This query depends ONLY on `terms`, never on the role/accountant
  // lookups below — so fire it NOW (Promise.resolve() forces the lazy PostgREST
  // builder to execute) and await it further down. Saves one serial round-trip.
  const linesPromise =
    target === "all" || target === "invoices"
      ? Promise.resolve(
          supabase
            .from("invoice_lines")
            .select("invoice_id")
            .or(buildOr(["description"], terms))
            // [ZOEK-EERLIJK] Ordered, because this LIMIT decides which invoices can be found by
          // their line text at all. Without an order Postgres returns an arbitrary 30, so the
          // same query could surface a different set of invoices on two consecutive runs.
          .order("id", { ascending: true })
          .limit(30)
        )
      : null;

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

  // [PERF] Collect the invoice_lines result kicked off above (already in flight
  // while the role/accountant queries ran). Gate unchanged: no promise → [].
  const lineMatches = linesPromise ? (await linesPromise).data : null;
  // [BOEK-FOUNDATION-TYPES] invoice_id is nullable — filter out nulls
  const invoiceIdsFromLines: string[] = [
    ...new Set(
      (lineMatches ?? [])
        .map((l) => l.invoice_id)
        .filter((id): id is string => id !== null)
    ),
  ];

  const idList = senderIds.join(",");

  // Parallel queries across all sources
  // [KAS-ZACHT] A removed cash movement must not be findable: search is how an owner reaches a
  // booking, and a hit that opens a drawer the entry is no longer in is worse than no hit.
  const liveCash = await liveCashEntries(supabase);
  // [ZOEK-BEGRIJPT] Narrow a source by what the query said, on the date column that source uses.
  //
  // Applied as ordinary .eq()/.gte()/.lte(), so the filters AND with the text search rather than
  // widening it — narrowing that widens is not narrowing.
  //
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const narrow = <T,>(qb: T, dateColumn: string, opts?: { status?: boolean; direction?: boolean }): T => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let b = qb as any;
    if (range) b = b.gte(dateColumn, range.start).lte(dateColumn, range.end);
    if (opts?.direction && parsed.filters.direction) b = b.eq("direction", parsed.filters.direction);
    if (opts?.status && parsed.filters.paid) {
      // "betaald" is one status; "openstaand" is every status that still owes money — and an
      // archived or draft invoice owes nothing, so a plain .neq("status","paid") would be wrong.
      b = parsed.filters.paid === "paid"
        ? b.eq("status", "paid")
        : b.in("status", ["sent", "received", "overdue"]);
    }
    return b as T;
  };

  // A query that is ONLY filters has no text to match on, so the text .or() is left off entirely —
  // an empty .or() is not "match everything", it is a malformed filter.
  const textOr = (conditions: Array<string | null>): string | null => {
    const joined = conditions.filter(Boolean).join(",");
    return joined.length > 0 ? joined : null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withText = <T,>(qb: T, conditions: Array<string | null>): T => {
    const or = textOr(conditions);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (or ? (qb as any).or(or) : qb) as T;
  };

  const [invoicesRes, docsRes, clientsRes, bankRes, cashRes] = await Promise.all([

    // Source 1: invoices — sender OR receiver (received/incoming invoices included)
    target === "all" || target === "invoices"
      ? narrow(withText(supabase
          .from("invoices")
          .select("id, invoice_number, client_name, client_email, status, total_inc_btw, created_at, direction")
          // (sender_id ∈ ids OR receiver_id ∈ ids) — AND-ed with the text .or() below
          .or(`sender_id.in.(${idList}),receiver_id.in.(${idList})`), [
            buildOr(["invoice_number", "client_name", "client_email"], terms),
            ...amountOrConditions("total_inc_btw", textQ || q),
            invoiceIdsFromLines.length > 0 ? `id.in.(${invoiceIdsFromLines.join(",")})` : null,
          ]), "invoice_date", { status: true, direction: true })
          .order("created_at", { ascending: false })
          .limit(PROBE.invoices)
      : Promise.resolve({ data: [] as Hit[] }),

    // Source 2: documents — own, non-trashed
    target === "all" || target === "documents"
      ? narrow(withText(supabase
          .from("documents")
          .select("id, file_name, doc_type, ai_doc_type, period, year, notes, folder_id, created_at")
          .eq("user_id", user.id)
          .eq("trashed", false), // [T#3] don't surface soft-deleted files in global search
          [buildOr(["file_name", "doc_type", "ai_doc_type", "notes"], terms)]), "created_at")
          .order("created_at", { ascending: false })
          .limit(PROBE.documents)
      : Promise.resolve({ data: [] as Hit[] }),

    // Source 3: clients — accountant: linked profiles; zzp'er: own clients registry
    target === "all" || target === "clients"
      ? role === "accountant"
        ? senderIds.length > 1
          ? supabase
              .from("profiles")
              .select("id, full_name, company_name, email, kvk_number, created_at")
              .in("id", senderIds.filter((id) => id !== user.id))
              .or(buildOr(["full_name", "company_name", "email", "kvk_number"], terms))
              .order("full_name", { ascending: true })
            .limit(PROBE.clients)
          : Promise.resolve({ data: [] as Hit[] })
        : supabase
            .from("clients")
            .select("id, name, email, kvk_number, city, created_at")
            .eq("user_id", user.id)
            .or(buildOr(["name", "email", "kvk_number", "city"], terms))
            .order("name", { ascending: true })
            .limit(PROBE.clients)
      : Promise.resolve({ data: [] as Hit[] }),

    // Source 4: bank transactions — own rows. Amount is SIGNED (debit negative), so the
    // amount conditions emit both signs. RLS also scopes to the owner (defence in depth).
    target === "all" || target === "bank"
      ? narrow(withText(supabase
          .from("bank_transactions")
          .select("id, date, amount, description, counterpart_name, counterpart_iban, reference, status, created_at")
          .eq("user_id", user.id), [
            buildOr(["counterpart_name", "description", "counterpart_iban", "reference"], terms),
            ...amountOrConditions("amount", textQ || q, { signed: true }),
          ]), "date")
          .order("date", { ascending: false })
          .limit(PROBE.bank)
      : Promise.resolve({ data: [] as Hit[] }),

    // Source 5: cash entries (kasboek) — own rows. category is a key (omzet/kosten/…) so a
    // "omzet" query still matches; description is the free-text line.
    target === "all" || target === "kas"
      ? narrow(withText(liveCash.only(supabase
          .from("cash_entries")
          .select("id, entry_date, amount, category, description, direction, created_at")
          .eq("user_id", user.id)), [
            buildOr(["description", "category"], terms),
            ...amountOrConditions("amount", textQ || q, { signed: true }),
          ]), "entry_date")
          .order("entry_date", { ascending: false })
          .limit(PROBE.cash)
      : Promise.resolve({ data: [] as Hit[] }),
  ]);

  // [ZOEK-BEGRIJPT] Rank and fuzzy-match on the TEXT that is left, never on the whole typed
  // query. Scoring a row against "doyum 2025" after the year became a filter would mark every
  // surviving hit as a partial match, and the fuzzy RPC would hunt a supplier called "doyum 2025".
  const rankQ = textQ || q;

  // ── [SEARCH] Fuzzy augmentation (typo tolerance) when results are sparse ──────
  // safeRpc returns [] if the fuzzy function isn't present (migration not applied)
  // or on any error, so search degrades gracefully to the exact/substring path.
  // Cast: these RPCs are optional (added by search_smart.sql) so they aren't in the
  // generated Supabase types. Narrowed to a typed caller (keeps `this` bound).
  type RpcCaller = {
    rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  };
  const safeRpc = async (fn: string, args: Record<string, unknown>): Promise<Hit[]> => {
    try {
      const { data, error } = await (supabase as unknown as RpcCaller).rpc(fn, args);
      if (error) return [];
      return (data ?? []) as Hit[];
    } catch {
      return [];
    }
  };

  // [SEARCH] Only fuzzy-match NAME-like queries. Typo-tolerance is for names; a numeric
  // query (invoice number / amount) is exact-match territory — trigram similarity on
  // structured numbers produces garbage (e.g. "2034116" ~ "20260034" ≈ 0.23), so a
  // non-existent number would surface an unrelated invoice. Requires a letter.
  const nameLike = /\p{L}/u.test(q);

  let invoiceRows: Hit[] = (invoicesRes.data ?? []) as unknown as Hit[];
  if (nameLike && (target === "all" || target === "invoices") && invoiceRows.length < 3) {
    // RLS scopes the fuzzy rows to what this user may already see.
    invoiceRows = [...invoiceRows, ...(await safeRpc("search_invoices_fuzzy", { q: rankQ }))];
  }

  let clientRows: Hit[] = (clientsRes.data ?? []) as unknown as Hit[];
  if (nameLike && (target === "all" || target === "clients") && role !== "accountant" && clientRows.length < 3) {
    clientRows = [...clientRows, ...(await safeRpc("search_clients_fuzzy", { q: rankQ }))];
  }

  let docRows: Hit[] = (docsRes.data ?? []) as unknown as Hit[];
  if (nameLike && (target === "all" || target === "documents") && docRows.length < 3) {
    docRows = [...docRows, ...(await safeRpc("search_documents_fuzzy", { q: rankQ }))];
  }

  // [ZOEK-EERLIJK] Cap the group, and REMEMBER that it was capped.
  //
  // Measured after ranking and de-duplication, so it counts what the owner would actually have
  // seen — not what the database happened to return. One row over the cap is enough to know.
  const truncated: SearchTruncation = { ...NO_TRUNCATION };
  const takeCapped = <T,>(rows: T[], limit: number, group: keyof SearchTruncation): T[] => {
    if (rows.length > limit) truncated[group] = true;
    return rows.slice(0, limit);
  };

  const invoices: SearchResult[] = takeCapped(dedup(
    rankRows(invoiceRows, rankQ, (inv) => [inv.invoice_number, inv.client_name, inv.client_email])
      .map((inv) => ({
        type: "invoice" as const,
        id: inv.id,
        title: inv.invoice_number ?? "—",
        subtitle: inv.client_name ?? "",
        meta: inv.total_inc_btw != null ? fmt(inv.total_inc_btw) : undefined,
        status: inv.status ?? undefined,
        // [SEARCH-LANDING] Route each hit to a surface that can actually SHOW it:
        //  · incoming received/paid → /incoming/manage?focus= (it fetches the
        //    focused row by id when outside its window — always lands). The old
        //    /incoming?focus= target opened the verify tab, which neither
        //    contains confirmed rows nor switches tabs → the hit was invisible.
        //  · other incoming (processing/archived/…) → /incoming?focus= (queue).
        //  · outgoing → the invoice DETAIL page — renders any id, unlike
        //    /facturen?focus= which only expands rows in its loaded pages
        //    (a hit older than ~20 rows silently showed nothing).
        href: inv.direction === "incoming"
          ? (inv.status === "received" || inv.status === "paid"
              ? `/dashboard/incoming/manage?focus=${inv.id}`
              : `/dashboard/incoming?focus=${inv.id}`)
          : `/dashboard/invoice/${inv.id}`,
        createdAt: inv.created_at ?? "",
      }))
  ), CAP.invoices, "invoices");

  const documents: SearchResult[] = takeCapped(dedup(
    rankRows(docRows, rankQ, (doc) => [doc.file_name, doc.ai_doc_type, doc.doc_type, doc.notes])
      .map((doc) => ({
        type: "document" as const,
        id: doc.id,
        title: doc.file_name ?? "—",
        subtitle: doc.ai_doc_type ?? doc.doc_type ?? "document",
        meta: [doc.period, doc.year].filter(Boolean).join(" · ") || undefined,
        // Bestanden reads ?folder=&focus= (root docs carry no folder → focus only)
        href: doc.folder_id
          ? `/dashboard/bestanden?folder=${doc.folder_id}&focus=${doc.id}`
          : `/dashboard/bestanden?focus=${doc.id}`,
        createdAt: doc.created_at ?? "",
      }))
  ), CAP.documents, "documents");

  const clients: SearchResult[] = takeCapped(dedup(
    rankRows(clientRows, rankQ, (row) =>
      role === "accountant"
        ? [row.full_name, row.company_name, row.email, row.kvk_number]
        : [row.name, row.email, row.kvk_number, row.city]
    ).map((row) =>
      role === "accountant"
        ? {
            type: "client" as const,
            id: row.id,
            title: row.full_name ?? row.company_name ?? row.email ?? "—",
            subtitle: row.company_name ?? row.email ?? "",
            meta: row.kvk_number ? `KVK ${row.kvk_number}` : undefined,
            // Accountant clients are linked zzp'er PROFILES → the accountant views
            // them at /dashboard/clients/{id}, NOT the owner's own /dashboard/klanten.
            href: `/dashboard/clients/${row.id}`,
            createdAt: row.created_at ?? "",
          }
        : {
            type: "client" as const,
            id: row.id,
            title: row.name ?? "—",
            subtitle: row.email ?? row.city ?? "",
            meta: row.kvk_number ? `KVK ${row.kvk_number}` : undefined,
            href: `/dashboard/klanten?focus=${row.id}`,
            createdAt: row.created_at ?? "",
          }
    )
  ), CAP.clients, "clients");

  // ── Bankmutaties ──────────────────────────────────────────────────────────────
  // Deep-link: seed the bank page's own zoekbalk (?find=) with the most identifying
  // token so the exact line surfaces there (it filters on counterpart/description/
  // IBAN/reference/amount). Fall back to the whole-euro amount when a line has no text.
  const bankRows: Hit[] = (bankRes.data ?? []) as unknown as Hit[];
  const bankTransactions: SearchResult[] = takeCapped(dedup(
    rankRows(bankRows, rankQ, (r) => [r.counterpart_name, r.description, r.reference, r.counterpart_iban])
      .map((r) => {
        const term =
          (r.counterpart_name || r.description || r.reference || "").trim() ||
          (r.amount != null ? String(Math.trunc(Math.abs(r.amount))) : "");
        return {
          type: "banktransaction" as const,
          id: r.id,
          title: r.counterpart_name || r.description || "Bankmutatie",
          subtitle:
            r.counterpart_name && r.description ? r.description : (r.reference ?? r.date ?? ""),
          meta: r.amount != null ? fmt(r.amount) : undefined,
          href: `/dashboard/bank${term ? `?find=${encodeURIComponent(term)}` : ""}`,
          createdAt: r.created_at ?? r.date ?? "",
        };
      })
  ), CAP.bank, "bankTransactions");

  // ── Kasboekingen ──────────────────────────────────────────────────────────────
  const cashRows: Hit[] = (cashRes.data ?? []) as unknown as Hit[];
  const cashEntries: SearchResult[] = takeCapped(dedup(
    rankRows(cashRows, rankQ, (r) => [r.description, r.category])
      .map((r) => {
        const term =
          (r.description || "").trim() ||
          (r.amount != null ? String(Math.trunc(Math.abs(r.amount))) : "");
        return {
          type: "cashentry" as const,
          id: r.id,
          title: r.description || r.category || "Kasboeking",
          subtitle: r.description && r.category ? r.category : (r.entry_date ?? ""),
          meta: r.amount != null ? fmt(r.amount) : undefined,
          href: `/dashboard/kas${term ? `?find=${encodeURIComponent(term)}` : ""}`,
          createdAt: r.created_at ?? r.entry_date ?? "",
        };
      })
  ), CAP.cash, "cashEntries");

  // [ZOEK-BEGRIJPT] What the search UNDERSTOOD travels back, so the screen can show it as chips
  // the owner can remove. A query that silently means something else is worse than one that
  // ignores half of it: results vanish and nothing says why.
  return NextResponse.json({
    invoices, documents, clients, bankTransactions, cashEntries, truncated,
    recognised: parsed.recognised,
  });
}
