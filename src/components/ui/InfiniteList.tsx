// components/ui/InfiniteList.tsx
// Reusable infinite scroll wrapper (BOEK-009)
// Uses IntersectionObserver — no library needed

"use client";

import { useEffect, useRef } from "react";

interface InfiniteListProps {
  children: React.ReactNode;
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  /** Optional: custom loading skeleton */
  skeleton?: React.ReactNode;
}

/**
 * Wraps any list and triggers onLoadMore when the sentinel
 * element scrolls into view. Zero-dependency, lightweight.
 */
export function InfiniteList({
  children,
  onLoadMore,
  hasMore,
  loading,
  skeleton,
}: InfiniteListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          onLoadMore();
        }
      },
      { rootMargin: "200px" } // Start loading 200px before reaching the end
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  return (
    <>
      {children}
      {loading && (skeleton ?? <DefaultSkeleton />)}
      {/* Invisible sentinel div — triggers load when visible */}
      {hasMore && <div ref={sentinelRef} aria-hidden="true" />}
      {!hasMore && !loading && (
        <p className="text-center text-sm text-muted-foreground py-6">
          Alle facturen geladen
        </p>
      )}
    </>
  );
}

function DefaultSkeleton() {
  return (
    <div className="space-y-2 mt-2" aria-label="Laden…">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 rounded-lg bg-muted animate-pulse"
          style={{ opacity: 1 - i * 0.2 }}
        />
      ))}
    </div>
  );
}
