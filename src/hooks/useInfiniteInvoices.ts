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

interface UseInfiniteInvoicesOptions {
  userId: string;
  status?: string;
}

export function useInfiniteInvoices(opts: UseInfiniteInvoicesOptions) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          "id, invoice_number, client_name, status, direction, total_inc_btw, invoice_date, due_date, created_at"
        )
        .eq("sender_id", opts.userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (opts.status) q = q.eq("status", opts.status);

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

      if (rows.length > 0) {
        cursorRef.current = rows[rows.length - 1].created_at;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout bij laden");
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, opts.userId, opts.status, supabase]);

  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    loadMore: fetchPage,
    addOptimistic,
    removeOptimistic,
    updateOptimistic,
  };
}