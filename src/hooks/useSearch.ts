// hooks/useSearch.ts
// Self-contained search hook (BOEK-012)
// Holds query state internally — parent doesn't re-render on every keystroke

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult, SearchTarget } from "@/lib/search";

interface UseSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  results: SearchResult[];
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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();
    setQueryState("");
    setResults([]);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (query.length < minLength) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const params = new URLSearchParams({ q: query, target });
        const res = await fetch(`/api/search?${params}`, {
          signal: abortRef.current.signal,
        });
        if (!res.ok) throw new Error("Zoekopdracht mislukt");
        const data = await res.json();
        setResults(data.results ?? []);
        setError(null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, minLength, debounceMs, target]);

  return { query, setQuery, results, loading, error, clear };
}