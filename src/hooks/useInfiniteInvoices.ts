// hooks/useInfiniteInvoices.ts
// Infinite scroll for invoices (BOEK-009)
// Uses cursor-based pagination (created_at + id) — no OFFSET

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";

const PAGE_SIZE = 20;

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  client_name: string;
  status: string;
  total_inc_btw: number;
  btw_rate: number;
  invoice_date: string;
  due_date: string | null;
  direction: string;
  created_at: string;
}

interface UseInfiniteInvoicesOptions {
  userId: string;
  status?: string;
}

export function useInfiniteInvoices(opts: UseInfiniteInvoicesOptions) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cursor: id of last loaded invoice
  const cursorRef = useRef<string | null>(null);
  const supabase = createClient();

  const fetchPage = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);

    try {
      let q = supabase
        .from("invoices")
        .select(
          "id, invoice_number, client_name, status, total_inc_btw, btw_rate, invoice_date, due_date, direction, created_at"
        )
        .eq("sender_id", opts.userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (opts.status) q = q.eq("status", opts.status);

      // Cursor pagination: use created_at stored in cursorRef
      if (cursorRef.current) {
        q = q.lt("created_at", cursorRef.current);
      }

      const { data, error: fetchError } = await q;

      if (fetchError) throw new Error(fetchError.message);

      const rows = data as InvoiceRow[];

      if (rows.length < PAGE_SIZE) setHasMore(false);

      setInvoices((prev) => {
        const ids = new Set(prev.map((r) => r.id));
        return [...prev, ...rows.filter((r) => !ids.has(r.id))];
      });

      // Store created_at of last row as cursor (not id)
      if (rows.length > 0) {
        cursorRef.current = rows[rows.length - 1].created_at;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout bij laden");
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, opts.userId, opts.status, supabase]);

  // Initial load
  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Add an invoice optimistically (BOEK-009 — Optimistic UI) */
  const addOptimistic = useCallback((invoice: InvoiceRow) => {
    setInvoices((prev) => [invoice, ...prev]);
  }, []);

  /** Remove an invoice optimistically */
  const removeOptimistic = useCallback((id: string) => {
    setInvoices((prev) => prev.filter((r) => r.id !== id));
  }, []);

  /** Update an invoice optimistically */
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
    loadMore: fetchPage,
    addOptimistic,
    removeOptimistic,
    updateOptimistic,
  };
}
