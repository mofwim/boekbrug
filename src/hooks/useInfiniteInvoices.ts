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
  /**
   * Accountant mode: geef de IDs van gekoppelde klanten mee.
   * Hook zoekt dan op sender_id IN (clientIds) i.p.v. sender_id = userId.
   * Lege array [] = geen klanten geladen → lijst blijft leeg.
   */
  clientIds?: string[];
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

  const isAccountantMode = opts.clientIds !== undefined;

  // ─── Fetch one page ───────────────────────────────────────────────────────
  const fetchPage = useCallback(
    async (replace = false) => {
      // Accountant zonder klanten → niets laden
      if (isAccountantMode && opts.clientIds!.length === 0) {
        setInvoices([]);
        setHasMore(false);
        return;
      }

      if (loading) return;
      setLoading(true);
      setError(null);

      try {
        let q = supabase
          .from("invoices")
          .select(SELECT)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(PAGE_SIZE);

        // Accountant: zoek op klant-IDs; ZZP'er: zoek op eigen ID
        if (isAccountantMode) {
          q = q.in("sender_id", opts.clientIds!);
        } else {
          q = q.eq("sender_id", opts.userId);
        }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.userId, opts.status, JSON.stringify(opts.clientIds)]
  );

  // ─── Reset + herlaad bij filter- of clientIds-wijziging ──────────────────
  useEffect(() => {
    cursorRef.current = null;
    setInvoices([]);
    setHasMore(true);
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.userId, opts.status, JSON.stringify(opts.clientIds)]);

  // ─── Real-time: nieuwe facturen bovenaan prependen ───────────────────────
  useEffect(() => {
    // Welke sender_ids bewaken we?
    const watchIds = isAccountantMode ? (opts.clientIds ?? []) : [opts.userId];
    if (watchIds.length === 0) return;

    // Supabase realtime filter ondersteunt geen IN — luister globaal en filter client-side
    const channel = supabase
      .channel(`invoices-rt-${opts.userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "invoices" },
        (payload) => {
          const row = payload.new as InvoiceRow & { sender_id: string };
          if (!watchIds.includes(row.sender_id)) return;
          const matchesFilter =
            !opts.status || opts.status === "all" || row.status === opts.status;
          if (!matchesFilter) return;
          setInvoices((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            return [row, ...prev];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [opts.userId, opts.status, JSON.stringify(opts.clientIds), supabase]);

  // ─── Pull-to-refresh ─────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setRefreshing(true);
    cursorRef.current = null;
    await fetchPage(true);
    setRefreshing(false);
  }, [fetchPage]);

  // ─── Optimistic helpers ───────────────────────────────────────────────────
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