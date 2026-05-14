// hooks/useInfiniteInvoices.ts
// Infinite scroll for invoices (BOEK-009)

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";

const PAGE_SIZE = 20;

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  client_name: string;
  status: string;
  direction: string;
  total_inc_btw: number;
  invoice_date: string;
  due_date: string | null;
  created_at: string;
}

/** "all" = geen filter, anders exact match op status */
export type InvoiceStatusFilter = "all" | "draft" | "sent" | "paid" | "overdue";

interface UseInfiniteInvoicesOptions {
  userId: string;
  /** Filtert de lijst — reset automatisch bij wijziging */
  status?: InvoiceStatusFilter;
}

const SELECT =
  "id, invoice_number, client_name, status, direction, total_inc_btw, invoice_date, due_date, created_at";

export function useInfiniteInvoices(opts: UseInfiniteInvoicesOptions) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const cursorRef = useRef<string | null>(null);
  const supabase = createClient();

  // ─── Fetch one page ───────────────────────────────────────
  const fetchPage = useCallback(
    async (replace = false) => {
      if (loading) return;
      setLoading(true);
      setError(null);

      try {
        let q = supabase
          .from("invoices")
          .select(SELECT)
          .eq("sender_id", opts.userId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(PAGE_SIZE);

        if (opts.status && opts.status !== "all") {
          q = q.eq("status", opts.status);
        }

        if (!replace && cursorRef.current) {
          q = q.lt("created_at", cursorRef.current);
        }

        const { data, error: fetchError } = await q;
        if (fetchError) throw new Error(fetchError.message);

        const rows = data as InvoiceRow[];
        setHasMore(rows.length === PAGE_SIZE);

        if (replace) {
          setInvoices(rows);
          cursorRef.current = rows.at(-1)?.created_at ?? null;
        } else {
          setInvoices((prev) => {
            const ids = new Set(prev.map((r) => r.id));
            return [...prev, ...rows.filter((r) => !ids.has(r.id))];
          });
          if (rows.length > 0) cursorRef.current = rows.at(-1)!.created_at;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fout bij laden");
      } finally {
        setLoading(false);
      }
    },
    // loading weggelaten uit deps — anders infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.userId, opts.status]
  );

  // ─── Reset + herlaad bij filter-wijziging ─────────────────
  useEffect(() => {
    cursorRef.current = null;
    setInvoices([]);
    setHasMore(true);
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.userId, opts.status]);

  // ─── Real-time: nieuwe facturen bovenaan prependen ────────
  useEffect(() => {
    const channel = supabase
      .channel(`invoices-rt-${opts.userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "invoices",
          filter: `sender_id=eq.${opts.userId}`,
        },
        (payload) => {
          const row = payload.new as InvoiceRow;
          const matchesFilter =
            !opts.status || opts.status === "all" || row.status === opts.status;
          if (!matchesFilter) return;
          setInvoices((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev; // geen duplicaat
            return [row, ...prev];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [opts.userId, opts.status, supabase]);

  // ─── Pull-to-refresh ──────────────────────────────────────
  const refresh = useCallback(async () => {
    setRefreshing(true);
    cursorRef.current = null;
    await fetchPage(true);
    setRefreshing(false);
  }, [fetchPage]);

  // ─── Optimistic helpers (ongewijzigd) ─────────────────────
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

  return {
    invoices,
    loading,
    hasMore,
    error,
    refreshing,
    loadMore: () => fetchPage(false),
    refresh,
    addOptimistic,
    removeOptimistic,
    updateOptimistic,
  };
}