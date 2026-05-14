// hooks/useSearch.ts
// Debounced full-text search (BOEK-012)

"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/lib/search";

interface UseSearchOptions {
  minLength?: number;   // min chars before searching (default: 2)
  debounceMs?: number;  // debounce delay (default: 300ms)
  target?: "invoices" | "documents" | "all";
}

export function useSearch(query: string, opts: UseSearchOptions = {}) {
  const { minLength = 2, debounceMs = 300, target = "all" } = opts;

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.length < minLength) {
      setResults([]);
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      // Cancel previous request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ q: query, target });
        const res = await fetch(`/api/search?${params}`, {
          signal: abortRef.current.signal,
        });

        if (!res.ok) throw new Error("Zoekopdracht mislukt");

        const data = await res.json();
        setResults(data.results ?? []);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, minLength, debounceMs, target]);

  return { results, loading, error };
}
