// src/hooks/useInfiniteInvoices.ts
// [BoekBrug v1.2] — BOEK-009 — Infinite Scroll + Filter
// Owns: cursor-based pagination, filter by status, accountant mode
// Do not modify without reading SHARED_FILES_PROTOCOL.md

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// [PARTIAL-PAY] amount_paid rides along so the list can show a partly-settled invoice as such
// (chip + open amount) and the bundle selection can total the OPEN amounts. Without it the
// debtor list showed the full total on an invoice that was already half paid — the customer
// had paid, the reminder and the pay-QR already asked only the remainder, and only this screen
// still claimed the full sum.
const SELECT =
  "id, invoice_number, client_name, status, accountant_status, direction, total_inc_btw, amount_paid, total_ex_btw, btw_amount, invoice_date, due_date, created_at, replaced_by_number, invoice_type, payment_date";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  client_name: string;
  status: string;
  accountant_status?: string | null;
  direction: string;
  total_inc_btw: number;
  // [PARTIAL-PAY] Running total already settled (magnitude). 0/absent = fully open.
  // Openstaand = status 'paid' ? 0 : max(0, |total_inc_btw| − amount_paid).
  amount_paid?: number | null;
  // [BOEK-031] add ex_btw and btw for pro_forma display — May 2026
  total_ex_btw?: number | null;
  btw_amount?: number | null;
  invoice_date: string;
  due_date: string | null;
  created_at: string;
  // [BOEK-031] Replace Flow — ingevuld als deze factuur vervangen is — May 2026
  replaced_by_number?: string | null;
  // [BOEK-031] invoice_type for badge display — May 2026
  invoice_type?: string | null;
  // [CROSS-QUARTER] The real settlement date (bank line's date, written on confirm/auto-
  // confirm). Accrual is unchanged — this only lets the row show "Betaald in Q2" when a
  // Q1 invoice was actually paid in Q2. Null while unpaid / paid without a recorded date.
  payment_date?: string | null;
}

/** ZZP filter — on invoice status */
export type InvoiceStatusFilter = "all" | "draft" | "sent" | "paid" | "overdue";

/** Accountant filter — on accountant_status (always pre-filtered to paid invoices) */
export type AccountantStatusFilter = "all" | "verwerkt" | "in_behandeling" | "vraag";

export interface UseInfiniteInvoicesOptions {
  userId: string;
  /** ZZP mode: filter by invoice status */
  status?: InvoiceStatusFilter;
  /** Accountant mode: filter by accountant_status */
  accountantStatus?: AccountantStatusFilter;
  /**
   * Accountant mode: pass sender_id list from accountant_clients.
   * When defined (even empty array), activates accountant mode.
   */
  clientIds?: string[];
}

export interface UseInfiniteInvoicesReturn {
  invoices: InvoiceRow[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  refreshing: boolean;
  loadMore: () => void;
  refresh: () => Promise<void>;
  /** Optimistic add — call before API create */
  addOptimistic: (invoice: InvoiceRow) => void;
  /** Optimistic remove — call on API error after addOptimistic */
  removeOptimistic: (id: string) => void;
  /** Optimistic patch — call before API update */
  updateOptimistic: (id: string, patch: Partial<InvoiceRow>) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useInfiniteInvoices(
  opts: UseInfiniteInvoicesOptions
): UseInfiniteInvoicesReturn {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // [CURSOR-KEYSET] Compound cursor (created_at, id) matching the (created_at
  // DESC, id DESC) order. A created_at-only cursor with strict .lt() skipped
  // every row sharing the page-boundary timestamp (bulk imports/migrations get
  // statement-stable now() defaults, so >PAGE_SIZE rows can share one) — those
  // invoices silently never appeared on any page.
  const cursorRef = useRef<{ created_at: string; id: string } | null>(null);
  // [BOEK-009] track in-flight fetch to prevent race conditions — May 2026
  const fetchingRef = useRef(false);
  const supabase = createClient();

  const isAccountantMode = opts.clientIds !== undefined;

  // Stable serialisation of clientIds for dependency tracking
  const clientIdsKey = JSON.stringify(opts.clientIds ?? []);

  // ── Core fetch ──────────────────────────────────────────────────────────────

  const fetchPage = useCallback(
    async (replace = false) => {
      // [BOEK-009] accountant with no clients → empty list immediately — May 2026
      if (isAccountantMode && opts.clientIds!.length === 0) {
        setInvoices([]);
        setHasMore(false);
        return;
      }

      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        let q = supabase
          .from("invoices")
          .select(SELECT)
          // [BOEK-009] newest first — verified sort order — May 2026
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(PAGE_SIZE);

        if (isAccountantMode) {
          // [BOEK-009] accountant sees ONLY paid invoices of his clients — May 2026
          q = q.in("sender_id", opts.clientIds!).eq("status", "paid");

          if (opts.accountantStatus && opts.accountantStatus !== "all") {
            q = q.eq("accountant_status", opts.accountantStatus);
          }
        } else {
          // ZZP sees own invoices
          q = q.eq("sender_id", opts.userId);

          if (opts.status && opts.status !== "all") {
            if (opts.status === "overdue") {
              // [BOEK-009] overdue = sent + due_date < today — May 2026
              const today = new Date().toISOString().split("T")[0];
              q = q.eq("status", "sent").lt("due_date", today);
            } else {
              q = q.eq("status", opts.status);
            }
          }
        }

        // [BOEK-009] cursor-based pagination — no OFFSET — May 2026
        // [CURSOR-KEYSET] Strictly-after-the-cursor in (created_at, id) order:
        // older timestamp OR same timestamp with a smaller id. Timestamps
        // contain no commas/parens, so they are safe inside the .or() grammar.
        if (!replace && cursorRef.current) {
          const c = cursorRef.current;
          q = q.or(
            `created_at.lt.${c.created_at},and(created_at.eq.${c.created_at},id.lt.${c.id})`
          );
        }

        const { data, error: fetchError } = await q;
        if (fetchError) throw new Error(fetchError.message);

        const rows = (data ?? []) as InvoiceRow[];
        const newHasMore = rows.length === PAGE_SIZE;
        setHasMore(newHasMore);

        // [BOEK-031] Fetch archived invoices — alleen in ZZP mode, alleen op eerste pagina — May 2026
        let archivedRows: InvoiceRow[] = [];
        if (!isAccountantMode && replace) {
          const { data: archivedData } = await supabase
            .from("invoices")
            .select(SELECT)
            .eq("sender_id", opts.userId)
            .eq("status", "archived")
            .order("created_at", { ascending: false });
          archivedRows = (archivedData ?? []) as InvoiceRow[];
        }

        if (replace) {
          // [BOEK-031] archived altijd aan het einde — May 2026
          setInvoices([...rows, ...archivedRows]);
          const last = rows.at(-1);
          cursorRef.current = last ? { created_at: last.created_at, id: last.id } : null;
        } else {
          setInvoices((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            // archived zitten al in de lijst van replace — niet opnieuw toevoegen
            const newRows = rows.filter((r) => !seen.has(r.id) && r.status !== "archived");
            // archived altijd aan het einde houden
            const archived = prev.filter((r) => r.status === "archived");
            const normal   = prev.filter((r) => r.status !== "archived");
            return [...normal, ...newRows, ...archived];
          });
          if (rows.length > 0) {
            const last = rows.at(-1)!;
            cursorRef.current = { created_at: last.created_at, id: last.id };
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fout bij laden");
      } finally {
        setLoading(false);
        fetchingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.userId, opts.status, opts.accountantStatus, clientIdsKey, isAccountantMode]
  );

  // ── Reset on filter change ───────────────────────────────────────────────────

  // [BOEK-009] reset list + cursor whenever any filter param changes — May 2026
  // (state resets on the next tick — never synchronously in the effect body,
  // which triggers cascading renders during the effects pass)
  useEffect(() => {
    cursorRef.current = null;
    fetchingRef.current = false;
    const t = setTimeout(() => {
      setInvoices([]);
      setHasMore(true);
      setError(null);
      fetchPage(true);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.userId, opts.status, opts.accountantStatus, clientIdsKey]);

  // ── Real-time: new invoices prepended ────────────────────────────────────────

  useEffect(() => {
    const watchIds = isAccountantMode
      ? (opts.clientIds ?? [])
      : [opts.userId];

    if (watchIds.length === 0) return;

    const channel = supabase
      .channel(`invoices-rt-${opts.userId}-${opts.status ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "invoices" },
        (payload) => {
          const row = payload.new as InvoiceRow & { sender_id: string };

          // [BOEK-009] guard: only rows relevant to current user / client list — May 2026
          if (!watchIds.includes(row.sender_id)) return;
          if (isAccountantMode && row.status !== "paid") return;
          // [RT-OVERDUE] The old short-circuit let EVERY insert (a fresh draft,
          // a paid import) prepend into the "Verlopen" tab. Overdue is computed,
          // not stored: it must match the fetch filter (sent + due_date < today).
          if (!isAccountantMode && opts.status === "overdue") {
            const today = new Date().toISOString().split("T")[0];
            if (!(row.status === "sent" && row.due_date && row.due_date < today)) return;
          }
          if (
            !isAccountantMode &&
            opts.status &&
            opts.status !== "all" &&
            opts.status !== "overdue" &&
            row.status !== opts.status
          ) return;

          setInvoices((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            return [row, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.userId, opts.status, clientIdsKey, isAccountantMode]);

  // ── Public API ───────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setRefreshing(true);
    cursorRef.current = null;
    fetchingRef.current = false;
    await fetchPage(true);
    setRefreshing(false);
  }, [fetchPage]);

  // [BOEK-009] optimistic helpers — used by BOEK-029 ZZP Dashboard — May 2026
  const addOptimistic = useCallback((invoice: InvoiceRow) => {
    setInvoices((prev) => [invoice, ...prev]);
  }, []);

  const removeOptimistic = useCallback((id: string) => {
    setInvoices((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateOptimistic = useCallback(
    (id: string, patch: Partial<InvoiceRow>) => {
      setInvoices((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
      );
    },
    []
  );

  // Stable identity so consumers may safely list loadMore in effect deps.
  const loadMore = useCallback(() => { fetchPage(false); }, [fetchPage]);

  return {
    invoices,
    loading,
    hasMore,
    error,
    refreshing,
    loadMore,
    refresh,
    addOptimistic,
    removeOptimistic,
    updateOptimistic,
  };
}