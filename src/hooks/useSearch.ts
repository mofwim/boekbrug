// src/hooks/useSearch.ts
// [BOEK-012] Search hook — fetch /api/search only — May 2026
// ⚠️  Imports ONLY from @/lib/search (types + pure helpers).
//     Zero server-side imports. Safe for any Client Component.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_GROUP, type SearchResultGroup, type SearchTarget } from "@/lib/search";

interface UseSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  groups: SearchResultGroup;
  totalCount: number;
  loading: boolean;
  error: string | null;
  clear: () => void;
}

interface UseSearchOptions {
  minLength?: number;
  debounceMs?: number;
  target?: SearchTarget;
}

export function useSearch(opts: UseSearchOptions = {}): UseSearchReturn {
  const { minLength = 2, debounceMs = 200, target = "all" } = opts;

  const [query, setQueryState] = useState("");
  const [groups, setGroups] = useState<SearchResultGroup>(EMPTY_GROUP);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setQuery = useCallback((q: string) => setQueryState(q), []);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();
    setQueryState("");
    setGroups(EMPTY_GROUP);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (query.length < minLength) {
      void (async () => {
        setGroups(EMPTY_GROUP);
        setError(null);
        setLoading(false);
      })();
      return;
    }

    void (async () => { setLoading(true); })();

    // [SEARCH] Per-run guard: a superseded/unmounted run must neither overwrite newer
    // state nor flip the spinner off while a newer request is still in flight.
    let cancelled = false;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    timerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, target });
        // [BOEK-012] fetch API only — never import supabase-server directly
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Zoekopdracht mislukt");
        const data: SearchResultGroup = await res.json();
        if (cancelled) return;
        setGroups(data);
        setError(null);
      } catch (e) {
        if (cancelled || (e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setGroups(EMPTY_GROUP);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, debounceMs);

    // Cleanup on deps-change AND unmount: cancel state writes, abort the fetch, clear timer.
    return () => {
      cancelled = true;
      controller.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, minLength, debounceMs, target]);

  const totalCount =
    groups.invoices.length + groups.documents.length + groups.clients.length;

  return { query, setQuery, groups, totalCount, loading, error, clear };
}