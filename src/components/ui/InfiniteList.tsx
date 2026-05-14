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
  /** Pull-to-refresh callback — alleen op mobile */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Optional: custom loading skeleton */
  skeleton?: React.ReactNode;
}

/**
 * Wraps any list and triggers onLoadMore when the sentinel
 * element scrolls into view. Pull-to-refresh via touch events.
 */
export function InfiniteList({
  children,
  onLoadMore,
  hasMore,
  loading,
  onRefresh,
  refreshing = false,
  skeleton,
}: InfiniteListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);

  // ─── IntersectionObserver ──────────────────────────────
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          onLoadMore();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  // ─── Pull-to-refresh (touch only) ─────────────────────
  function handleTouchStart(e: React.TouchEvent) {
    // Alleen triggeren als je al helemaal bovenaan bent
    if (window.scrollY === 0) {
      startYRef.current = e.touches[0].clientY;
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (startYRef.current === null) return;
    const delta = e.changedTouches[0].clientY - startYRef.current;
    startYRef.current = null;
    if (delta > 60 && onRefresh && !refreshing) {
      onRefresh();
    }
  }

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Vernieuwen indicator */}
      {refreshing && (
        <div className="flex justify-center items-center gap-2 py-3 text-sm text-gray-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
          Vernieuwen…
        </div>
      )}

      {children}

      {loading && (skeleton ?? <DefaultSkeleton />)}

      {/* Invisible sentinel — triggers loadMore */}
      {hasMore && <div ref={sentinelRef} aria-hidden="true" />}

      {!hasMore && !loading && (
        <p className="text-center text-sm text-muted-foreground py-6">
          Alle facturen geladen
        </p>
      )}
    </div>
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